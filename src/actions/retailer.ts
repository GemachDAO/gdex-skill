/**
 * Retailer (partner-branded onboarding) actions.
 *
 * Backed by:
 *   GET /v1/retailer
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';

export interface RetailerListParams {
  /** Optional retailer identifier or slug to filter on */
  retailer?: string;
}

/** List registered retailer integrations / branded onboarding partners. */
export async function getRetailers(
  client: GdexApiClient,
  params: RetailerListParams = {},
): Promise<Record<string, unknown>> {
  return client.get(Endpoints.RETAILER_LIST, { ...params });
}
