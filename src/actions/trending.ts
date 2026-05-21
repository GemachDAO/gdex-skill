/**
 * Paid trending-slot promotion actions.
 *
 * Backed by:
 *   GET  /v1/trending/list
 *   GET  /v1/trending/options
 *   POST /v1/trending/register
 *   GET  /v1/trending/booking_status
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import { validateRequired } from '../utils/validation';

export interface TrendingListParams {
  chain?: string | number;
  limit?: number;
}

export interface TrendingRegisterParams {
  tokenAddress: string;
  chain: string | number;
  /** Trending slot tier / package id */
  slot?: string | number;
  /** Booking duration in hours */
  durationHours?: number;
  /** User wallet (control address) */
  userId: string;
  /** Encrypted session data, when required by backend */
  data?: string;
  /** Pre-built encrypted computedData when payment is via managed custody */
  computedData?: string;
}

export interface TrendingBookingStatusParams {
  /** Booking id returned from register */
  bookingId?: string;
  /** Or query by token + chain */
  tokenAddress?: string;
  chain?: string | number;
}

/** List currently promoted / booked trending tokens. */
export async function getTrendingList(
  client: GdexApiClient,
  params: TrendingListParams = {},
): Promise<Record<string, unknown>> {
  const q: Record<string, unknown> = {};
  if (params.chain !== undefined) q.chain = params.chain;
  if (params.limit !== undefined) q.limit = params.limit;
  return client.get(Endpoints.TRENDING_LIST, q);
}

/** List available trending-slot packages and prices. */
export async function getTrendingOptions(
  client: GdexApiClient,
): Promise<Record<string, unknown>> {
  return client.get(Endpoints.TRENDING_OPTIONS);
}

/** Register / pay for a trending slot. */
export async function registerTrending(
  client: GdexApiClient,
  params: TrendingRegisterParams,
): Promise<Record<string, unknown>> {
  validateRequired(params.tokenAddress, 'tokenAddress');
  validateRequired(params.userId, 'userId');
  return client.post(Endpoints.TRENDING_REGISTER, params);
}

/** Check booking status (pending payment, active, expired). */
export async function getTrendingBookingStatus(
  client: GdexApiClient,
  params: TrendingBookingStatusParams = {},
): Promise<Record<string, unknown>> {
  return client.get(Endpoints.TRENDING_BOOKING_STATUS, { ...params });
}
