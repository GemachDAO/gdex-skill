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

export interface OutcomesListParams {
  /** Optional perp-dex identifier (HIP-3 dex) */
  dex?: string;
  /** Optional filter by status */
  status?: 'open' | 'resolved' | string;
}

export interface OutcomeAccountParams {
  /** EVM wallet address */
  userAddress: string;
  /** Optional perp-dex identifier */
  dex?: string;
}

/** Encrypted-payload write request. Caller builds `computedData`. */
export interface OutcomeOrderRequest {
  computedData: string;
  /** Optional perp-dex identifier */
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

/** Get account state for a wallet on the outcomes perp dex. */
export async function getHlOutcomeAccount(
  client: GdexApiClient,
  params: OutcomeAccountParams,
): Promise<Record<string, unknown>> {
  validateRequired(params.userAddress, 'userAddress');
  const q: Record<string, unknown> = { address: params.userAddress };
  if (params.dex) q.dex = params.dex;
  return client.get(Endpoints.HL_OUTCOME_ACCOUNT, q);
}

/** Create an order on an outcome market. */
export async function createHlOutcomeOrder(
  client: GdexApiClient,
  req: OutcomeOrderRequest,
): Promise<Record<string, unknown>> {
  validateRequired(req.computedData, 'computedData');
  return client.post(Endpoints.HL_OUTCOME_CREATE_ORDER, req);
}

/** Cancel an open outcome-market order. */
export async function cancelHlOutcomeOrder(
  client: GdexApiClient,
  req: OutcomeOrderRequest,
): Promise<Record<string, unknown>> {
  validateRequired(req.computedData, 'computedData');
  return client.post(Endpoints.HL_OUTCOME_CANCEL_ORDER, req);
}

/** Close an open outcome-market position. */
export async function closeHlOutcomeOrder(
  client: GdexApiClient,
  req: OutcomeOrderRequest,
): Promise<Record<string, unknown>> {
  validateRequired(req.computedData, 'computedData');
  return client.post(Endpoints.HL_OUTCOME_CLOSE_ORDER, req);
}
