/**
 * Transfer actions — native and ERC20/SPL token transfers via managed custody.
 *
 * Backed by:
 *   POST /v1/transfer        — native token transfer
 *   POST /v1/transfer_token  — ERC20 / SPL token transfer
 *
 * Both endpoints accept encrypted `computedData` matching the standard managed
 * custody contract. Because the backend's exact ABI schemas for transfer
 * actions are not yet documented at the SDK level, these wrappers accept a
 * pre-built `computedData` string built by the caller (e.g. via the existing
 * `buildEncryptedGdexPayload` helper or a forthcoming `transfer` ABI encoder).
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import { validateRequired } from '../utils/validation';

/** Request payload for a managed-custody transfer (native or token). */
export interface TransferRequest {
  /** Pre-built encrypted computedData payload */
  computedData: string;
  /** Optional chain identifier hint for the backend router */
  chainId?: number | string;
}

/** Generic transfer response. */
export interface TransferResponse extends Record<string, unknown> {
  /** Async request id for polling /trade-status/:requestId, when async */
  requestId?: string;
  /** Status string (e.g. 'pending', 'success') */
  status?: string;
  /** Resulting transaction hash, when synchronous */
  txHash?: string;
}

/**
 * Transfer the native asset (ETH, SOL, SUI, BNB, …) to a recipient.
 *
 * @param client - Authenticated API client
 * @param req - Request containing pre-built `computedData`
 */
export async function transferNative(
  client: GdexApiClient,
  req: TransferRequest,
): Promise<TransferResponse> {
  validateRequired(req.computedData, 'computedData');
  return client.post<TransferResponse>(Endpoints.TRANSFER_NATIVE, req);
}

/**
 * Transfer an ERC20 / SPL token to a recipient.
 *
 * @param client - Authenticated API client
 * @param req - Request containing pre-built `computedData`
 */
export async function transferToken(
  client: GdexApiClient,
  req: TransferRequest,
): Promise<TransferResponse> {
  validateRequired(req.computedData, 'computedData');
  return client.post<TransferResponse>(Endpoints.TRANSFER_TOKEN, req);
}
