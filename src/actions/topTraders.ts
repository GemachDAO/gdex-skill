/**
 * Top traders action — fetch and analyze top performing wallets.
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import { TopTrader, TopTradersParams } from '../types';
import { validateChain } from '../utils/validation';

/**
 * Get top performing traders across chains.
 *
 * @param client - API client
 * @param params - Query parameters
 */
export async function getTopTraders(
  client: GdexApiClient,
  params: TopTradersParams = {}
): Promise<TopTrader[]> {
  if (params.chain !== undefined) validateChain(params.chain);

  const queryParams: Record<string, unknown> = {};

  if (params.chain !== undefined) queryParams.chain = params.chain;
  if (params.period) queryParams.period = params.period;
  if (params.limit) queryParams.limit = params.limit;
  if (params.sortBy) queryParams.sortBy = params.sortBy;

  return client.get<TopTrader[]>(Endpoints.TOP_TRADERS, queryParams);
}
