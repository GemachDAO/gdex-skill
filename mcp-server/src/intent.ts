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
import { connectAccount, gdexHome, loadAccount, type StoredAccount } from './credentials.js';
import {
  USDC_TOKENS, chainBalances, formatUnits as fmtUnits, fundingInstructions, fundingProgress, fundsSummary,
  managedAddress, newFundingOperation, withdrawTerms, type FundingRequest, type WithdrawIntent,
} from './funds.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type TradeKind = 'spot' | 'perp_open' | 'perp_close' | 'withdraw';

/** Operation kinds: trades and withdrawals come from previews; funding has none. */
export type OperationKind = TradeKind | 'funding';

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
  /**
   * Buy only. "trade" (default): spend `amount` on the token; routing and gas come on top, up to
   * the signed cap shown in the preview. "total": `amount` is the most that leaves the wallet,
   * routing and gas included; the trade is sized down to fit.
   */
  budget?: 'trade' | 'total';
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

export type TradeIntent = SpotIntent | PerpOpenIntent | PerpCloseIntent | WithdrawIntent;

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
  | 'pending'
  // funding
  | 'awaiting_user'
  | 'delivering'
  | 'credited'
  | 'expired';

/** States after which an operation needs no more following. */
export const FINAL_STATES: ReadonlySet<OperationState> = new Set(['filled', 'failed', 'credited', 'expired']);
export const isFinal = (o: { state: OperationState }) => FINAL_STATES.has(o.state);

export interface Operation {
  opId: string;
  previewId: string;
  accountRef: string;
  kind: OperationKind;
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
  /** Re-sign-in an account whose session the backend rejected (default: connectAccount). */
  refreshSession?: (a: StoredAccount) => Promise<StoredAccount>;
  /** Wait between balance polls (tests inject a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

/**
 * The backend rejected the session itself (expired/replaced session key): HTTP
 * 401, or code 103/104 "invalid params"/"Unauthorized" from the session check.
 * That check runs before anything executes, so retrying once with a fresh
 * session cannot duplicate a trade.
 */
export function isSessionRejected(err: unknown): boolean {
  const e = err as { name?: string; message?: string; responseBody?: { code?: unknown } };
  if (e?.name === 'GdexAuthError') return true;
  if (e?.name !== 'GdexApiError') return false;
  const code = Number(e.responseBody?.code);
  return code === 103 || code === 104 || /unauthori[sz]ed/i.test(e.message ?? '');
}

async function refresh(deps: IntentDeps, a: StoredAccount): Promise<StoredAccount> {
  return deps.refreshSession
    ? deps.refreshSession(a)
    : connectAccount({ controlPrivateKey: a.controlPrivateKey, source: a.source, apiKey: a.apiKey });
}

/** Run `fn` with the stored account; on a session rejection, re-sign-in once and run it again. */
async function withSession<T>(deps: IntentDeps, accountRef: string, fn: (a: StoredAccount) => Promise<T>): Promise<T> {
  const account = await loadAccount(accountRef);
  try {
    return await fn(account);
  } catch (err) {
    if (!isSessionRejected(err)) throw err;
    return fn(await refresh(deps, account));
  }
}

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

// ── Funding plan ───────────────────────────────────────────────────────────

export interface FundingPlan {
  status: 'ok' | 'unavailable';
  localUsdcRaw?: string;
  localSufficient?: boolean;
  needsGas?: boolean;
  shortfallRaw?: string;
  bridgeFrom?: string;
  /** Estimated USDC lost to bridging/gas top-up (destination units); '0' when no routing is needed. */
  routingCostRaw?: string;
  error?: string;
}

const bridgeQuotes = new Map<string, { at: number; fromRaw: bigint }>();
const BRIDGE_QUOTE_TTL_MS = 30_000;

/**
 * Source USDC a bridge needs to deliver `amountRaw`. Relay rejects quotes requested in quick
 * succession (RELAY_QUOTE_FAILED), so quotes are reused for 30 s and retried once after a pause.
 */
async function bridgeSourceRaw(deps: IntentDeps, account: StoredAccount, fromChainId: number, toChainId: number, amountRaw: string): Promise<bigint> {
  const key = `${account.accountRef}:${fromChainId}:${toChainId}:${amountRaw}`;
  const hit = bridgeQuotes.get(key);
  if (hit && deps.now() - hit.at < BRIDGE_QUOTE_TTL_MS) return hit.fromRaw;
  const quote = () => deps.sdk().estimateUsdcBridge({ ...creds(account), fromChainId, toChainId, amountRaw }) as Promise<Record<string, unknown>>;
  let est: Record<string, unknown>;
  try {
    est = await quote();
  } catch (e) {
    if (!/RELAY_QUOTE_FAILED|rate|429/i.test(String((e as Error).message))) throw e;
    await (deps.sleep ?? sleep)(6_000);
    est = await quote();
  }
  const fromRaw = BigInt(String(est.fromAmountRaw ?? ''));
  bridgeQuotes.set(key, { at: deps.now(), fromRaw });
  return fromRaw;
}

/** Where a buy's USDC comes from: local balance first, then a bridge quote for the shortfall. */
async function fundingPlan(deps: IntentDeps, account: StoredAccount, chainId: number, amountRaw: string, autoFunding: boolean): Promise<FundingPlan> {
  let rows;
  try { rows = await chainBalances(deps, account); } catch (e) { return { status: 'unavailable', error: (e as Error).message }; }
  const here = rows.find((r) => r.chainId === chainId && !r.error);
  if (!here) return { status: 'unavailable', error: `No balance row for chain ${chainId}` };
  const local = BigInt(here.usdcRaw);
  const needsGas = chainId !== SOLANA_CHAIN_ID && Number(here.native) === 0;
  if (local >= BigInt(amountRaw) && !needsGas) return { status: 'ok', localUsdcRaw: here.usdcRaw, localSufficient: true, needsGas, routingCostRaw: '0' };
  const shortfall = local >= BigInt(amountRaw) ? 0n : BigInt(amountRaw) - local;
  const dDec = usdcDecimals(chainId);
  const sources = rows.filter((r) => r.chainId !== chainId && !r.error && USDC_TOKENS[r.chainId]).sort((x, y) => Number(y.usdc) - Number(x.usdc));
  const src = sources[0];
  const plan: FundingPlan = { status: 'ok', localUsdcRaw: here.usdcRaw, localSufficient: shortfall === 0n, needsGas, shortfallRaw: shortfall.toString(), bridgeFrom: src ? USDC_TOKENS[src.chainId].name : undefined };
  if (!autoFunding || !src) return { ...plan, routingCostRaw: '0' };
  try {
    // Quote delivering the shortfall (or a token amount when only gas is missing); cost = source spend - delivered.
    const deliverRaw = shortfall > 0n ? shortfall : 10n ** BigInt(dDec);
    const fromRaw = await bridgeSourceRaw(deps, account, src.chainId, chainId, deliverRaw.toString());
    const sDec = usdcDecimals(src.chainId);
    const fromInDest = sDec === dDec ? fromRaw : sDec > dDec ? fromRaw / 10n ** BigInt(sDec - dDec) : fromRaw * 10n ** BigInt(dDec - sDec);
    const cost = fromInDest > deliverRaw ? fromInDest - deliverRaw : 0n;
    return { ...plan, routingCostRaw: cost.toString() };
  } catch (e) {
    return { ...plan, status: 'unavailable', error: `Bridge quote unavailable: ${(e as Error).message}` };
  }
}

// ── Preview ────────────────────────────────────────────────────────────────

export async function previewTrade(deps: IntentDeps, accountRef: string, intent: TradeIntent): Promise<Preview> {
  return withSession(deps, accountRef, (account) => previewWith(deps, account, accountRef, intent));
}

async function previewWith(deps: IntentDeps, account: StoredAccount, accountRef: string, intent: TradeIntent): Promise<Preview> {
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
      const requestedRaw = parseAmountUnits(intent.amount, uDec, 'amount').toString();
      const autoFunding = intent.autoFunding ?? true;
      const budget = intent.budget ?? 'trade';
      const plan = await fundingPlan(deps, account, chain.id, requestedRaw, autoFunding);
      let amountRaw = requestedRaw;
      let maxSourceSpendRaw: string;
      if (budget === 'total') {
        if (plan.status !== 'ok') throw new Error(`The funding route could not be priced (${plan.error ?? 'unknown'}), so a total budget cannot be guaranteed right now; retry, or preview with budget "trade" to see the signed cap`);
        amountRaw = (BigInt(requestedRaw) - BigInt(plan.routingCostRaw ?? '0')).toString();
        if (BigInt(amountRaw) <= 0n) {
          throw new GdexValidationError(`${intent.amount} USDC does not cover routing: moving funds to ${USDC_TOKENS[chain.id]?.name ?? chain.id} costs ~${fmtUnits(plan.routingCostRaw ?? '0', uDec)} USDC. Add money on this chain or raise the budget.`, 'amount');
        }
        maxSourceSpendRaw = autoFunding ? requestedRaw : '0';
      } else {
        const headroom = (BigInt(buyGasHeadroomUsdc(chain.id)) * 10n ** BigInt(uDec)).toString();
        maxSourceSpendRaw = autoFunding ? deriveMaxSourceSpendRaw(amountRaw, headroom) : '0';
      }
      if (plan.status === 'ok' && !autoFunding && !plan.localSufficient) {
        throw new GdexValidationError(`Only ${fmtUnits(plan.localUsdcRaw!, uDec)} USDC on this chain and bridging is off (autoFunding: false)`, 'amount');
      }
      const amountHuman = fmtUnits(amountRaw, uDec);
      const q = (await sdk.getUsdcTradeQuote({ ...creds(account), chainId: chain.id, tokenAddress: intent.tokenAddress, payAsset: 'usdc', amountInRaw: amountRaw, side: 'buy' })) as Record<string, unknown>;
      const outRaw = String(q.amountOutRaw ?? '');
      if (!/^\d+$/.test(outRaw) || outRaw === '0') throw new Error('No executable quote for this buy right now');
      const tokenDecimals = Number(q.tokenDecimals ?? 0);
      const minOutRaw = slipFloor(outRaw, slippagePct);
      const maxDebit = budget === 'total' || !autoFunding ? (budget === 'total' ? intent.amount : amountHuman) : fmtUnits(maxSourceSpendRaw, uDec);
      notionalUsd = Number(amountHuman);
      terms = {
        chainId: chain.id, tokenAddress: intent.tokenAddress, side: 'buy', payAsset: 'usdc',
        spendUsdc: amountHuman, spendRaw: amountRaw, budget, requestedUsdc: intent.amount,
        expectedOutRaw: outRaw, minOutRaw, tokenDecimals,
        expectedOut: formatUnits(outRaw, tokenDecimals), minOut: formatUnits(minOutRaw, tokenDecimals),
        slippagePct, quoteSource: q.source, quotedAt: q.quotedAt ?? now, fees: q.feeIncluded ? 'GDEX fee included in quote' : 'see quote',
        autoFunding, maxSourceSpendRaw, maxSourceSpendUsdc: fmtUnits(maxSourceSpendRaw, uDec),
        totalMaxSpendUsdc: maxDebit, fundingPlan: plan,
      };
      summary = budget === 'total'
        ? `Buy ${formatUnits(outRaw, tokenDecimals)} (min ${formatUnits(minOutRaw, tokenDecimals)}) of ${intent.tokenAddress} on ${USDC_TOKENS[chain.id]?.name ?? chain.id}. Total maximum spend: ${intent.amount} USDC, routing and gas included (trade ${amountHuman} USDC).`
        : `Buy ${formatUnits(outRaw, tokenDecimals)} (min ${formatUnits(minOutRaw, tokenDecimals)}) of ${intent.tokenAddress} for ${amountHuman} USDC on ${USDC_TOKENS[chain.id]?.name ?? chain.id}. Total maximum debit: ${maxDebit} USDC (trade plus any routing and gas; a signed cap, not a fee quote).`;
      if (plan.status === 'ok' && !plan.localSufficient) warnings.push(`Only ${fmtUnits(plan.localUsdcRaw!, uDec)} USDC is on this chain; GDEX will bridge the rest${plan.bridgeFrom ? ` from ${plan.bridgeFrom}` : ''} (~${fmtUnits(plan.routingCostRaw ?? '0', uDec)} USDC routing cost estimated).`);
      if (plan.status === 'ok' && plan.needsGas) warnings.push('No gas on this chain: GDEX tops it up from USDC as part of the funding, inside the cap above.');
      if (plan.status !== 'ok') warnings.push('Balances could not be read, so the funding route is unknown; the signed cap still bounds the debit.');
      if (budget === 'trade' && autoFunding) warnings.push(`To spend at most ${intent.amount} USDC in total instead, preview again with budget: "total".`);
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
  } else if (intent.kind === 'withdraw') {
    const wt = await withdrawTerms(deps, account, intent);
    terms = wt.terms; summary = wt.summary; warnings.push(...wt.warnings); notionalUsd = wt.notionalUsd;
    exit = 'A completed transfer cannot be reversed.';
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
  if (p.kind === 'withdraw') return { ok: false, reasons: ['Withdrawals always need the user to approve this exact preview (userApproved: true); a trading policy never covers them.'] };
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
      .filter((o) => o.createdAt > dayAgo && o.state !== 'failed' && (o.kind === 'spot' || o.kind === 'perp_open'))
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

  let account = await loadAccount(p.accountRef);
  const sdk = deps.sdk();
  const t = p.terms as Record<string, string & number & boolean>;

  // Revalidate: an expired or moved preview is re-quoted, never executed on old terms.
  const intentOf = (): TradeIntent =>
    p.kind === 'withdraw'
      ? { kind: 'withdraw', from: t.from as 'wallet' | 'hyperliquid', chain: t.chainId, asset: t.asset as 'usdc' | 'native', amount: t.amount, recipient: t.recipient }
    : p.kind === 'spot'
      ? { kind: 'spot', chain: t.chainId, tokenAddress: t.tokenAddress, side: t.side as 'buy' | 'sell', amount: t.side === 'buy' ? (t.budget === 'total' ? t.requestedUsdc : t.spendUsdc) : t.sellAmount, slippagePct: t.slippagePct, autoFunding: t.autoFunding, budget: t.budget as 'trade' | 'total' }
      : p.kind === 'perp_open'
        ? { kind: 'perp_open', coin: t.dex ? `${t.dex}:${String(t.coin).replace(/^.*:/, '')}` : t.coin, side: t.side as 'long' | 'short', notionalUsd: t.notionalUsd, leverage: t.leverage, orderType: t.orderType as 'market' | 'limit', ...(t.orderType === 'limit' ? { limitPrice: t.price } : {}), tpPrice: t.tpPrice || undefined, slPrice: t.slPrice || undefined }
        : { kind: 'perp_close', coin: t.coin, size: t.size, dex: t.dex || undefined };
  if (deps.now() > p.expiresAt) {
    return { status: 'revised', reason: 'Preview expired; review the fresh terms', preview: await previewTrade(deps, p.accountRef, intentOf()) };
  }
  if (p.kind === 'spot') {
    const quote = (a: StoredAccount) => sdk.getUsdcTradeQuote({ ...creds(a), chainId: t.chainId, tokenAddress: t.tokenAddress, payAsset: 'usdc', amountInRaw: t.side === 'buy' ? t.spendRaw : t.sellRaw, side: t.side as 'buy' | 'sell' });
    const fresh = (await quote(account).catch(async (err) => {
      if (!isSessionRejected(err)) throw err;
      account = await refresh(deps, account);
      return quote(account);
    })) as Record<string, unknown>;
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

  for (let attempt = 0; ; attempt++) {
  try {
    let res: Record<string, unknown>;
    if (p.kind === 'withdraw' && t.from === 'hyperliquid') {
      res = (await sdk.perpWithdraw({ ...creds(account), amount: t.amount })) as unknown as Record<string, unknown>;
    } else if (p.kind === 'withdraw') {
      const req = { recipient: t.recipient, amount: t.amountRaw, chainId: t.chainId, managed: { ...creds(account), userId: account.walletAddress } };
      res = (t.asset === 'usdc'
        ? await sdk.transferToken({ ...req, tokenAddress: t.tokenAddress })
        : await sdk.transferNative(req)) as Record<string, unknown>;
    } else if (p.kind === 'spot' && t.side === 'buy') {
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
    const state: OperationState = p.kind === 'withdraw'
      ? (res.isSuccess === false ? 'failed' : t.from === 'hyperliquid' ? 'accepted' : res.isSuccess === true && hash ? 'filled' : 'accepted')
      : status === 'success'
      ? 'filled'
      : status === 'failed' || res.isSuccess === false || order.isSuccess === false
        ? 'failed'
        : requestId || order.isSuccess === true ? 'accepted' : 'pending';
    op = await saveOp(op, state, { requestId, hash, detail: { ...(op.detail as object), response: res } }, undefined, deps.now());
    break;
  } catch (err) {
    // A session rejection happens before execution: refresh once and resubmit the same signed terms.
    if (attempt === 0 && isSessionRejected(err)) {
      account = await refresh(deps, account);
      op = await saveOp(op, 'submitting', {}, 'session rejected before execution; refreshed and resubmitting', deps.now());
      continue;
    }
    op = isUnknown(err)
      ? await saveOp(op, 'submission_unknown', { errorCode: 'SUBMISSION_UNKNOWN' }, (err as Error).message, deps.now())
      : await saveOp(op, 'failed', { errorCode: (err as { code?: string }).code ?? 'ERROR' }, (err as Error).message, deps.now());
    if (!isUnknown(err)) throw err;
    break;
  }
  }
  return { status: 'submitted', operation: op };
}

// ── Reconcile ──────────────────────────────────────────────────────────────

export async function reconcileOperation(deps: IntentDeps, opId: string, waitMs = 60_000): Promise<Operation> {
  let op = await readJson<Operation>('operations', opId);
  if (!op) throw new GdexValidationError(`Unknown opId ${opId}`, 'opId');
  if (isFinal(op)) return op;
  const current = op;
  return withSession(deps, op.accountRef, (account) => reconcileWith(deps, account, current, waitMs));
}

async function reconcileWith(deps: IntentDeps, account: StoredAccount, op: Operation, waitMs: number): Promise<Operation> {
  const sdk = deps.sdk();
  const p = op.previewId ? await readJson<Preview>('previews', op.previewId) : undefined;
  const t = (p?.terms ?? {}) as Record<string, string & number>;

  if (op.kind === 'funding') {
    const d = op.detail as { chainId: number };
    const deadline = deps.now() + waitMs;
    for (;;) {
      const row = (await chainBalances(deps, account)).find((c) => c.chainId === d.chainId && !c.error);
      if (!row) return saveOp(op, op.state, {}, 'Balance unavailable right now; still waiting (unknown, not failed)', deps.now());
      const prog = fundingProgress(op, row.usdcRaw, deps.now());
      if (prog.state === 'credited' || prog.state === 'expired' || deps.now() >= deadline) {
        if (prog.state === op.state && prog.state !== 'credited') return op;
        return saveOp(op, prog.state, prog.creditedRaw ? { detail: { ...(op.detail as object), creditedRaw: prog.creditedRaw } } : {}, prog.note, deps.now());
      }
      await (deps.sleep ?? sleep)(10_000);
    }
  }

  if (op.kind === 'withdraw') {
    const hash = op.hash ?? (op.detail as { response?: { hash?: string } })?.response?.hash;
    if (t.from !== 'hyperliquid') {
      return hash
        ? saveOp(op, 'filled', { hash }, `Sent: tx ${hash}`, deps.now())
        : saveOp(op, op.state, {}, 'No transaction hash recorded; check the wallet history before retrying. Do not resend blindly.', deps.now());
    }
    // Hyperliquid -> Arbitrum managed wallet: arrived once its USDC rose by about the amount after the fee.
    const deadline = deps.now() + waitMs;
    const want = BigInt(String(t.arbitrumBaselineRaw ?? '0')) + BigInt(Math.round(Number(t.arriving) * 1e6) - 100_000);
    for (;;) {
      const row = (await chainBalances(deps, account)).find((c) => c.chainId === 42161 && !c.error);
      if (row && BigInt(row.usdcRaw) >= want) return saveOp(op, 'filled', {}, `Arrived on the Arbitrum managed wallet (balance ${row.usdc} USDC)`, deps.now());
      if (deps.now() >= deadline) return saveOp(op, op.state, {}, 'Not on Arbitrum yet; Hyperliquid withdrawals usually take a few minutes. Still pending, not failed.', deps.now());
      await (deps.sleep ?? sleep)(10_000);
    }
  }

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
  const first = await positionsWith(deps, account, accountRef);
  if (!(first.sessionRejected as boolean)) return first;
  return positionsWith(deps, await refresh(deps, account), accountRef);
}

async function positionsWith(deps: IntentDeps, account: StoredAccount, accountRef: string): Promise<Record<string, unknown>> {
  const sdk = deps.sdk();
  let sessionRejected = false;
  const section = async (fn: () => Promise<unknown>) => {
    try { return { status: 'ok', asOf: deps.now(), data: await fn() }; } catch (e) {
      if (isSessionRejected(e)) sessionRejected = true;
      return { status: 'unavailable', error: (e as Error).message };
    }
  };
  const [usdc, perps, openOrders] = await Promise.all([
    section(() => sdk.getUsdcBalances(creds(account))),
    section(() => sdk.getHlClearinghouseStateAll(account.managed?.evm ?? account.walletAddress)),
    section(() => sdk.getHlOpenOrdersAllForCopy(account.managed?.evm ?? account.walletAddress)),
  ]);
  const ops = (await listOperations(accountRef)).filter((o) => !isFinal(o));
  const summary = await fundsSummary(deps, account, ops);
  return {
    accountRef, walletAddress: account.walletAddress, managedWallets: account.managed,
    summary,
    usdcWallet: usdc, perps, openOrders,
    pendingOperations: ops.map((o) => ({ opId: o.opId, kind: o.kind, state: o.state, notionalUsd: o.notionalUsd, createdAt: o.createdAt })),
    note: 'A section with status "unavailable" is unknown, not empty.',
    ...(sessionRejected ? { sessionRejected: true } : {}),
  };
}

// ── Sell half / all ────────────────────────────────────────────────────────

/** Resolve "all" / "half" / "25%" against the token actually held on that chain, in exact units. */
export async function resolveSellAmount(deps: IntentDeps, accountRef: string, chain: string | number, tokenAddress: string, spec: string): Promise<string> {
  if (/^\d+(\.\d+)?$/.test(spec)) return spec;
  const m = /^(all|half|(\d{1,3})%)$/.exec(spec);
  if (!m) throw new GdexValidationError('amount must be a token amount, "all", "half" or a percentage like "25%"', 'amount');
  const pct = m[1] === 'all' ? 100n : m[1] === 'half' ? 50n : BigInt(m[2]);
  if (pct <= 0n || pct > 100n) throw new GdexValidationError('percentage must be 1-100%', 'amount');
  const c = normalizeChain(chain);
  const rows = await withSession(deps, accountRef, (a) => deps.sdk().getBalances({ ...creds(a), chain: c.id as never, tokenAddress }));
  const row = rows.find((r) => r.tokenAddress.toLowerCase() === tokenAddress.toLowerCase());
  if (!row || !/^\d+$/.test(row.rawBalance) || BigInt(row.rawBalance) === 0n) throw new GdexValidationError('No balance of this token in the GDEX wallet on that chain', 'tokenAddress');
  const raw = (BigInt(row.rawBalance) * pct) / 100n;
  if (raw === 0n) throw new GdexValidationError('That share of the holding rounds to zero', 'amount');
  return formatUnits(raw.toString(), row.decimals);
}

// ── Add money ──────────────────────────────────────────────────────────────

/**
 * Start (or resume) adding money: returns where the money goes and how, and a
 * funding operation that reports credited only when the USDC is in the wallet.
 * A pending funding is resumed rather than inviting a second payment.
 */
export async function addFunds(deps: IntentDeps, accountRef: string, req: FundingRequest): Promise<Record<string, unknown>> {
  const pending = (await listOperations(accountRef)).find((o) => o.kind === 'funding' && !isFinal(o));
  if (pending && !req.newPayment) {
    const d = pending.detail as { method: 'apple_pay' | 'card' | 'crypto'; chainId: number; address: string; amountUsd?: string };
    return { resumed: true, operation: pending, ...fundingInstructions(d.method, d.chainId, d.address, d.amountUsd), next: `A funding is already pending. Follow it with gdex_operation { opId: "${pending.opId}" }; pass newPayment: true only if the user really wants a second payment.` };
  }
  if (req.amountUsd !== undefined) parseAmountUnits(req.amountUsd, 2, 'amountUsd');
  const chain = normalizeChain(req.chain ?? 'base');
  if (!USDC_TOKENS[chain.id]) throw new GdexValidationError('Funding lands in the USDC wallet: choose Ethereum, Optimism, BNB Chain, Sonic, Base, Arbitrum or Solana', 'chain');
  return withSession(deps, accountRef, async (account) => {
    const address = managedAddress(account, chain.id);
    const rows = await chainBalances(deps, account).catch((e: Error) => {
      if (isSessionRejected(e)) throw e;
      return [];
    });
    const row = rows.find((c) => c.chainId === chain.id && !c.error);
    if (!row) throw new Error('The wallet balance cannot be read right now, so arrival could not be confirmed; retry shortly before paying');
    const op = newFundingOperation(deps, accountRef, req, chain.id, address, row.usdcRaw);
    await writeJson('operations', op.opId, op);
    return {
      operation: op,
      ...fundingInstructions(req.method, chain.id, address, req.amountUsd),
      next: `Give the user the steps above. Then follow arrival with gdex_operation { opId: "${op.opId}", waitSec: 120 }; it reports credited once the USDC is in the wallet. Funding never authorizes a trade.`,
    };
  });
}

export { SOLANA_CHAIN_ID };
