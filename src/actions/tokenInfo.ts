/**
 * Token information actions — details, trending, OHLCV.
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import {
  TokenDetails,
  TokenDetailsParams,
  TrendingToken,
  TrendingParams,
  OHLCVData,
  OHLCVParams,
} from '../types/token';
import { validateChain, validateRequired } from '../utils/validation';
import { buildChainAliases, buildTokenAliases } from '../utils/apiAliases';

/**
 * Get detailed information about a specific token.
 *
 * This endpoint is whitelisted on the backend (no auth required).
 *
 * @param client - API client
 * @param params - Token details parameters
 */
export async function getTokenDetails(
  client: GdexApiClient,
  params: TokenDetailsParams
): Promise<TokenDetails> {
  validateRequired(params.tokenAddress, 'tokenAddress');
  validateChain(params.chain);

  return client.get<TokenDetails>(Endpoints.TOKEN_DETAILS, {
    ...buildTokenAliases(params.tokenAddress),
    ...buildChainAliases(params.chain),
  });
}

/**
 * Get trending tokens across all chains or a specific chain.
 *
 * @param client - API client
 * @param params - Trending query parameters
 */
export async function getTrendingTokens(
  client: GdexApiClient,
  params: TrendingParams = {}
): Promise<TrendingToken[]> {
  if (params.chain !== undefined) validateChain(params.chain);

  const queryParams: Record<string, unknown> = {};

  Object.assign(queryParams, buildChainAliases(params.chain));
  if (params.period) queryParams.period = params.period;
  if (params.limit) queryParams.limit = params.limit;
  if (params.minLiquidity) queryParams.minLiquidity = params.minLiquidity;
  if (params.minVolume) queryParams.minVolume = params.minVolume;

  return client.get<TrendingToken[]>(Endpoints.TRENDING, queryParams);
}

/**
 * Get OHLCV candlestick data for a token.
 *
 * This endpoint is whitelisted on the backend (no auth required).
 *
 * @param client - API client
 * @param params - OHLCV query parameters
 */
export async function getOHLCV(client: GdexApiClient, params: OHLCVParams): Promise<OHLCVData> {
  validateRequired(params.tokenAddress, 'tokenAddress');
  validateChain(params.chain);
  validateRequired(params.resolution, 'resolution');

  const queryParams: Record<string, unknown> = {
    ...buildTokenAliases(params.tokenAddress),
    ...buildChainAliases(params.chain),
    resolution: params.resolution,
  };

  if (params.from) queryParams.from = params.from;
  if (params.to) queryParams.to = params.to;
  if (params.limit) queryParams.limit = params.limit;

  return client.get<OHLCVData>(Endpoints.OHLCV, queryParams);
}
