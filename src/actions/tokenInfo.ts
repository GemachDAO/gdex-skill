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
  OHLCVCandle,
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

  // Backend returns { tokens: [...] } — unwrap to first token
  const resp = await client.get<{ tokens: TokenDetails[] }>(Endpoints.TOKEN_DETAILS, {
    ...buildTokenAliases(params.tokenAddress),
    ...buildChainAliases(params.chain),
  });
  const tokens = resp?.tokens;
  if (Array.isArray(tokens) && tokens.length > 0) return tokens[0];
  return resp as unknown as TokenDetails;
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

  // Backend returns { isSuccess, trendingTokens: [...] } — unwrap
  const resp = await client.get<{ isSuccess?: boolean; trendingTokens?: TrendingToken[] }>(Endpoints.TRENDING, queryParams);
  if (resp && typeof resp === 'object' && 'trendingTokens' in resp) {
    return resp.trendingTokens ?? [];
  }
  // Fallback if backend returns a flat array
  return Array.isArray(resp) ? resp : [];
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

  // Backend returns { data: OHLCVCandle[] } — normalize into OHLCVData
  const resp = await client.get<{ data?: OHLCVCandle[] }>(Endpoints.OHLCV, queryParams);
  return {
    tokenAddress: params.tokenAddress,
    chain: params.chain,
    resolution: params.resolution,
    candles: resp?.data ?? [],
  };
}
