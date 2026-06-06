/**
 * HyperLiquid HIP-3 outcome / event-market actions.
 *
 * HIP-3 enables permissioned perp DEXes for prediction-market style outcomes
 * (event markets with discrete outcomes rather than continuous prices).
 *
 * Backed by:
 *   GET  /v1/hl/outcomes
 *   GET  /v1/hl/outcome_account
 *   POST /v1/hl/outcome/create_order
 *   POST /v1/hl/outcome/cancel_order
 *   POST /v1/hl/outcome/close_order
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import { validateRequired } from '../utils/validation';
import { buildHlComputedData } from '../utils/gdexManagedCrypto';

export interface OutcomesListParams {
  /** Optional perp-dex identifier (HIP-3 dex) */
  dex?: string;
  /** Optional filter by status */
  status?: 'open' | 'resolved' | string;
}

export interface OutcomeAccountParams {
  /** EVM wallet address */
  userAddress: string;
  /** Outcome market id the account is queried against (backend requires it) */
  outcomeId: string | number;
}

/** Managed-custody credentials for outcome write operations. */
export interface OutcomeManagedCreds {
  apiKey: string;
  /** CONTROL wallet address from sign-in (NOT the managed address). */
  walletAddress: string;
  sessionPrivateKey: string;
}

export interface CreateOutcomeOrderParams extends OutcomeManagedCreds {
  outcomeId: string | number;
  /** Outcome asset id within the market (from the outcome's coin list). */
  coin: string;
  isBuy: boolean;
  /** Limit price in [0,1]; ignored when isMarket is true (pass '0'). */
  price: string;
  /** Order size in contracts. */
  size: string;
  reduceOnly?: boolean;
  isMarket?: boolean;
  dex?: string;
}

export interface CancelOutcomeOrderParams extends OutcomeManagedCreds {
  outcomeId: string | number;
  coin: string;
  orderId: string;
  dex?: string;
}

export interface CloseOutcomeOrderParams extends OutcomeManagedCreds {
  outcomeId: string | number;
  coin: string;
  price: string;
  size: string;
  isMarket?: boolean;
  dex?: string;
}

/** Pre-built encrypted-payload write request (advanced callers). */
export interface OutcomeOrderRequest {
  computedData: string;
  dex?: string;
}

/** List available outcome markets. */
export async function getHlOutcomes(
  client: GdexApiClient,
  params: OutcomesListParams = {},
): Promise<Record<string, unknown>> {
  const q: Record<string, unknown> = {};
  if (params.dex) q.dex = params.dex;
  if (params.status) q.status = params.status;
  return client.get(Endpoints.HL_OUTCOMES, q);
}

/** Get account state for a wallet on a specific outcome market. */
export async function getHlOutcomeAccount(
  client: GdexApiClient,
  params: OutcomeAccountParams,
): Promise<Record<string, unknown>> {
  validateRequired(params.userAddress, 'userAddress');
  validateRequired(params.outcomeId, 'outcomeId');
  return client.get(Endpoints.HL_OUTCOME_ACCOUNT, {
    address: params.userAddress,
    outcomeId: String(params.outcomeId),
  });
}

function isPrebuilt(req: unknown): req is OutcomeOrderRequest {
  return typeof (req as OutcomeOrderRequest).computedData === 'string';
}

/** Create an order on an outcome market. */
export async function createHlOutcomeOrder(
  client: GdexApiClient,
  req: CreateOutcomeOrderParams | OutcomeOrderRequest,
): Promise<Record<string, unknown>> {
  if (isPrebuilt(req)) {
    return client.post(Endpoints.HL_OUTCOME_CREATE_ORDER, req);
  }
  validateRequired(req.walletAddress, 'walletAddress');
  validateRequired(req.coin, 'coin');
  const computedData = buildHlComputedData({
    action: 'hl_outcome_create_order',
    apiKey: req.apiKey,
    walletAddress: req.walletAddress,
    sessionPrivateKey: req.sessionPrivateKey,
    actionParams: {
      outcomeId: String(req.outcomeId),
      coin: req.coin,
      isBuy: req.isBuy,
      price: req.price,
      size: req.size,
      reduceOnly: req.reduceOnly ?? false,
      isMarket: req.isMarket ?? false,
    },
  });
  return client.post(Endpoints.HL_OUTCOME_CREATE_ORDER, { computedData, dex: req.dex });
}

/** Cancel an open outcome-market order. */
export async function cancelHlOutcomeOrder(
  client: GdexApiClient,
  req: CancelOutcomeOrderParams | OutcomeOrderRequest,
): Promise<Record<string, unknown>> {
  if (isPrebuilt(req)) {
    return client.post(Endpoints.HL_OUTCOME_CANCEL_ORDER, req);
  }
  validateRequired(req.walletAddress, 'walletAddress');
  validateRequired(req.orderId, 'orderId');
  const computedData = buildHlComputedData({
    action: 'hl_outcome_cancel_order',
    apiKey: req.apiKey,
    walletAddress: req.walletAddress,
    sessionPrivateKey: req.sessionPrivateKey,
    actionParams: { outcomeId: String(req.outcomeId), coin: req.coin, orderId: req.orderId },
  });
  return client.post(Endpoints.HL_OUTCOME_CANCEL_ORDER, { computedData, dex: req.dex });
}

/** Close an open outcome-market position. */
export async function closeHlOutcomeOrder(
  client: GdexApiClient,
  req: CloseOutcomeOrderParams | OutcomeOrderRequest,
): Promise<Record<string, unknown>> {
  if (isPrebuilt(req)) {
    return client.post(Endpoints.HL_OUTCOME_CLOSE_ORDER, req);
  }
  validateRequired(req.walletAddress, 'walletAddress');
  const computedData = buildHlComputedData({
    action: 'hl_outcome_close_order',
    apiKey: req.apiKey,
    walletAddress: req.walletAddress,
    sessionPrivateKey: req.sessionPrivateKey,
    actionParams: {
      outcomeId: String(req.outcomeId),
      coin: req.coin,
      price: req.price,
      size: req.size,
      isMarket: req.isMarket ?? false,
    },
  });
  return client.post(Endpoints.HL_OUTCOME_CLOSE_ORDER, { computedData, dex: req.dex });
}
