/**
 * Intent layer: preview → authorize → execute → reconcile, over the existing SDK.
 *
 * - A preview turns explicit intent into exact executable terms (market, side,
 *   human + raw amounts, quote source/time, minimum received or limit price,
 *   funding plan, expiry) and is stored locally under an opaque previewId.
 * - Execution needs authority: either the user approved this exact preview
 *   (`userApproved: true`), or it fits the account's delegated policy file,
 *   which only the user edits (`$GDEX_HOME/policies/<accountRef>.json`).
 * - Every execution is journaled BEFORE submission as an operation. An
 *   ambiguous submit becomes `submission_unknown` and is reconciled, never
 *   resent. Terms that moved since the preview yield a revised preview.
 *
 * Supported now: spot via the unified-USDC wallet (buy with USDC, sell to USDC)
 * and Hyperliquid perps (open market/limit, close/reduce). Other venues return
 * a capability error instead of guessing.
 */
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import {
  GdexValidationError,
  normalizeChain,
  parseAmountUnits,
  deriveMaxSourceSpendRaw,
  buyGasHeadroomUsdc,
} from '@gemachdao/gdex-skill';
import type { GdexSkill } from '@gemachdao/gdex-skill';
import { gdexHome, loadAccount, type StoredAccount } from './credentials.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type TradeKind = 'spot' | 'perp_open' | 'perp_close';

export interface SpotIntent {
  kind: 'spot';
  chain: string | number;
  tokenAddress: string;
  side: 'buy' | 'sell';
  /** Buy: USDC to spend. Sell: token amount. Human decimal string. */
  amount: string;
  /** Max slippage percent, default 1, cap 5. */
  slippagePct?: number;
  /** Buy only: let GDEX bridge USDC and gas in from other chains (default true). */
  autoFunding?: boolean;
}

export interface PerpOpenIntent {
  kind: 'perp_open';
  coin: string;
  side: 'long' | 'short';
  /** Exactly one of notionalUsd (position size in USD) or marginUsd (collateral). */
  notionalUsd?: string;
  marginUsd?: string;
  leverage: number;
  orderType?: 'market' | 'limit';
  limitPrice?: string;
  tpPrice?: string;
  slPrice?: string;
}

export interface PerpCloseIntent {
  kind: 'perp_close';
  coin: string;
  /** Omit for a full close. Contracts, decimal string. */
  size?: string;
  dex?: string;
}

export type TradeIntent = SpotIntent | PerpOpenIntent | PerpCloseIntent;

export interface Preview {
  previewId: string;
  accountRef: string;
  custody: string;
  kind: TradeKind;
  createdAt: number;
  expiresAt: number;
  /** USD value used for policy limits. */
  notionalUsd: number;
  summary: string;
  terms: Record<string, unknown>;
  /** sha256 of accountRef + kind + terms, checked at execution. */
  binding: string;
  warnings: string[];
  exit: string;
}

export type OperationState =
  | 'submitting'
  | 'accepted'
  | 'funding'
  | 'filled'
  | 'failed'
  | 'submission_unknown'
  | 'needs_retry'
  | 'pending';

export interface Operation {
  opId: string;
  previewId: string;
  accountRef: string;
  kind: TradeKind;
  state: OperationState;
  notionalUsd: number;
  createdAt: number;
  updatedAt: number;
  requestId?: string;
  hash?: string;
  errorCode?: string;
  detail?: unknown;
  history: Array<{ at: number; state: OperationState; note?: string }>;
}

export interface Policy {
  /** ISO date; the policy is void after it. */
  expiresAt: string;
  allowedKinds?: TradeKind[];
  allowedChainIds?: number[];
  maxTradeUsd: number;
  maxDailyUsd?: number;
  maxLeverage?: number;
  maxSlippagePct?: number;
  allowBridging?: boolean;
}

export interface IntentDeps {
  sdk: () => GdexSkill;
  /** POST to the Hyperliquid info API (public market data). */
  hlInfo: (body: Record<string, unknown>) => Promise<unknown>;
  now: () => number;
}

const SOLANA_CHAIN_ID = 622112261;
const PREVIEW_TTL_MS = 60_000;
const HL_MIN_ORDER_USD = 11;
const CUSTODY = 'GDEX managed custody: GDEX holds the trading wallets; this machine holds the session key that authorizes trades.';

// ── Store ──────────────────────────────────────────────────────────────────

function dir(name: string): string {
  return path.join(gdexHome(), name);
}

async function writeJson(sub: string, id: string, value: unknown): Promise<void> {
  await fs.mkdir(dir(sub), { recursive: true, mode: 0o700 });
  const file = path.join(dir(sub), `${id}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
}

async function readJson<T>(sub: string, id: string): Promise<T | undefined> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new GdexValidationError(`Invalid id: ${id}`, 'id');
  return fs.readFile(path.join(dir(sub), `${id}.json`), 'utf8').then((t) => JSON.parse(t) as T, () => undefined);
}

export async function listOperations(accountRef?: string): Promise<Operation[]> {
  const names = await fs.readdir(dir('operations')).catch(() => [] as string[]);
  const ops: Operation[] = [];
  for (const n of names.filter((f) => f.endsWith('.json'))) {
    const op = await readJson<Operation>('operations', n.slice(0, -5));
    if (op && (!accountRef || op.accountRef === accountRef)) ops.push(op);
  }
  return ops.sort((a, b) => b.createdAt - a.createdAt);
}

async function saveOp(op: Operation, state: OperationState, patch: Partial<Operation> = {}, note?: string, now = Date.now()): Promise<Operation> {
  const next: Operation = { ...op, ...patch, state, updatedAt: now, history: [...op.history, { at: now, state, ...(note ? { note } : {}) }] };
  await writeJson('operations', op.opId, next);
  return next;
}

export async function loadPolicy(accountRef: string): Promise<Policy | undefined> {
  return readJson<Policy>('policies', accountRef);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function bind(accountRef: string, kind: TradeKind, terms: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify([accountRef, kind, terms])).digest('hex');
}

function creds(a: StoredAccount) {
  return { apiKey: a.apiKey, walletAddress: a.walletAddress, sessionPrivateKey: a.sessionPrivateKey };
}

function slipFloor(raw: string, slippagePct: number): string {
  const bps = BigInt(Math.round(slippagePct * 100));
  return ((BigInt(raw) * (10000n - bps)) / 10000n).toString();
}

function formatUnits(raw: string, decimals: number): string {
  const s = raw.padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

function floorToDecimals(value: number, decimals: number): string {
  const f = 10 ** decimals;
  return (Math.floor(value * f) / f).toFixed(decimals);
}

function usdcDecimals(chainId: number): number {
  return chainId === 56 ? 18 : 6;
}

interface PerpMarket {
  coin: string;
  dex: string;
  szDecimals: number;
  maxLeverage: number;
  /** Margin mode the backend applies: isolated for builder-DEX and isolated-only assets, else cross (hyperLiquidWorker.ts useIsolated). */
  marginMode: 'cross' | 'isolated';
  markPx: number;
  source: string;
  asOf: number;
}

/** Resolve a perp market (core or `dex:COIN` builder DEX) from Hyperliquid meta. */
async function perpMarket(deps: IntentDeps, coin: string): Promise<PerpMarket> {
  const [dexPart, namePart] = coin.includes(':') ? coin.split(':') : ['', coin];
  const meta = (await deps.hlInfo(dexPart ? { type: 'metaAndAssetCtxs', dex: dexPart } : { type: 'metaAndAssetCtxs' })) as
    | [{ universe: Array<{ name: string; szDecimals: number; maxLeverage: number; isDelisted?: boolean; onlyIsolated?: boolean }> }, Array<{ markPx?: string }>]
    | undefined;
  if (!Array.isArray(meta) || !meta[0]?.universe) throw new Error('Hyperliquid market data unavailable');
  const want = dexPart ? `${dexPart}:${namePart}` : namePart;
  const idx = meta[0].universe.findIndex((u) => u.name.toUpperCase() === want.toUpperCase());
  if (idx < 0) throw new GdexValidationError(`Unknown perp market ${coin}${dexPart ? '' : ' (builder-DEX markets use dex:COIN, e.g. xyz:TSLA)'}`, 'coin');
  const u = meta[0].universe[idx];
  if (u.isDelisted) throw new GdexValidationError(`${coin} is delisted`, 'coin');
  const markPx = Number(meta[1]?.[idx]?.markPx);
  if (!Number.isFinite(markPx) || markPx <= 0) throw new Error(`No mark price for ${coin}; not executable right now`);
  const marginMode = dexPart || u.onlyIsolated === true ? 'isolated' : 'cross';
  return { coin: u.name, dex: dexPart, szDecimals: u.szDecimals, maxLeverage: u.maxLeverage, marginMode, markPx, source: 'hyperliquid metaAndAssetCtxs', asOf: deps.now() };
}

// ── Preview ────────────────────────────────────────────────────────────────

export async function previewTrade(deps: IntentDeps, accountRef: string, intent: TradeIntent): Promise<Preview> {
  const account = await loadAccount(accountRef);
  const sdk = deps.sdk();
  const now = deps.now();
  let kind: TradeKind = intent.kind;
  let terms: Record<string, unknown>;
  let notionalUsd: number;
  let summary: string;
  let exit: string;
  const warnings: string[] = [];

  if (intent.kind === 'spot') {
    const chain = normalizeChain(intent.chain);
    if (chain.id === (4663 as number) || chain.id === (252 as number)) {
      throw new GdexValidationError('No USDC on this chain; the USDC wallet trades on Ethereum, Optimism, BSC, Sonic, Base, Arbitrum and Solana', 'chain');
    }
    const slippagePct = intent.slippagePct ?? 1;
    if (!(slippagePct > 0 && slippagePct <= 5)) throw new GdexValidationError('slippagePct must be in (0, 5]', 'slippagePct');
    const uDec = usdcDecimals(chain.id);
    if (intent.side === 'buy') {
      const amountRaw = parseAmountUnits(intent.amount, uDec, 'amount').toString();
      const q = (await sdk.getUsdcTradeQuote({ ...creds(account), chainId: chain.id, tokenAddress: intent.tokenAddress, payAsset: 'usdc', amountInRaw: amountRaw, side: 'buy' })) as Record<string, unknown>;
      const outRaw = String(q.amountOutRaw ?? '');
      if (!/^\d+$/.test(outRaw) || outRaw === '0') throw new Error('No executable quote for this buy right now');
      const tokenDecimals = Number(q.tokenDecimals ?? 0);
      const autoFunding = intent.autoFunding ?? true;
      const headroom = (BigInt(buyGasHeadroomUsdc(chain.id)) * 10n ** BigInt(uDec)).toString();
      const maxSourceSpendRaw = autoFunding ? deriveMaxSourceSpendRaw(amountRaw, headroom) : '0';
      const minOutRaw = slipFloor(outRaw, slippagePct);
      notionalUsd = Number(intent.amount);
      terms = {
        chainId: chain.id, tokenAddress: intent.tokenAddress, side: 'buy', payAsset: 'usdc',
        spendUsdc: intent.amount, spendRaw: amountRaw,
        expectedOutRaw: outRaw, minOutRaw, tokenDecimals,
        expectedOut: formatUnits(outRaw, tokenDecimals), minOut: formatUnits(minOutRaw, tokenDecimals),
        slippagePct, quoteSource: q.source, quotedAt: q.quotedAt ?? now, fees: q.feeIncluded ? 'GDEX fee included in quote' : 'see quote',
        autoFunding, maxSourceSpendRaw, maxSourceSpendUsdc: formatUnits(maxSourceSpendRaw, uDec),
      };
      summary = `Buy ${formatUnits(outRaw, tokenDecimals)} (min ${formatUnits(minOutRaw, tokenDecimals)}) of ${intent.tokenAddress} for ${intent.amount} USDC on chain ${chain.id}`;
      if (autoFunding) warnings.push(`Automatic funding may bridge USDC and gas from your other chains, never more than ${formatUnits(maxSourceSpendRaw, uDec)} USDC in total (signed cap, not a fee quote).`);
      exit = 'Sell back with a spot preview (side: sell) on the same chain; proceeds settle in USDC.';
    } else {
      const details = (await sdk.getTokenDetails({ tokenAddress: intent.tokenAddress, chain: chain.id as never })) as unknown as Record<string, unknown>;
      const decimals = Number(details?.decimals);
      if (!Number.isInteger(decimals)) throw new Error('Token decimals unavailable; cannot size the sell exactly');
      const amountRaw = parseAmountUnits(intent.amount, decimals, 'amount').toString();
      const q = (await sdk.getUsdcTradeQuote({ ...creds(account), chainId: chain.id, tokenAddress: intent.tokenAddress, payAsset: 'usdc', amountInRaw: amountRaw, side: 'sell' })) as Record<string, unknown>;
      const outRaw = String(q.amountOutRaw ?? '');
      if (!/^\d+$/.test(outRaw) || outRaw === '0') throw new Error('No executable quote for this sell right now');
      const minOutRaw = slipFloor(outRaw, slippagePct);
      notionalUsd = Number(formatUnits(outRaw, uDec));
      terms = {
        chainId: chain.id, tokenAddress: intent.tokenAddress, side: 'sell', receiveAsset: 'usdc',
        sellAmount: intent.amount, sellRaw: amountRaw, tokenDecimals: decimals,
        expectedUsdcRaw: outRaw, minUsdcRaw: minOutRaw,
        expectedUsdc: formatUnits(outRaw, uDec), minUsdc: formatUnits(minOutRaw, uDec),
        slippagePct, quoteSource: q.source, quotedAt: q.quotedAt ?? now, autoFunding: false,
      };
      summary = `Sell ${intent.amount} of ${intent.tokenAddress} for ~${formatUnits(outRaw, uDec)} USDC (min ${formatUnits(minOutRaw, uDec)}) on chain ${chain.id}`;
      exit = 'Proceeds land in the unified USDC wallet on this chain.';
    }
  } else if (intent.kind === 'perp_open') {
    const m = await perpMarket(deps, intent.coin);
    if ((intent.notionalUsd === undefined) === (intent.marginUsd === undefined)) {
      throw new GdexValidationError('Give exactly one of notionalUsd (position size) or marginUsd (collateral); "$100 at 2x" is ambiguous', 'notionalUsd');
    }
    if (!Number.isInteger(intent.leverage) || intent.leverage < 1) throw new GdexValidationError('leverage must be a positive integer', 'leverage');
    if (intent.leverage > m.maxLeverage) throw new GdexValidationError(`${m.coin} allows at most ${m.maxLeverage}x`, 'leverage');
    const orderType = intent.orderType ?? 'market';
    if (orderType === 'limit' && !intent.limitPrice) throw new GdexValidationError('limitPrice is required for a limit order', 'limitPrice');
    const price = orderType === 'limit' ? Number(intent.limitPrice) : m.markPx;
    if (!Number.isFinite(price) || price <= 0) throw new GdexValidationError('limitPrice must be a positive number', 'limitPrice');
    const notional = intent.notionalUsd !== undefined ? Number(intent.notionalUsd) : Number(intent.marginUsd) * intent.leverage;
    if (!Number.isFinite(notional) || notional <= 0) throw new GdexValidationError('Amount must be a positive number', 'notionalUsd');
    const size = floorToDecimals(notional / price, m.szDecimals);
    const sizedNotional = Number(size) * price;
    if (Number(size) <= 0 || sizedNotional < HL_MIN_ORDER_USD) {
      throw new GdexValidationError(`Order too small: ${size} ${m.coin} ≈ $${sizedNotional.toFixed(2)}; GDEX requires at least $${HL_MIN_ORDER_USD}`, 'notionalUsd');
    }
    notionalUsd = sizedNotional;
    terms = {
      coin: m.coin, dex: m.dex, side: intent.side, isLong: intent.side === 'long', orderType,
      price: String(price), markPx: String(m.markPx), size, szDecimals: m.szDecimals,
      notionalUsd: sizedNotional.toFixed(2), marginUsd: (sizedNotional / intent.leverage).toFixed(2),
      leverage: intent.leverage, marginMode: m.marginMode, maxLeverage: m.maxLeverage,
      tpPrice: intent.tpPrice ?? '', slPrice: intent.slPrice ?? '', priceSource: m.source, priceAsOf: m.asOf,
    };
    summary = `${orderType === 'market' ? 'Market' : `Limit @ ${price}`} ${intent.side} ${size} ${m.coin} (~$${sizedNotional.toFixed(2)} notional, ~$${(sizedNotional / intent.leverage).toFixed(2)} margin at ${intent.leverage}x ${m.marginMode})`;
    if (orderType === 'market') warnings.push('Market order: fills near the mark price within the backend slippage band; the fill price is confirmed after execution.');
    if (!intent.tpPrice && !intent.slPrice) warnings.push('No TP/SL attached.');
    if (m.marginMode === 'cross') warnings.push('Cross margin: the backend uses cross for core perps, so the position shares the whole perp account balance as collateral.');
    exit = `Close or reduce with gdex_manage_position { action: "close", coin: "${m.coin}" }.`;
  } else {
    const plan = await sdk.resolvePerpClose({ ...creds(account), coin: intent.coin, ...(intent.size ? { size: intent.size } : {}), ...(intent.dex ? { dex: intent.dex } : {}), positionAddress: account.managed?.evm ?? account.walletAddress });
    const m = await perpMarket(deps, plan.dex && !plan.coin.includes(':') ? `${plan.dex}:${plan.coin}` : plan.coin).catch(() => undefined);
    notionalUsd = m ? Number(plan.size) * m.markPx : 0;
    terms = { ...plan, markPx: m ? String(m.markPx) : undefined, priceSource: m?.source, reduceOnly: true };
    summary = `Close ${plan.size} of ${plan.positionSide} ${plan.coin} (position ${plan.positionSize}) with a reduce-only market ${plan.closeSide}`;
    exit = 'Reduce-only: cannot flip the position.';
    kind = 'perp_close';
  }

  const preview: Preview = {
    previewId: `pv_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    accountRef, custody: CUSTODY, kind, createdAt: now, expiresAt: now + PREVIEW_TTL_MS,
    notionalUsd, summary, terms, binding: bind(accountRef, kind, terms), warnings, exit,
  };
  await writeJson('previews', preview.previewId, preview);
  return preview;
}

// ── Authority ──────────────────────────────────────────────────────────────

export interface AuthorityResult { ok: boolean; via?: 'user_approved' | 'policy'; reasons: string[] }

export async function checkAuthority(deps: IntentDeps, p: Preview, userApproved: boolean): Promise<AuthorityResult> {
  if (userApproved) return { ok: true, via: 'user_approved', reasons: [] };
  const policy = await loadPolicy(p.accountRef);
  if (!policy) return { ok: false, reasons: ['No delegated policy for this account: ask the user to approve this exact preview (userApproved: true).'] };
  const reasons: string[] = [];
  const t = p.terms;
  if (!(Date.parse(policy.expiresAt) > deps.now())) reasons.push('Policy expired');
  if (policy.allowedKinds && !policy.allowedKinds.includes(p.kind)) reasons.push(`Policy does not allow ${p.kind}`);
  if (policy.allowedChainIds && typeof t.chainId === 'number' && !policy.allowedChainIds.includes(t.chainId)) reasons.push(`Policy does not allow chain ${t.chainId}`);
  if (p.notionalUsd > policy.maxTradeUsd) reasons.push(`Trade $${p.notionalUsd.toFixed(2)} exceeds policy maxTradeUsd $${policy.maxTradeUsd}`);
  if (policy.maxLeverage !== undefined && typeof t.leverage === 'number' && t.leverage > policy.maxLeverage) reasons.push(`Leverage ${t.leverage}x exceeds policy ${policy.maxLeverage}x`);
  if (policy.maxSlippagePct !== undefined && typeof t.slippagePct === 'number' && t.slippagePct > policy.maxSlippagePct) reasons.push(`Slippage ${t.slippagePct}% exceeds policy ${policy.maxSlippagePct}%`);
  if (policy.allowBridging === false && t.autoFunding === true) reasons.push('Policy forbids bridging; preview with autoFunding: false');
  if (policy.maxDailyUsd !== undefined) {
    const dayAgo = deps.now() - 86_400_000;
    const spent = (await listOperations(p.accountRef))
      .filter((o) => o.createdAt > dayAgo && o.state !== 'failed' && o.kind !== 'perp_close')
      .reduce((a, o) => a + o.notionalUsd, 0);
    if (p.kind !== 'perp_close' && spent + p.notionalUsd > policy.maxDailyUsd) reasons.push(`Daily total $${(spent + p.notionalUsd).toFixed(2)} (incl. pending) exceeds policy maxDailyUsd $${policy.maxDailyUsd}`);
  }
  return reasons.length ? { ok: false, reasons } : { ok: true, via: 'policy', reasons: [] };
}

// ── Execute ────────────────────────────────────────────────────────────────

export type ExecuteResult =
  | { status: 'denied'; reasons: string[] }
  | { status: 'revised'; reason: string; preview: Preview }
  | { status: 'submitted'; operation: Operation };

function isUnknown(err: unknown): boolean {
  return (err as Error)?.name === 'GdexSubmissionUnknownError';
}

export async function executeTrade(deps: IntentDeps, previewId: string, userApproved: boolean): Promise<ExecuteResult> {
  const p = await readJson<Preview>('previews', previewId);
  if (!p) throw new GdexValidationError(`Unknown previewId ${previewId}`, 'previewId');
  if (bind(p.accountRef, p.kind, p.terms) !== p.binding) throw new GdexValidationError('Preview was modified; create a new one', 'previewId');
  const used = (await listOperations(p.accountRef)).find((o) => o.previewId === previewId);
  if (used) throw new GdexValidationError(`Preview already executed as ${used.opId} (${used.state}); use gdex_operation`, 'previewId');

  const authority = await checkAuthority(deps, p, userApproved);
  if (!authority.ok) return { status: 'denied', reasons: authority.reasons };

  const account = await loadAccount(p.accountRef);
  const sdk = deps.sdk();
  const t = p.terms as Record<string, string & number & boolean>;

  // Revalidate: an expired or moved preview is re-quoted, never executed on old terms.
  const intentOf = (): TradeIntent =>
    p.kind === 'spot'
      ? { kind: 'spot', chain: t.chainId, tokenAddress: t.tokenAddress, side: t.side as 'buy' | 'sell', amount: t.side === 'buy' ? t.spendUsdc : t.sellAmount, slippagePct: t.slippagePct, autoFunding: t.autoFunding }
      : p.kind === 'perp_open'
        ? { kind: 'perp_open', coin: t.dex ? `${t.dex}:${String(t.coin).replace(/^.*:/, '')}` : t.coin, side: t.side as 'long' | 'short', notionalUsd: t.notionalUsd, leverage: t.leverage, orderType: t.orderType as 'market' | 'limit', ...(t.orderType === 'limit' ? { limitPrice: t.price } : {}), tpPrice: t.tpPrice || undefined, slPrice: t.slPrice || undefined }
        : { kind: 'perp_close', coin: t.coin, size: t.size, dex: t.dex || undefined };
  if (deps.now() > p.expiresAt) {
    return { status: 'revised', reason: 'Preview expired; review the fresh terms', preview: await previewTrade(deps, p.accountRef, intentOf()) };
  }
  if (p.kind === 'spot') {
    const fresh = (await sdk.getUsdcTradeQuote({ ...creds(account), chainId: t.chainId, tokenAddress: t.tokenAddress, payAsset: 'usdc', amountInRaw: t.side === 'buy' ? t.spendRaw : t.sellRaw, side: t.side as 'buy' | 'sell' })) as Record<string, unknown>;
    const floor = BigInt(t.side === 'buy' ? t.minOutRaw : t.minUsdcRaw);
    if (!/^\d+$/.test(String(fresh.amountOutRaw ?? '')) || BigInt(String(fresh.amountOutRaw)) < floor) {
      return { status: 'revised', reason: 'Price moved below the approved minimum', preview: await previewTrade(deps, p.accountRef, intentOf()) };
    }
  }

  const now = deps.now();
  let op: Operation = {
    opId: `op_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    previewId, accountRef: p.accountRef, kind: p.kind, state: 'submitting', notionalUsd: p.notionalUsd,
    createdAt: now, updatedAt: now, history: [{ at: now, state: 'submitting', note: `authorized via ${authority.via}` }],
  };
  await writeJson('operations', op.opId, op);

  try {
    let res: Record<string, unknown>;
    if (p.kind === 'spot' && t.side === 'buy') {
      res = (await sdk.buyWithUsdc({ ...creds(account), chainId: t.chainId, tokenAddress: t.tokenAddress, usdcAmountRaw: t.spendRaw, minTokenOutRaw: t.minOutRaw, autoBridge: t.autoFunding, maxSourceSpendRaw: t.autoFunding ? t.maxSourceSpendRaw : undefined })) as Record<string, unknown>;
    } else if (p.kind === 'spot') {
      res = (await sdk.sellToUsdc({ ...creds(account), chainId: t.chainId, tokenAddress: t.tokenAddress, tokenAmountRaw: t.sellRaw, minUsdcOutRaw: t.minUsdcRaw })) as Record<string, unknown>;
    } else if (p.kind === 'perp_open') {
      op = await saveOp(op, 'submitting', { detail: { preSzi: await liveSzi(deps, account, String(t.coin), t.dex ? String(t.dex) : '') } }, 'pre-trade position recorded', deps.now());
      res = (await sdk.hlCreateOrder({ ...creds(account), coin: t.dex ? `${t.dex}:${String(t.coin).replace(/^.*:/, '')}` : t.coin, isLong: t.isLong, price: t.price, size: t.size, reduceOnly: false, tpPrice: t.tpPrice, slPrice: t.slPrice, isMarket: t.orderType === 'market', marginMode: t.marginMode as 'cross' | 'isolated', leverage: t.leverage })) as unknown as Record<string, unknown>;
    } else {
      op = await saveOp(op, 'submitting', { detail: { preSzi: await liveSzi(deps, account, String(t.coin), t.dex ? String(t.dex) : '') } }, 'pre-trade position recorded', deps.now());
      res = (await sdk.closePerpPosition({ ...creds(account), coin: t.coin, size: t.size, ...(t.dex ? { dex: t.dex } : {}), positionAddress: account.managed?.evm ?? account.walletAddress })) as unknown as Record<string, unknown>;
    }
    const status = String(res.status ?? '').toLowerCase();
    const requestId = typeof res.requestId === 'string' ? res.requestId : undefined;
    const hash = typeof res.hash === 'string' ? res.hash : undefined;
    const order = (p.kind === 'perp_close' ? (res as { order?: Record<string, unknown> }).order : res) ?? {};
    const state: OperationState = status === 'success'
      ? 'filled'
      : status === 'failed' || res.isSuccess === false || order.isSuccess === false
        ? 'failed'
        : requestId || order.isSuccess === true ? 'accepted' : 'pending';
    op = await saveOp(op, state, { requestId, hash, detail: { ...(op.detail as object), response: res } }, undefined, deps.now());
  } catch (err) {
    op = isUnknown(err)
      ? await saveOp(op, 'submission_unknown', { errorCode: 'SUBMISSION_UNKNOWN' }, (err as Error).message, deps.now())
      : await saveOp(op, 'failed', { errorCode: (err as { code?: string }).code ?? 'ERROR' }, (err as Error).message, deps.now());
    if (!isUnknown(err)) throw err;
  }
  return { status: 'submitted', operation: op };
}

// ── Reconcile ──────────────────────────────────────────────────────────────

export async function reconcileOperation(deps: IntentDeps, opId: string, waitMs = 60_000): Promise<Operation> {
  let op = await readJson<Operation>('operations', opId);
  if (!op) throw new GdexValidationError(`Unknown opId ${opId}`, 'opId');
  if (op.state === 'filled' || op.state === 'failed') return op;
  const account = await loadAccount(op.accountRef);
  const sdk = deps.sdk();
  const p = await readJson<Preview>('previews', op.previewId);
  const t = (p?.terms ?? {}) as Record<string, string & number>;

  if (op.kind === 'spot') {
    if (!op.requestId) {
      // Submission unknown: look for it among pending trades; never resubmit.
      const pend = (await sdk.getUsdcPendingTrades({ ...creds(account), chainId: t.chainId })) as { pending?: Array<Record<string, unknown>> };
      const match = (pend.pending ?? []).find((x) => String(x.tokenAddress).toLowerCase() === String(t.tokenAddress).toLowerCase() && x.side === t.side);
      if (!match) return saveOp(op, op.state, {}, 'Not found among pending trades; check the wallet balance before deciding. Do not resubmit blindly.', deps.now());
      op = await saveOp(op, 'accepted', { requestId: String(match.requestId) }, 'Found pending trade', deps.now());
    }
    const w = await sdk.watchUsdcTrade({ ...creds(account), requestId: op.requestId as string, timeoutMs: waitMs });
    const state: OperationState = w.outcome === 'success' ? 'filled' : w.outcome === 'failed' ? 'failed' : w.outcome === 'needs_retry' ? 'needs_retry' : 'funding';
    return saveOp(op, state, { hash: w.hash ?? op.hash, errorCode: w.errorCode, detail: { steps: w.steps, retry: w.retry } }, undefined, deps.now());
  }

  // Perps: compare the live position on the managed account with the pre-trade size.
  const coin = String(t.coin ?? '');
  const pos = await livePosition(deps, account, coin, t.dex ? String(t.dex) : '');
  const pre = Number((op.detail as { preSzi?: string } | undefined)?.preSzi ?? 0);
  const live = Number(pos?.szi ?? 0);
  const size = Number(t.size ?? 0);
  const moved = Math.abs(live - pre);
  const done = size > 0 && moved + 1e-12 >= size * 0.999;
  const leverage = pos?.leverage as { type?: string; value?: number } | undefined;
  const effective = leverage ? { marginMode: leverage.type, leverage: leverage.value } : undefined;
  const note = done
    ? `Filled: position ${pre} -> ${live} ${coin}${effective ? ` (${effective.leverage}x ${effective.marginMode})` : ''}`
    : moved > 0 ? `Partially filled: ${moved} of ${size} ${coin}` : `No change yet in the ${coin} position (${live})`;
  return saveOp(op, done ? 'filled' : op.state, { detail: { ...(op.detail as object), livePosition: pos ?? null, effective } }, note, deps.now());
}

type LivePosition = { coin: string; szi: string; leverage?: unknown; entryPx?: string };

async function livePosition(deps: IntentDeps, account: StoredAccount, coin: string, dex: string): Promise<LivePosition | undefined> {
  const state = (await deps.sdk().getHlClearinghouseState({ userAddress: account.managed?.evm ?? account.walletAddress, ...(dex ? { dex } : {}) })) as { state?: { assetPositions?: Array<{ position: LivePosition }> } };
  const want = coin.toUpperCase();
  return state?.state?.assetPositions?.find((a) => a.position.coin.toUpperCase() === want || a.position.coin.toUpperCase() === want.replace(/^.*:/, ''))?.position;
}

async function liveSzi(deps: IntentDeps, account: StoredAccount, coin: string, dex: string): Promise<string> {
  return (await livePosition(deps, account, coin, dex))?.szi ?? '0';
}

// ── Positions ──────────────────────────────────────────────────────────────

export async function positions(deps: IntentDeps, accountRef: string): Promise<Record<string, unknown>> {
  const account = await loadAccount(accountRef);
  const sdk = deps.sdk();
  const section = async (fn: () => Promise<unknown>) => {
    try { return { status: 'ok', asOf: deps.now(), data: await fn() }; } catch (e) { return { status: 'unavailable', error: (e as Error).message }; }
  };
  const [usdc, perps, openOrders] = await Promise.all([
    section(() => sdk.getUsdcBalances(creds(account))),
    section(() => sdk.getHlClearinghouseStateAll(account.managed?.evm ?? account.walletAddress)),
    section(() => sdk.getHlOpenOrdersAllForCopy(account.managed?.evm ?? account.walletAddress)),
  ]);
  const ops = (await listOperations(accountRef)).filter((o) => !['filled', 'failed'].includes(o.state));
  return {
    accountRef, walletAddress: account.walletAddress, managedWallets: account.managed,
    usdcWallet: usdc, perps, openOrders,
    pendingOperations: ops.map((o) => ({ opId: o.opId, kind: o.kind, state: o.state, notionalUsd: o.notionalUsd, createdAt: o.createdAt })),
    note: 'A section with status "unavailable" is unknown, not empty.',
  };
}

export { SOLANA_CHAIN_ID };
