/**
 * HyperLiquid referral actions (distinct from copy trading).
 *
 * Backed by:
 *   GET  /v1/hl_ref/info
 *   POST /v1/hl_ref/request_claim
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import { validateRequired } from '../utils/validation';

export interface HlReferralInfoParams {
  /** EVM wallet address */
  userAddress: string;
}

/** Encrypted-payload claim request. Caller builds `computedData`. */
export interface HlReferralClaimRequest {
  computedData: string;
}

/** Get HyperLiquid referral info (earned amount, eligibility, code). */
export async function getHlReferralInfo(
  client: GdexApiClient,
  params: HlReferralInfoParams,
): Promise<Record<string, unknown>> {
  validateRequired(params.userAddress, 'userAddress');
  return client.get(Endpoints.HL_REF_INFO, { address: params.userAddress });
}

/** Submit a claim request for accrued HL referral rewards. */
export async function requestHlReferralClaim(
  client: GdexApiClient,
  req: HlReferralClaimRequest,
): Promise<Record<string, unknown>> {
  validateRequired(req.computedData, 'computedData');
  return client.post(Endpoints.HL_REF_REQUEST_CLAIM, req);
}
