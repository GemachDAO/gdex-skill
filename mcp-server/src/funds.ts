/**
 * Flow of funds for the agent: where the account's money is, whether it can
 * trade, adding money (Apple Pay / card via the site's provider, or a crypto
 * deposit) and withdrawing it again.
 *
 * Source trace (2026-10-20, TheArcadiaGroup repos):
 * - gdex.pro "Buy crypto" (gbotTradingDashboardUI DepositModal/QuickDepositSection/
 *   ModalUser/transfer-funds, BuyCryptoModal) opens Meld's public page
 *   `https://meldcrypto.com/?destinationCurrencyCode=<native>&walletAddress=<managed wallet>`
 *   in a popup. The wallet is `/v1/user` `address`: the managed wallet, the same
 *   one this server resolves. The backend has no on-ramp session, quote or webhook.
 * - Meld's public page does not apply those parameters without a Meld partner
 *   key (it opens on "buy BTC" with an empty wallet field), so the destination
 *   cannot be locked from here. Credit is therefore detected by watching the
 *   bound managed wallet's balance, never from a provider "success" screen.
 * - USDC token registry mirrors gbotTradingDashboardBackend src/shared/usdc/registry.ts.
 */
import { randomUUID } from 'crypto';
import { GdexValidationError, normalizeChain, parseAmountUnits } from '@gemachdao/gdex-skill';
import type { StoredAccount } from './credentials.js';
import type { IntentDeps, Operation } from './intent.js';

export const USDC_TOKENS: Record<number, { address: string; decimals: number; name: string; meld: string }> = {
  1: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, name: 'Ethereum', meld: 'USDC' },
  10: { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6, name: 'Optimism', meld: 'USDC_OPTIMISM' },
  56: { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18, name: 'BNB Chain', meld: 'USDC_BSC' },
  146: { address: '0x29219dd400f2Bf60E5a23d13Be72B486D4038894', decimals: 6, name: 'Sonic', meld: 'USDC_SONIC' },
  8453: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, name: 'Base', meld: 'USDC_BASE' },
  42161: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6, name: 'Arbitrum', meld: 'USDC_ARBITRUM' },
  622112261: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, name: 'Solana', meld: 'USDC_SOLANA' },
};

const SOLANA = 622112261;
/** Hyperliquid's withdrawal fee, deducted from the amount (observed live 2026-10-19: withdraw 20 -> +19 on Arbitrum). */
const HL_WITHDRAW_FEE_USDC = 1;
const FUNDING_TTL_MS = 48 * 3600_000;
const MELD_URL = 'https://meldcrypto.com/';

type Section<T> = { status: 'ok'; asOf: number; data: T } | { status: 'unavailable'; error: string };

interface ChainRow { chainId: number; usdc: string; usdcRaw: string; native: string; nativeSymbol: string; nativeUsd: string; error?: string }

function creds(a: StoredAccount) {
  return { apiKey: a.apiKey, walletAddress: a.walletAddress, sessionPrivateKey: a.sessionPrivateKey };
}

export function managedAddress(a: StoredAccount, chainId: number): string {
  const addr = chainId === SOLANA ? a.managed?.solana : a.managed?.evm;
  if (!addr) throw new GdexValidationError(`No managed ${chainId === SOLANA ? 'Solana' : 'EVM'} wallet on this account; reconnect with gdex_connect`, 'accountRef');
  return addr;
}

async function section<T>(deps: IntentDeps, fn: () => Promise<T>): Promise<Section<T>> {
  try {
    return { status: 'ok', asOf: deps.now(), data: await fn() };
  } catch (e) {
    return { status: 'unavailable', error: (e as Error).message };
  }
}

export async function chainBalances(deps: IntentDeps, a: StoredAccount): Promise<ChainRow[]> {
  const res = (await deps.sdk().getUsdcBalances(creds(a))) as { chains?: ChainRow[] };
  if (!Array.isArray(res?.chains)) throw new Error('USDC balances response had no chains');
  return res.chains;
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// ── Summary ────────────────────────────────────────────────────────────────

export async function fundsSummary(deps: IntentDeps, a: StoredAccount, pendingOps: Operation[]): Promise<Record<string, unknown>> {
  const evm = a.managed?.evm ?? a.walletAddress;
  const [chains, perp, spot] = await Promise.all([
    section(deps, () => chainBalances(deps, a)),
    section(deps, () => deps.hlInfo({ type: 'clearinghouseState', user: evm }) as Promise<Record<string, any>>),
    section(deps, () => deps.hlInfo({ type: 'spotClearinghouseState', user: evm }) as Promise<Record<string, any>>),
  ]);

  const byChain = chains.status === 'ok'
    ? chains.data.filter((c) => !c.error).map((c) => ({
        chain: USDC_TOKENS[c.chainId]?.name ?? String(c.chainId), chainId: c.chainId, usdc: c.usdc,
        gas: `${c.native} ${c.nativeSymbol}`, gasUsd: Number(num(c.nativeUsd).toFixed(2)),
        address: c.chainId === SOLANA ? a.managed?.solana : evm,
      }))
    : undefined;
  const chainErrors = chains.status === 'ok' ? chains.data.filter((c) => c.error).map((c) => ({ chainId: c.chainId, error: c.error })) : [];
  const walletUsdc = byChain?.reduce((s, c) => s + num(c.usdc), 0);

  let hl: Record<string, unknown> | undefined;
  if (perp.status === 'ok' && spot.status === 'ok') {
    const bal = (spot.data.balances ?? []) as Array<{ coin: string; total: string; hold: string }>;
    const usdc = bal.find((b) => b.coin === 'USDC');
    const outcomes = bal.filter((b) => b.coin.startsWith('+') && num(b.total) > 0);
    const marginUsed = num(perp.data.marginSummary?.totalMarginUsed);
    const positions = (perp.data.assetPositions ?? []).length;
    const free = Math.max(0, num(usdc?.total) - num(usdc?.hold) - marginUsed);
    hl = {
      usdc: usdc?.total ?? '0', onHold: usdc?.hold ?? '0', perpMarginUsed: marginUsed.toFixed(2),
      perpNotional: num(perp.data.marginSummary?.totalNtlPos).toFixed(2), perpPositions: positions,
      outcomeContracts: outcomes.map((o) => ({ coin: o.coin, size: o.total })),
      freeUsdcEstimate: free.toFixed(2),
      note: 'Unified Hyperliquid account: spot USDC is also perp collateral. Core-perp positions and outcome contracts only; builder-DEX positions are in gdex_positions.',
    };
  }

  const pending = pendingOps.map((o) => ({ opId: o.opId, kind: o.kind, state: o.state, notionalUsd: o.notionalUsd }));
  return {
    asOf: deps.now(),
    cash: byChain
      ? { status: 'ok', usdcTotal: walletUsdc!.toFixed(2), byChain, ...(chainErrors.length ? { unreadChains: chainErrors } : {}) }
      : { status: 'unavailable', error: (chains as { error: string }).error },
    hyperliquid: hl ? { status: 'ok', ...hl } : { status: 'unavailable', error: perp.status !== 'ok' ? perp.error : (spot as { error: string }).error },
    inPositions: hl
      ? { perpMarginUsd: hl.perpMarginUsed, perpNotionalUsd: hl.perpNotional, outcomeContracts: (hl.outcomeContracts as unknown[]).length, spotTokens: 'not counted here; see get_portfolio per chain' }
      : { status: 'unavailable' },
    pending,
    availableToWithdraw: {
      wallets: byChain ? byChain.filter((c) => num(c.usdc) > 0).map((c) => ({ chain: c.chain, usdc: c.usdc, needsGas: c.chainId !== SOLANA && c.gasUsd === 0 })) : 'unavailable',
      hyperliquid: hl ? { usdcEstimate: hl.freeUsdcEstimate, fee: `${HL_WITHDRAW_FEE_USDC} USDC`, arrivesOn: 'Arbitrum managed wallet' } : 'unavailable',
      note: 'Money in open positions, on hold for orders or pending is not withdrawable until released.',
    },
    note: 'A section with status "unavailable" is unknown, not zero.',
  };
}

// ── Readiness ──────────────────────────────────────────────────────────────

export type Readiness = 'funded' | 'unfunded' | 'funding_pending' | 'unreachable';

export function readinessOf(summary: Record<string, any>, pendingOps: Operation[]): { state: Readiness; next: string } {
  const cash = summary.cash, hl = summary.hyperliquid;
  const funding = pendingOps.find((o) => o.kind === 'funding');
  if (funding) return { state: 'funding_pending', next: `Money is on its way (operation ${funding.opId}): follow it with gdex_operation { opId: "${funding.opId}" } instead of paying again.` };
  if (cash.status !== 'ok' && hl.status !== 'ok') return { state: 'unreachable', next: 'Balances could not be read right now; retry gdex_status shortly. This is unknown, not zero.' };
  const usable = (cash.status === 'ok' ? num(cash.usdcTotal) : 0) + (hl.status === 'ok' ? num(hl.freeUsdcEstimate) : 0)
    + (cash.status === 'ok' ? (cash.byChain as Array<{ gasUsd: number }>).reduce((s, c) => s + c.gasUsd, 0) : 0);
  if (usable > 0) return { state: 'funded', next: 'Ready to trade: gdex_preview_trade, then gdex_execute_trade after the user approves.' };
  const partial = cash.status !== 'ok' || hl.status !== 'ok';
  return {
    state: 'unfunded',
    next: `No usable funds found${partial ? ' in the sections that could be read' : ''}. Add money: gdex_add_funds { method: "apple_pay" | "card" | "crypto" }.`,
  };
}

// ── Add money ──────────────────────────────────────────────────────────────

export type FundingMethod = 'apple_pay' | 'card' | 'crypto';

export interface FundingRequest {
  method: FundingMethod;
  /** Where the money should land; default Base (USDC wallet, low gas). */
  chain?: string | number;
  /** What the user intends to add, in USD (informational; the provider sets the charge). */
  amountUsd?: string;
  /** Start a second funding although one is pending. */
  newPayment?: boolean;
}

export function fundingInstructions(method: FundingMethod, chainId: number, address: string, amountUsd?: string): Record<string, unknown> {
  const u = USDC_TOKENS[chainId];
  const destination = { network: u.name, chainId, asset: 'USDC', tokenAddress: u.address, address };
  if (method === 'crypto') {
    return {
      destination,
      steps: [`Send USDC on ${u.name} only, to ${address}.`, 'Other networks or tokens sent to this address may not be recoverable.'],
    };
  }
  const url = `${MELD_URL}?destinationCurrencyCode=${u.meld}&walletAddress=${address}${amountUsd ? `&sourceAmount=${amountUsd}&sourceCurrencyCode=USD` : ''}`;
  return {
    destination,
    checkout: {
      provider: 'Meld (the same provider gdex.pro uses)',
      url,
      paymentMethod: method === 'apple_pay' ? 'Apple Pay (offered on supported devices and regions)' : 'Credit or debit card',
      steps: [
        `In the checkout, choose to receive "USDC" on "${u.name}".`,
        `Paste this wallet address exactly: ${address}`,
        amountUsd ? `Enter the amount you want to pay (${amountUsd} USD) and review the quote: it shows the card charge, provider fees and the USDC you receive.` : 'Enter the amount and review the quote: it shows the card charge, provider fees and the USDC you receive.',
        method === 'apple_pay' ? 'Pick Apple Pay and confirm on your device.' : 'Pay with your card.',
      ],
      limitations: [
        'The provider sets the charge, fees, minimum and any identity check; GDEX does not see card or Apple Pay details.',
        'The checkout does not lock the destination yet: double-check the network (USDC on the network above) and the address before paying.',
        'A provider "success" screen is not credit: this operation reports credited only once the USDC is in the wallet.',
      ],
    },
  };
}

export function newFundingOperation(deps: IntentDeps, accountRef: string, req: FundingRequest, chainId: number, address: string, baselineRaw: string): Operation {
  const now = deps.now();
  return {
    opId: `op_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    previewId: '', accountRef, kind: 'funding', state: 'awaiting_user', notionalUsd: 0,
    createdAt: now, updatedAt: now,
    detail: { method: req.method, chainId, address, asset: 'USDC', baselineRaw, amountUsd: req.amountUsd, expiresAt: now + FUNDING_TTL_MS },
    history: [{ at: now, state: 'awaiting_user', note: `${req.method} funding to ${address} on chain ${chainId}; baseline ${baselineRaw} raw USDC` }],
  };
}

/** Credit = the bound wallet's USDC rose above the baseline taken when funding started. */
export function fundingProgress(op: Operation, currentRaw: string, now: number): { state: Operation['state']; note: string; creditedRaw?: string } {
  const d = op.detail as { baselineRaw: string; expiresAt: number; chainId: number };
  const dec = USDC_TOKENS[d.chainId]?.decimals ?? 6;
  const delta = BigInt(currentRaw) - BigInt(d.baselineRaw);
  if (delta > 0n) return { state: 'credited', note: `Credited ${formatUnits(delta.toString(), dec)} USDC to the wallet`, creditedRaw: delta.toString() };
  if (now > d.expiresAt) return { state: 'expired', note: 'No USDC arrived within 48h. If you paid, check the provider receipt; a late delivery still lands in the same wallet.' };
  return { state: op.state === 'awaiting_user' ? 'awaiting_user' : 'delivering', note: 'Waiting for USDC to arrive in the wallet (nothing credited yet). Do not pay again.' };
}

export function formatUnits(raw: string, decimals: number): string {
  const neg = raw.startsWith('-');
  const s = (neg ? raw.slice(1) : raw).padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, '');
  return `${neg ? '-' : ''}${frac ? `${whole}.${frac}` : whole}`;
}

// ── Withdraw ───────────────────────────────────────────────────────────────

export interface WithdrawIntent {
  kind: 'withdraw';
  /** 'wallet' = a managed chain wallet; 'hyperliquid' = Hyperliquid USDC (lands on the Arbitrum managed wallet). */
  from: 'wallet' | 'hyperliquid';
  chain?: string | number;
  asset?: 'usdc' | 'native';
  /** Human amount, or "all" (USDC only). */
  amount: string;
  /** External destination; required for wallet withdrawals, never inferred. */
  recipient?: string;
}

export function validateRecipient(recipient: string | undefined, chainId: number): string {
  if (!recipient) throw new GdexValidationError('recipient is required: ask the user for the destination address; never guess it', 'recipient');
  const ok = chainId === SOLANA ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(recipient) : /^0x[0-9a-fA-F]{40}$/.test(recipient);
  if (!ok) throw new GdexValidationError(`recipient is not a valid ${chainId === SOLANA ? 'Solana' : 'EVM'} address`, 'recipient');
  return recipient;
}

export async function withdrawTerms(deps: IntentDeps, a: StoredAccount, w: WithdrawIntent): Promise<{ terms: Record<string, unknown>; summary: string; warnings: string[]; notionalUsd: number }> {
  if (w.from === 'hyperliquid') {
    if (w.recipient) throw new GdexValidationError('Hyperliquid withdrawals land on your Arbitrum managed wallet; withdraw from there to an external address as a second step', 'recipient');
    const evm = managedAddress(a, 42161);
    const spot = (await deps.hlInfo({ type: 'spotClearinghouseState', user: evm })) as { balances?: Array<{ coin: string; total: string; hold: string }> };
    const perp = (await deps.hlInfo({ type: 'clearinghouseState', user: evm })) as { marginSummary?: { totalMarginUsed?: string } };
    const usdc = spot.balances?.find((b) => b.coin === 'USDC');
    if (!usdc) throw new Error('Hyperliquid balance unavailable; cannot size the withdrawal');
    const free = Math.max(0, num(usdc.total) - num(usdc.hold) - num(perp.marginSummary?.totalMarginUsed));
    const amount = w.amount === 'all' ? (Math.floor(free * 10) / 10).toFixed(1) : w.amount;
    parseAmountUnits(amount, 1, 'amount');
    if (num(amount) <= HL_WITHDRAW_FEE_USDC) throw new GdexValidationError(`Amount must exceed the ${HL_WITHDRAW_FEE_USDC} USDC Hyperliquid fee`, 'amount');
    if (num(amount) > free + 1e-9) throw new GdexValidationError(`Only ~${free.toFixed(2)} USDC is free on Hyperliquid (the rest is margin or on hold)`, 'amount');
    const baseline = (await chainBalances(deps, a)).find((c) => c.chainId === 42161)?.usdcRaw ?? '0';
    return {
      terms: { from: 'hyperliquid', amount, fee: String(HL_WITHDRAW_FEE_USDC), arriving: (num(amount) - HL_WITHDRAW_FEE_USDC).toFixed(1), destination: evm, network: 'Arbitrum', asset: 'USDC', arbitrumBaselineRaw: baseline },
      summary: `Withdraw ${amount} USDC from Hyperliquid; ~${(num(amount) - HL_WITHDRAW_FEE_USDC).toFixed(1)} USDC arrives on your Arbitrum managed wallet ${evm} after the ${HL_WITHDRAW_FEE_USDC} USDC fee (usually a few minutes)`,
      warnings: ['This moves money from Hyperliquid to your GDEX Arbitrum wallet, not to an external wallet or bank.'],
      notionalUsd: num(amount),
    };
  }
  if (w.chain === undefined) throw new GdexValidationError('chain is required for a wallet withdrawal', 'chain');
  const chain = normalizeChain(w.chain);
  const u = USDC_TOKENS[chain.id];
  const asset = w.asset ?? 'usdc';
  if (asset === 'usdc' && !u) throw new GdexValidationError('No USDC wallet on this chain', 'chain');
  const recipient = validateRecipient(w.recipient, chain.id);
  const from = managedAddress(a, chain.id);
  if (recipient.toLowerCase() === from.toLowerCase()) throw new GdexValidationError('recipient is the managed wallet itself', 'recipient');
  const row = (await chainBalances(deps, a)).find((c) => c.chainId === chain.id);
  if (!row || row.error) throw new Error(`Balance on chain ${chain.id} unavailable; cannot size the withdrawal`);
  const warnings: string[] = [];
  let amountRaw: string, amount: string, decimals: number, tokenAddress: string | undefined;
  if (asset === 'usdc') {
    decimals = u.decimals; tokenAddress = u.address;
    amountRaw = w.amount === 'all' ? row.usdcRaw : parseAmountUnits(w.amount, decimals, 'amount').toString();
    amount = formatUnits(amountRaw, decimals);
    if (BigInt(amountRaw) <= 0n) throw new GdexValidationError('Nothing to withdraw', 'amount');
    if (BigInt(amountRaw) > BigInt(row.usdcRaw)) throw new GdexValidationError(`Only ${row.usdc} USDC on ${u.name}`, 'amount');
    if (chain.id !== SOLANA && num(row.native) === 0) throw new GdexValidationError(`No ${row.nativeSymbol} for gas on ${u.name}: the transfer would fail. Add a little ${row.nativeSymbol} first.`, 'chain');
    warnings.push(`Network gas is paid in ${row.nativeSymbol} from the managed wallet (current gas balance ${row.native} ${row.nativeSymbol}).`);
  } else {
    if (w.amount === 'all') throw new GdexValidationError('Give an exact native amount; "all" would leave nothing for gas', 'amount');
    decimals = chain.id === SOLANA ? 9 : 18;
    amountRaw = parseAmountUnits(w.amount, decimals, 'amount').toString();
    amount = w.amount;
    if (num(amount) >= num(row.native)) throw new GdexValidationError(`Only ${row.native} ${row.nativeSymbol}; leave some for gas`, 'amount');
  }
  const symbol = asset === 'usdc' ? 'USDC' : row.nativeSymbol;
  return {
    terms: { from: 'wallet', chainId: chain.id, network: chain.id === SOLANA ? 'Solana' : (u?.name ?? String(chain.id)), asset, symbol, tokenAddress, amount, amountRaw, decimals, fromAddress: from, recipient },
    summary: `Withdraw ${amount} ${symbol} on ${u?.name ?? chain.id} from ${from} to ${recipient}`,
    warnings: [...warnings, 'Check the destination: transfers cannot be reversed. Only send to an address on this same network.'],
    notionalUsd: asset === 'usdc' ? num(amount) : num(row.nativeUsd) * (num(amount) / Math.max(num(row.native), 1e-18)),
  };
}
