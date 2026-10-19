/**
 * Unified USDC wallet actions.
 *
 * Backed by gbotTradingDashboardBackend `src/api/usdc.ts` (feat-unified-usdc,
 * PR #329). A user's USDC across Ethereum, Optimism, BSC, Sonic, Base,
 * Arbitrum and Solana is one balance: buys can be paid in USDC (or the chain's
 * native token) and the backend bridges USDC in from other chains when the
 * target chain is short (`autoBridge`), bounded by a signed source budget.
 *
 * Writes are v2 signed actions (`computedData`, chain bound in the signature).
 * Reads take `userId` + encrypted session `data`, both derived here from the
 * managed credentials.
 *
 * Amounts are RAW integer strings: USDC is 6 decimals everywhere except BSC
 * (18); native is 18 on EVM and 9 on Solana. Robinhood Chain (USDG) and
 * Fraxtal have no USDC.
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import { buildGdexReadSessionData, buildUsdcComputedData } from '../utils/gdexManagedCrypto';
import { validateRequired } from '../utils/validation';
import type { HlManagedCredentials } from '../types/perp';

/** Managed-custody credentials (same shape as the HyperLiquid actions). */
export type UsdcCredentials = HlManagedCredentials;

/** Generic USDC route response; the backend adds fields additively. */
export type UsdcResponse = Record<string, unknown>;

/** One chain's row of `GET /v1/usdc/balances`. */
export interface UsdcChainBalance {
  chainId: number;
  usdc: string;
  usdcRaw: string;
  usdcUsd: string;
  native: string;
  nativeSymbol: string;
  nativeUsd: string;
  error?: string;
}

/** `GET /v1/usdc/balances` response. */
export interface UsdcBalancesResponse {
  asOf: number;
  totalUsdc: string;
  totalUsd: string;
  chains: UsdcChainBalance[];
}

/**
 * Response of a signed trade. `status: 'pending'` with a `requestId` means the
 * backend is funding (bridging) or confirming it: poll `getUsdcFundingStatus`.
 */
export interface UsdcTradeResult extends Record<string, unknown> {
  status?: string;
  requestId?: string;
  tradeId?: string;
  hash?: string;
}

function readQuery(creds: UsdcCredentials): { userId: string; data: string } {
  validateRequired(creds.apiKey, 'apiKey');
  validateRequired(creds.walletAddress, 'walletAddress');
  validateRequired(creds.sessionPrivateKey, 'sessionPrivateKey');
  return {
    userId: creds.walletAddress,
    data: buildGdexReadSessionData(creds.sessionPrivateKey, creds.apiKey),
  };
}

function isPositiveRaw(raw: string | undefined): raw is string {
  return typeof raw === 'string' && /^[0-9]+$/.test(raw) && BigInt(raw) > 0n;
}

function requireRaw(raw: string | undefined, name: string): string {
  if (!isPositiveRaw(raw)) throw new Error(`${name} must be a positive integer amount in raw units`);
  return raw;
}

/**
 * The source budget signed for automatic funding, as gdex.pro derives it:
 * `ceil(amountRaw * 1.2)` (20% headroom for bridge and gas fees), in the
 * target chain's units. With auto-bridge off the signed budget is `0`.
 */
export function deriveMaxSourceSpendRaw(amountRaw: string): string {
  return ((BigInt(amountRaw) * 6n + 4n) / 5n).toString();
}

function signedBudget(amountRaw: string, autoBridge: boolean, explicit?: string): string {
  if (!autoBridge) return '0';
  if (explicit !== undefined) return requireRaw(explicit, 'maxSourceSpendRaw');
  return deriveMaxSourceSpendRaw(amountRaw);
}

// ── Reads ─────────────────────────────────────────────────────────────────

/** Cross-chain USDC and native balances of the user's managed wallets. */
export async function getUsdcBalances(
  client: GdexApiClient,
  creds: UsdcCredentials,
): Promise<UsdcBalancesResponse> {
  return client.get<UsdcBalancesResponse>(Endpoints.USDC_BALANCES, readQuery(creds));
}

export interface UsdcTradeQuoteParams extends UsdcCredentials {
  chainId: number;
  tokenAddress: string;
  /** What the user pays with on a buy: `usdc` or the chain's `native` token. */
  payAsset: 'usdc' | 'native';
  /** Raw amount in: USDC/native on a buy, token units on a sell. */
  amountInRaw: string;
  side?: 'buy' | 'sell';
}

/** Executable quote: `{ amountOutRaw, source }`. Use it to set the minimum out. */
export async function getUsdcTradeQuote(
  client: GdexApiClient,
  params: UsdcTradeQuoteParams,
): Promise<UsdcResponse> {
  validateRequired(params.tokenAddress, 'tokenAddress');
  return client.get<UsdcResponse>(Endpoints.USDC_TRADE_QUOTE, {
    ...readQuery(params),
    chainId: String(params.chainId),
    tokenAddress: params.tokenAddress,
    payAsset: params.payAsset,
    amountInRaw: requireRaw(params.amountInRaw, 'amountInRaw'),
    ...(params.side ? { side: params.side } : {}),
  });
}

/** Status of a USDC trade or funding request (`requestId` from a trade). */
export async function getUsdcFundingStatus(
  client: GdexApiClient,
  params: UsdcCredentials & { requestId: string },
): Promise<UsdcResponse> {
  validateRequired(params.requestId, 'requestId');
  return client.get<UsdcResponse>(Endpoints.USDC_FUNDING_STATUS, {
    ...readQuery(params),
    id: params.requestId,
  });
}

/** Status of a deferred (auto-bridged) trade, by `tradeId`. */
export async function getUsdcDeferredTrade(
  client: GdexApiClient,
  params: UsdcCredentials & { tradeId: string },
): Promise<UsdcResponse> {
  validateRequired(params.tradeId, 'tradeId');
  return client.get<UsdcResponse>(Endpoints.USDC_TRADE_DEFERRED, {
    ...readQuery(params),
    id: params.tradeId,
  });
}

/**
 * Pending USDC trades on a chain. Check this before resubmitting a trade whose
 * outcome is unknown: a pending entry means do NOT submit again.
 */
export async function getUsdcPendingTrades(
  client: GdexApiClient,
  params: UsdcCredentials & { chainId: number },
): Promise<UsdcResponse> {
  return client.get<UsdcResponse>(Endpoints.USDC_TRADE_PENDING, {
    ...readQuery(params),
    chainId: String(params.chainId),
  });
}

/**
 * Quote converting native gas token to USDC. `amount` is a raw native amount
 * or `max` (convert everything above the chain's gas reserve).
 */
export async function getUsdcConvertQuote(
  client: GdexApiClient,
  params: UsdcCredentials & { chainId: number; amount: string },
): Promise<UsdcResponse> {
  if (params.amount !== 'max') requireRaw(params.amount, 'amount');
  return client.get<UsdcResponse>(Endpoints.USDC_CONVERT_QUOTE, {
    ...readQuery(params),
    chainId: String(params.chainId),
    amount: params.amount,
  });
}

/** Status of a USDC bridge. `refresh` polls the bridge provider once. */
export async function getUsdcBridgeStatus(
  client: GdexApiClient,
  params: UsdcCredentials & { bridgeId: string; refresh?: boolean },
): Promise<UsdcResponse> {
  validateRequired(params.bridgeId, 'bridgeId');
  return client.get<UsdcResponse>(Endpoints.USDC_BRIDGE_STATUS, {
    ...readQuery(params),
    id: params.bridgeId,
    ...(params.refresh ? { refresh: 'true' } : {}),
  });
}

/** The user's USDC bridge history. */
export async function getUsdcBridgeOrders(
  client: GdexApiClient,
  creds: UsdcCredentials,
): Promise<UsdcResponse> {
  return client.get<UsdcResponse>(Endpoints.USDC_BRIDGE_ORDERS, readQuery(creds));
}

// ── Trades ────────────────────────────────────────────────────────────────

export interface UsdcBuyParams extends UsdcCredentials {
  chainId: number;
  tokenAddress: string;
  /** Raw USDC to spend, in the target chain's USDC decimals. */
  usdcAmountRaw: string;
  /** Minimum token out (raw). Derive from `getUsdcTradeQuote` minus slippage. */
  minTokenOutRaw: string;
  /** Let the backend bridge USDC from other chains if this chain is short (default true). */
  autoBridge?: boolean;
  /** Signed cap on total source spend for funding; default `ceil(amount * 1.2)`. */
  maxSourceSpendRaw?: string;
}

/** Buy a token paying with USDC (`purchase_usdc_v2`). */
export async function buyWithUsdc(
  client: GdexApiClient,
  params: UsdcBuyParams,
): Promise<UsdcTradeResult> {
  validateRequired(params.tokenAddress, 'tokenAddress');
  const amount = requireRaw(params.usdcAmountRaw, 'usdcAmountRaw');
  const autoBridge = params.autoBridge ?? true;
  const computedData = buildUsdcComputedData({
    action: 'purchase_usdc_v2',
    ...params,
    values: [
      params.chainId,
      params.tokenAddress,
      amount,
      requireRaw(params.minTokenOutRaw, 'minTokenOutRaw'),
      autoBridge,
      signedBudget(amount, autoBridge, params.maxSourceSpendRaw),
    ],
  });
  return client.post<UsdcTradeResult>(Endpoints.USDC_TRADE_PURCHASE, { computedData, chainId: params.chainId });
}

export interface UsdcSellParams extends UsdcCredentials {
  chainId: number;
  tokenAddress: string;
  /** Raw token amount to sell. */
  tokenAmountRaw: string;
  /** Minimum USDC out (raw, target chain USDC decimals). */
  minUsdcOutRaw: string;
  autoBridge?: boolean;
  maxSourceSpendRaw?: string;
}

/** Sell a token and receive USDC (`sell_usdc_v2`). */
export async function sellToUsdc(
  client: GdexApiClient,
  params: UsdcSellParams,
): Promise<UsdcTradeResult> {
  validateRequired(params.tokenAddress, 'tokenAddress');
  const amount = requireRaw(params.tokenAmountRaw, 'tokenAmountRaw');
  const autoBridge = params.autoBridge ?? false;
  const computedData = buildUsdcComputedData({
    action: 'sell_usdc_v2',
    ...params,
    values: [
      params.chainId,
      params.tokenAddress,
      amount,
      requireRaw(params.minUsdcOutRaw, 'minUsdcOutRaw'),
      autoBridge,
      signedBudget(amount, autoBridge, params.maxSourceSpendRaw),
    ],
  });
  return client.post<UsdcTradeResult>(Endpoints.USDC_TRADE_SELL, { computedData, chainId: params.chainId });
}

export interface UsdcNativeBuyParams extends UsdcCredentials {
  chainId: number;
  tokenAddress: string;
  /** Raw native amount to spend (18 decimals EVM, 9 Solana). */
  nativeAmountRaw: string;
  minTokenOutRaw: string;
  autoBridge?: boolean;
  maxSourceSpendRaw?: string;
}

/** Buy a token paying with the chain's native token, with optional auto-funding (`purchase_native_v2`). */
export async function buyWithNative(
  client: GdexApiClient,
  params: UsdcNativeBuyParams,
): Promise<UsdcTradeResult> {
  validateRequired(params.tokenAddress, 'tokenAddress');
  const amount = requireRaw(params.nativeAmountRaw, 'nativeAmountRaw');
  const autoBridge = params.autoBridge ?? true;
  const computedData = buildUsdcComputedData({
    action: 'purchase_native_v2',
    ...params,
    values: [
      params.chainId,
      params.tokenAddress,
      amount,
      requireRaw(params.minTokenOutRaw, 'minTokenOutRaw'),
      autoBridge,
      signedBudget(amount, autoBridge, params.maxSourceSpendRaw),
    ],
  });
  return client.post<UsdcTradeResult>(Endpoints.USDC_TRADE_PURCHASE_NATIVE, { computedData, chainId: params.chainId });
}

export interface UsdcRetrySellParams extends UsdcCredentials {
  chainId: number;
  /** The original sell's requestId. */
  requestId: string;
  /** `retry.retryId` from `getUsdcFundingStatus`. */
  retryId: string;
  tokenAddress: string;
  tokenAmountRaw: string;
  minUsdcOutRaw: string;
  /** `retry.transactionNonce` from `getUsdcFundingStatus` (EVM nonce to reuse). */
  transactionNonce: number;
}

/**
 * Retry a stuck USDC sell in place, reusing its transaction nonce so it can't
 * execute twice. Only valid when `getUsdcFundingStatus` returns a `retry` capability.
 */
export async function retryUsdcSell(
  client: GdexApiClient,
  params: UsdcRetrySellParams,
): Promise<UsdcTradeResult> {
  validateRequired(params.requestId, 'requestId');
  validateRequired(params.retryId, 'retryId');
  const computedData = buildUsdcComputedData({
    action: 'retry_sell_usdc',
    ...params,
    values: [
      params.chainId,
      params.requestId,
      params.retryId,
      params.tokenAddress,
      requireRaw(params.tokenAmountRaw, 'tokenAmountRaw'),
      requireRaw(params.minUsdcOutRaw, 'minUsdcOutRaw'),
      params.transactionNonce,
    ],
  });
  return client.post<UsdcTradeResult>(Endpoints.USDC_TRADE_RETRY_SELL, { computedData, chainId: params.chainId });
}

export interface UsdcConvertParams extends UsdcCredentials {
  chainId: number;
  /** Raw native amount to convert (see `getUsdcConvertQuote` for the gas reserve). */
  nativeAmountRaw: string;
  /** Minimum USDC out (raw). */
  minUsdcOutRaw: string;
}

/** Convert native gas token to USDC, keeping a per-chain gas reserve (`convert_native_usdc_v2`). */
export async function convertNativeToUsdc(
  client: GdexApiClient,
  params: UsdcConvertParams,
): Promise<UsdcResponse> {
  const computedData = buildUsdcComputedData({
    action: 'convert_native_usdc_v2',
    ...params,
    values: [
      params.chainId,
      requireRaw(params.nativeAmountRaw, 'nativeAmountRaw'),
      requireRaw(params.minUsdcOutRaw, 'minUsdcOutRaw'),
    ],
  });
  return client.post<UsdcResponse>(Endpoints.USDC_CONVERT, { computedData, chainId: params.chainId });
}

// ── Bridge ────────────────────────────────────────────────────────────────

export interface UsdcBridgeParams extends UsdcCredentials {
  fromChainId: number;
  toChainId: number;
  /** Raw USDC to DELIVER on `toChainId`, in destination USDC decimals. */
  amountRaw: string;
  /** Also deliver some destination gas. */
  gasTopUp?: boolean;
  /** Gas top-up in USD, (0, 50]. Only with `gasTopUp`. */
  gasTopUpAmountUsd?: number;
}

function gasTopUpMicroUsd(params: UsdcBridgeParams): string {
  if (!params.gasTopUp || params.gasTopUpAmountUsd === undefined) return '0';
  const usd = params.gasTopUpAmountUsd;
  if (!Number.isFinite(usd) || usd <= 0 || usd > 50) throw new Error('gasTopUpAmountUsd must be in (0, 50]');
  return String(Math.round(usd * 1_000_000));
}

/** Quote a USDC bridge (Relay). The response's `fromAmountRaw` is the source spend. */
export async function estimateUsdcBridge(
  client: GdexApiClient,
  params: UsdcBridgeParams,
): Promise<UsdcResponse> {
  const gasTopUp = Boolean(params.gasTopUp);
  gasTopUpMicroUsd(params);
  const computedData = buildUsdcComputedData({
    action: 'usdc_bridge_estimate',
    ...params,
    values: [params.fromChainId, params.toChainId, requireRaw(params.amountRaw, 'amountRaw'), gasTopUp],
  });
  return client.post<UsdcResponse>(Endpoints.USDC_BRIDGE_ESTIMATE, {
    computedData,
    chainId: params.fromChainId,
    ...(gasTopUp && params.gasTopUpAmountUsd !== undefined ? { gasTopUpAmountUsd: params.gasTopUpAmountUsd } : {}),
  });
}

export interface UsdcBridgeExecuteParams extends UsdcBridgeParams {
  /**
   * Signed maximum source spend (raw, source decimals). Take `fromAmountRaw`
   * from `estimateUsdcBridge` plus a small headroom; the backend refuses a
   * fresh quote above it (`EXCEEDS_SIGNED_MAX`).
   */
  maxFromAmountRaw: string;
}

/** Execute a USDC bridge (`usdc_bridge_execute_v2`). Poll `getUsdcBridgeStatus` with the returned id. */
export async function executeUsdcBridge(
  client: GdexApiClient,
  params: UsdcBridgeExecuteParams,
): Promise<UsdcResponse> {
  const computedData = buildUsdcComputedData({
    action: 'usdc_bridge_execute_v2',
    ...params,
    values: [
      params.fromChainId,
      params.toChainId,
      requireRaw(params.amountRaw, 'amountRaw'),
      Boolean(params.gasTopUp),
      gasTopUpMicroUsd(params),
      requireRaw(params.maxFromAmountRaw, 'maxFromAmountRaw'),
    ],
  });
  return client.post<UsdcResponse>(Endpoints.USDC_BRIDGE_EXECUTE, { computedData });
}
