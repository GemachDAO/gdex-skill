/**
 * Social / community actions — comments, sentiment voting, watchlist,
 * and user-imported custom tokens.
 *
 * Backed by (gbotTradingDashboardBackend v1.1.0):
 *   POST /v1/add_comment        — ServiceMain.addComment
 *   GET  /v1/comments           — ServiceMain.getComments
 *   POST /v1/vote_sentiment     — ServiceMain.voteSentiment
 *   GET  /v1/watch_list         — ServiceMain.getWatchList
 *   POST /v1/change_watch_list  — ServiceMain.changeWatchList
 *   POST /v1/import_token       — ServiceMain.importToken
 *
 * Plain-JSON write endpoints (verified against v1.1.0 on 2026-05-22):
 *   Only `addComment` and `voteSentiment` send plain JSON. They do NOT
 *   invoke `serverDecryptData` in `ServiceMain` — they accept plain JSON
 *   and rely on the standard session header for authentication.
 *
 * Managed-custody (`computedData`) write endpoints:
 *   `changeWatchList` and `importToken` DO go through `serverDecryptData`.
 *   The backend decodes:
 *     change_watch_list →
 *       ABI:     ['watch_list', [tokenAddress, chainId, isAdded, nonce]]
 *       sig msg: `watch_list-${userId}-${data}`
 *     import_token →
 *       ABI:     ['import_token', [tokenAddress, chainId, nonce]]
 *       sig msg: `import_token-${userId}-${data}`
 *   Each of these two functions accepts either:
 *     - a raw `{ computedData, chainId? }` payload built by the caller, or
 *     - a structured payload, in which case
 *       `buildWatchListComputedData` / `buildImportTokenComputedData` is
 *       invoked internally.
 *   The wire format is always `{ computedData, chainId? }`.
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import {
  buildImportTokenComputedData,
  buildWatchListComputedData,
} from '../utils/gdexManagedCrypto';
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

/** Managed-custody signing inputs shared by watchlist / import-token writes. */
export interface SocialManagedInputs {
  apiKey: string;
  walletAddress: string;
  sessionPrivateKey: string;
  userId: string;
  /** Optional explicit nonce override (otherwise generated). */
  nonce?: string;
}

/** Raw-shape request: caller pre-built the encrypted `computedData` payload. */
export interface ChangeWatchListRawRequest {
  /** Pre-built encrypted computedData payload */
  computedData: string;
  /** Optional chain identifier hint for the backend router */
  chainId?: number | string;
}

/** Structured-shape request: SDK builds `computedData` from the inputs. */
export interface ChangeWatchListStructuredRequest {
  /** Token to add to / remove from the watchlist (address) */
  tokenAddress: string;
  /** Chain identifier the token lives on */
  chainId: number | string;
  /** Whether to add or remove the token from the watchlist */
  action: 'add' | 'remove';
  /** Managed-custody signing inputs */
  managed: SocialManagedInputs;
}

/**
 * Request payload for changing the user's watchlist via managed custody.
 *
 * The backend always receives `{ computedData, chainId? }`.
 */
export type ChangeWatchListParams =
  | ChangeWatchListRawRequest
  | ChangeWatchListStructuredRequest;

export interface GetWatchListParams {
  userId: string;
  data?: string;
}

/** Raw-shape request: caller pre-built the encrypted `computedData` payload. */
export interface ImportTokenRawRequest {
  /** Pre-built encrypted computedData payload */
  computedData: string;
  /** Optional chain identifier hint for the backend router */
  chainId?: number | string;
}

/** Structured-shape request: SDK builds `computedData` from the inputs. */
export interface ImportTokenStructuredRequest {
  /** Token to import (address) */
  tokenAddress: string;
  /** Chain identifier the token lives on */
  chainId: number | string;
  /** Managed-custody signing inputs */
  managed: SocialManagedInputs;
}

/**
 * Request payload for importing a custom token via managed custody.
 *
 * The backend always receives `{ computedData, chainId? }`.
 */
export type ImportTokenParams =
  | ImportTokenRawRequest
  | ImportTokenStructuredRequest;

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

/** Wire body for change_watch_list / import_token managed-custody endpoints. */
interface SocialComputedBody {
  computedData: string;
  chainId?: number | string;
}

function isChangeWatchListStructured(
  req: ChangeWatchListParams,
): req is ChangeWatchListStructuredRequest {
  return typeof (req as ChangeWatchListStructuredRequest).tokenAddress === 'string'
    && typeof (req as ChangeWatchListStructuredRequest).action === 'string'
    && typeof (req as ChangeWatchListStructuredRequest).managed === 'object'
    && (req as ChangeWatchListStructuredRequest).managed !== null;
}

function isImportTokenStructured(
  req: ImportTokenParams,
): req is ImportTokenStructuredRequest {
  return typeof (req as ImportTokenStructuredRequest).tokenAddress === 'string'
    && typeof (req as ImportTokenStructuredRequest).managed === 'object'
    && (req as ImportTokenStructuredRequest).managed !== null;
}

function resolveChangeWatchListBody(req: ChangeWatchListParams): SocialComputedBody {
  if (isChangeWatchListStructured(req)) {
    validateRequired(req.tokenAddress, 'tokenAddress');
    validateRequired(String(req.chainId), 'chainId');
    validateRequired(req.action, 'action');
    validateRequired(req.managed?.apiKey, 'managed.apiKey');
    validateRequired(req.managed?.walletAddress, 'managed.walletAddress');
    validateRequired(req.managed?.sessionPrivateKey, 'managed.sessionPrivateKey');
    validateRequired(req.managed?.userId, 'managed.userId');

    const computedData = buildWatchListComputedData({
      apiKey: req.managed.apiKey,
      walletAddress: req.managed.walletAddress,
      sessionPrivateKey: req.managed.sessionPrivateKey,
      userId: req.managed.userId,
      tokenAddress: req.tokenAddress,
      chainId: String(req.chainId),
      isAdded: req.action === 'add',
      nonce: req.managed.nonce,
    });
    return { computedData, chainId: req.chainId };
  }

  validateRequired(req.computedData, 'computedData');
  const body: SocialComputedBody = { computedData: req.computedData };
  if (req.chainId !== undefined) body.chainId = req.chainId;
  return body;
}

function resolveImportTokenBody(req: ImportTokenParams): SocialComputedBody {
  if (isImportTokenStructured(req)) {
    validateRequired(req.tokenAddress, 'tokenAddress');
    validateRequired(String(req.chainId), 'chainId');
    validateRequired(req.managed?.apiKey, 'managed.apiKey');
    validateRequired(req.managed?.walletAddress, 'managed.walletAddress');
    validateRequired(req.managed?.sessionPrivateKey, 'managed.sessionPrivateKey');
    validateRequired(req.managed?.userId, 'managed.userId');

    const computedData = buildImportTokenComputedData({
      apiKey: req.managed.apiKey,
      walletAddress: req.managed.walletAddress,
      sessionPrivateKey: req.managed.sessionPrivateKey,
      userId: req.managed.userId,
      tokenAddress: req.tokenAddress,
      chainId: String(req.chainId),
      nonce: req.managed.nonce,
    });
    return { computedData, chainId: req.chainId };
  }

  validateRequired(req.computedData, 'computedData');
  const body: SocialComputedBody = { computedData: req.computedData };
  if (req.chainId !== undefined) body.chainId = req.chainId;
  return body;
}

/**
 * Add or remove a token from the user's watchlist.
 *
 * Accepts either a raw `{ computedData, chainId? }` payload or a structured
 * `{ tokenAddress, chainId, action, managed: {...} }` payload — in both
 * cases the backend receives `{ computedData, chainId? }`.
 */
export async function changeWatchList(
  client: GdexApiClient,
  params: ChangeWatchListParams,
): Promise<Record<string, unknown>> {
  const body = resolveChangeWatchListBody(params);
  return client.post(Endpoints.CHANGE_WATCH_LIST, body);
}

/**
 * Import a user-defined custom token into the platform.
 *
 * Accepts either a raw `{ computedData, chainId? }` payload or a structured
 * `{ tokenAddress, chainId, managed: {...} }` payload — in both cases the
 * backend receives `{ computedData, chainId? }`.
 */
export async function importToken(
  client: GdexApiClient,
  params: ImportTokenParams,
): Promise<Record<string, unknown>> {
  const body = resolveImportTokenBody(params);
  return client.post(Endpoints.IMPORT_TOKEN, body);
}
