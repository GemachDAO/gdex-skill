/**
 * Extended HyperLiquid actions — HIP-3 enablement, collateral swaps, builder
 * referrals, and per-user copy-PnL history.
 *
 * Backed by:
 *   POST /v1/hl/enable_trading
 *   POST /v1/hl/swap_collateral
 *   GET  /v1/hl/builder_referral
 *   GET  /v1/hl/list_user_copy_pnl
 *   GET  /v1/hl/tx_list
 *   GET  /v1/hl/positions
 *   GET  /v1/hl/account_state
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import { validateRequired } from '../utils/validation';
import { buildHlComputedData } from '../utils/gdexManagedCrypto';

/** Managed-custody credentials (control wallet address from sign-in). */
export interface HlManagedCreds {
  apiKey: string;
  walletAddress: string;
  sessionPrivateKey: string;
}

export interface HlEnableTradingRequest {
  /** Pre-built encrypted computedData payload */
  computedData: string;
}

export type HlEnableTradingParams = HlEnableTradingRequest | HlManagedCreds;

export interface HlSwapCollateralRequest {
  /** Pre-built encrypted computedData payload */
  computedData: string;
  /** Optional source / destination perp dex identifiers */
  fromDex?: string;
  toDex?: string;
}

export interface HlSwapCollateralStructured extends HlManagedCreds {
  /** Source token/dex identifier the backend expects (e.g. 'USDC'). */
  fromToken: string;
  /** Destination token/dex identifier. */
  toToken: string;
  /** Amount to move (string units the backend expects). */
  amount: string;
  fromDex?: string;
  toDex?: string;
}

export interface HlBuilderReferralParams {
  /** EVM wallet address */
  userAddress: string;
}

export interface HlListUserCopyPnlParams {
  /** EVM wallet address (control or managed) */
  userAddress: string;
  page?: number;
  limit?: number;
}

export interface HlTxListParams {
  /** EVM wallet address */
  userAddress: string;
  page?: number;
  limit?: number;
  /** Optional perp dex filter for HIP-3 multi-dex deployments */
  dex?: string;
}

export interface HlReadByAddressParams {
  /** EVM wallet address */
  userAddress: string;
  /** Optional perp dex filter for HIP-3 multi-dex deployments */
  dex?: string;
}

/**
 * Enable trading on HyperLiquid (one-time approval / builder code) for a
 * managed wallet. Required before the wallet can place orders via builder
 * routing.
 */
export async function hlEnableTrading(
  client: GdexApiClient,
  req: HlEnableTradingParams,
): Promise<Record<string, unknown>> {
  if ('computedData' in req) {
    return client.post(Endpoints.HL_ENABLE_TRADING, req);
  }
  validateRequired(req.walletAddress, 'walletAddress');
  const computedData = buildHlComputedData({
    action: 'hl_enable_trading',
    apiKey: req.apiKey,
    walletAddress: req.walletAddress,
    sessionPrivateKey: req.sessionPrivateKey,
    actionParams: {},
  });
  return client.post(Endpoints.HL_ENABLE_TRADING, { computedData });
}

/**
 * Swap collateral between perp DEXes (HIP-3) — moves USDC between the default
 * HyperLiquid clearinghouse and a HIP-3 deployment.
 */
export async function hlSwapCollateral(
  client: GdexApiClient,
  req: HlSwapCollateralRequest | HlSwapCollateralStructured,
): Promise<Record<string, unknown>> {
  if ('computedData' in req) {
    return client.post(Endpoints.HL_SWAP_COLLATERAL, req);
  }
  validateRequired(req.walletAddress, 'walletAddress');
  const computedData = buildHlComputedData({
    action: 'hl_swap_token',
    apiKey: req.apiKey,
    walletAddress: req.walletAddress,
    sessionPrivateKey: req.sessionPrivateKey,
    actionParams: { fromToken: req.fromToken, toToken: req.toToken, amount: req.amount },
  });
  return client.post(Endpoints.HL_SWAP_COLLATERAL, { computedData, fromDex: req.fromDex, toDex: req.toDex });
}

/** Get builder-referral metadata for a wallet (earned, eligibility). */
export async function getHlBuilderReferral(
  client: GdexApiClient,
  params: HlBuilderReferralParams,
): Promise<Record<string, unknown>> {
  validateRequired(params.userAddress, 'userAddress');
  return client.get(Endpoints.HL_BUILDER_REFERRAL, { address: params.userAddress });
}

/** Get realised PnL history for the wallet's copy-trading activity. */
export async function getHlListUserCopyPnl(
  client: GdexApiClient,
  params: HlListUserCopyPnlParams,
): Promise<Record<string, unknown>> {
  validateRequired(params.userAddress, 'userAddress');
  const q: Record<string, unknown> = { address: params.userAddress };
  if (params.page !== undefined) q.page = params.page;
  if (params.limit !== undefined) q.limit = params.limit;
  return client.get(Endpoints.HL_LIST_USER_COPY_PNL, q);
}

/** Get HL transaction list (fills / orders history). */
export async function getHlTxList(
  client: GdexApiClient,
  params: HlTxListParams,
): Promise<Record<string, unknown>> {
  validateRequired(params.userAddress, 'userAddress');
  const q: Record<string, unknown> = { address: params.userAddress };
  if (params.page !== undefined) q.page = params.page;
  if (params.limit !== undefined) q.limit = params.limit;
  if (params.dex) q.dex = params.dex;
  return client.get(Endpoints.HL_TX_LIST, q);
}

/** Get positions via backend convenience endpoint (mirrors clearinghouse). */
export async function getHlPositionsByAddress(
  client: GdexApiClient,
  params: HlReadByAddressParams,
): Promise<Record<string, unknown>> {
  validateRequired(params.userAddress, 'userAddress');
  const q: Record<string, unknown> = { address: params.userAddress };
  if (params.dex) q.dex = params.dex;
  return client.get(Endpoints.HL_POSITIONS, q);
}

/** Get account state via backend convenience endpoint. */
export async function getHlAccountStateByAddress(
  client: GdexApiClient,
  params: HlReadByAddressParams,
): Promise<Record<string, unknown>> {
  validateRequired(params.userAddress, 'userAddress');
  const q: Record<string, unknown> = { address: params.userAddress };
  if (params.dex) q.dex = params.dex;
  return client.get(Endpoints.HL_ACCOUNT_STATE, q);
}
