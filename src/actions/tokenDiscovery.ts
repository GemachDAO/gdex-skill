/**
 * Extended token discovery actions — newest, top, big-buys, livestream,
 * xStocks (tokenised equities), Zora tokens, recent trades, and the
 * server-rendered token social-card image.
 *
 * Backed by:
 *   GET /v1/newest
 *   GET /v1/top_tokens
 *   GET /v1/bigbuys/:chainId
 *   GET /v1/currently_live
 *   GET /v1/live_status/:address
 *   GET /v1/xstocks
 *   GET /v1/zora
 *   GET /v1/token_trades
 *   GET /v1/token/token_image
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import { validateRequired } from '../utils/validation';
import { buildChainAliases, buildTokenAliases } from '../utils/apiAliases';
import type { SupportedChain } from '../types/common';

export interface TokenListParams {
  chain?: SupportedChain;
  limit?: number;
  page?: number;
}

export interface BigBuysParams {
  /** Chain id used in the path (e.g. 622112261 for Solana) */
  chainId: number | string;
  limit?: number;
}

export interface LiveStatusParams {
  /** Token mint / contract address */
  address: string;
}

export interface TokenTradesParams {
  tokenAddress: string;
  chain: SupportedChain;
  limit?: number;
  page?: number;
}

export interface TokenImageParams {
  tokenAddress: string;
  chain: SupportedChain;
}

function listQuery(params: TokenListParams): Record<string, unknown> {
  const q: Record<string, unknown> = { ...buildChainAliases(params.chain) };
  if (params.limit !== undefined) q.limit = params.limit;
  if (params.page !== undefined) q.page = params.page;
  return q;
}

/** Newest tokens across all chains (or a specific chain). */
export async function getNewestTokens(
  client: GdexApiClient,
  params: TokenListParams = {},
): Promise<Record<string, unknown>> {
  return client.get(Endpoints.TOKEN_NEWEST, listQuery(params));
}

/** Top tokens by volume / market cap. */
export async function getTopTokens(
  client: GdexApiClient,
  params: TokenListParams = {},
): Promise<Record<string, unknown>> {
  return client.get(Endpoints.TOKEN_TOP_TOKENS, listQuery(params));
}

/** "Big buy" alert feed for a chain — recent large buy transactions. */
export async function getBigBuys(
  client: GdexApiClient,
  params: BigBuysParams,
): Promise<Record<string, unknown>> {
  validateRequired(String(params.chainId), 'chainId');
  const q: Record<string, unknown> = {};
  if (params.limit !== undefined) q.limit = params.limit;
  return client.get(Endpoints.tokenBigBuysPath(params.chainId), q);
}

/** Currently-livestreaming token launches. */
export async function getCurrentlyLiveTokens(
  client: GdexApiClient,
  params: TokenListParams = {},
): Promise<Record<string, unknown>> {
  return client.get(Endpoints.TOKEN_CURRENTLY_LIVE, listQuery(params));
}

/** Livestream status for a single token address. */
export async function getLiveStatus(
  client: GdexApiClient,
  params: LiveStatusParams,
): Promise<Record<string, unknown>> {
  validateRequired(params.address, 'address');
  return client.get(Endpoints.tokenLiveStatusPath(params.address));
}

/** xStocks (tokenised equities) listing. */
export async function getXstocks(
  client: GdexApiClient,
  params: TokenListParams = {},
): Promise<Record<string, unknown>> {
  return client.get(Endpoints.TOKEN_XSTOCKS, listQuery(params));
}

/** Zora-protocol tokens listing. */
export async function getZoraTokens(
  client: GdexApiClient,
  params: TokenListParams = {},
): Promise<Record<string, unknown>> {
  return client.get(Endpoints.TOKEN_ZORA, listQuery(params));
}

/** Recent trades for a specific token. */
export async function getTokenTrades(
  client: GdexApiClient,
  params: TokenTradesParams,
): Promise<Record<string, unknown>> {
  validateRequired(params.tokenAddress, 'tokenAddress');
  const q: Record<string, unknown> = {
    ...buildTokenAliases(params.tokenAddress),
    ...buildChainAliases(params.chain),
  };
  if (params.limit !== undefined) q.limit = params.limit;
  if (params.page !== undefined) q.page = params.page;
  return client.get(Endpoints.TOKEN_TRADES, q);
}

/**
 * Get a URL / metadata for the server-rendered token social-card image.
 *
 * Note: the underlying endpoint may return either a redirect to a PNG asset
 * or a JSON wrapper depending on Accept header — callers should inspect
 * the response shape.
 */
export async function getTokenImage(
  client: GdexApiClient,
  params: TokenImageParams,
): Promise<Record<string, unknown>> {
  validateRequired(params.tokenAddress, 'tokenAddress');
  return client.get(Endpoints.TOKEN_IMAGE, {
    ...buildTokenAliases(params.tokenAddress),
    ...buildChainAliases(params.chain),
  });
}
