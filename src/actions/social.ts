/**
 * Social / community actions — comments, sentiment voting, watchlist,
 * and user-imported custom tokens.
 *
 * Backed by:
 *   POST /v1/add_comment
 *   GET  /v1/comments
 *   POST /v1/vote_sentiment
 *   GET  /v1/watch_list
 *   POST /v1/change_watch_list
 *   POST /v1/import_token
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import { validateRequired } from '../utils/validation';

export interface CommentItem extends Record<string, unknown> {
  _id?: string;
  userId?: string;
  tokenAddress?: string;
  chain?: string | number;
  message?: string;
  createdAt?: string | number;
}

export interface AddCommentParams {
  /** Token to comment on (address) */
  tokenAddress: string;
  /** Chain identifier */
  chain: string | number;
  /** Comment text */
  message: string;
  /** User wallet (control address) */
  userId: string;
  /** Encrypted session data (`data` param) */
  data?: string;
}

export interface GetCommentsParams {
  tokenAddress: string;
  chain: string | number;
  page?: number;
  limit?: number;
}

export interface VoteSentimentParams {
  tokenAddress: string;
  chain: string | number;
  /** 'bullish' | 'bearish' (or backend-specific value) */
  sentiment: 'bullish' | 'bearish' | string;
  userId: string;
  data?: string;
}

export interface WatchListItem extends Record<string, unknown> {
  tokenAddress: string;
  chain: string | number;
}

export interface ChangeWatchListParams {
  tokenAddress: string;
  chain: string | number;
  /** Whether to add or remove the token from the watchlist */
  action: 'add' | 'remove';
  userId: string;
  data?: string;
}

export interface GetWatchListParams {
  userId: string;
  data?: string;
}

export interface ImportTokenParams {
  tokenAddress: string;
  chain: string | number;
  symbol?: string;
  name?: string;
  decimals?: number;
  userId: string;
  data?: string;
}

/** Post a comment on a token. */
export async function addComment(
  client: GdexApiClient,
  params: AddCommentParams,
): Promise<Record<string, unknown>> {
  validateRequired(params.tokenAddress, 'tokenAddress');
  validateRequired(params.message, 'message');
  validateRequired(params.userId, 'userId');
  return client.post(Endpoints.ADD_COMMENT, params);
}

/** Fetch comments for a token. */
export async function getComments(
  client: GdexApiClient,
  params: GetCommentsParams,
): Promise<CommentItem[]> {
  validateRequired(params.tokenAddress, 'tokenAddress');
  const resp = await client.get<{ comments?: CommentItem[] } | CommentItem[]>(
    Endpoints.COMMENTS,
    { ...params },
  );
  if (Array.isArray(resp)) return resp;
  return resp?.comments ?? [];
}

/** Cast a bullish/bearish sentiment vote on a token. */
export async function voteSentiment(
  client: GdexApiClient,
  params: VoteSentimentParams,
): Promise<Record<string, unknown>> {
  validateRequired(params.tokenAddress, 'tokenAddress');
  validateRequired(params.sentiment, 'sentiment');
  validateRequired(params.userId, 'userId');
  return client.post(Endpoints.VOTE_SENTIMENT, params);
}

/** Fetch the user's watchlist. */
export async function getWatchList(
  client: GdexApiClient,
  params: GetWatchListParams,
): Promise<WatchListItem[]> {
  validateRequired(params.userId, 'userId');
  const resp = await client.get<{ watchList?: WatchListItem[] } | WatchListItem[]>(
    Endpoints.WATCH_LIST,
    { ...params },
  );
  if (Array.isArray(resp)) return resp;
  return resp?.watchList ?? [];
}

/** Add or remove a token from the user's watchlist. */
export async function changeWatchList(
  client: GdexApiClient,
  params: ChangeWatchListParams,
): Promise<Record<string, unknown>> {
  validateRequired(params.tokenAddress, 'tokenAddress');
  validateRequired(params.userId, 'userId');
  return client.post(Endpoints.CHANGE_WATCH_LIST, params);
}

/** Import a user-defined custom token into the platform. */
export async function importToken(
  client: GdexApiClient,
  params: ImportTokenParams,
): Promise<Record<string, unknown>> {
  validateRequired(params.tokenAddress, 'tokenAddress');
  validateRequired(params.userId, 'userId');
  return client.post(Endpoints.IMPORT_TOKEN, params);
}
