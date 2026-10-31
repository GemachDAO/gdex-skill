/**
 * Transfer actions — native and ERC20/SPL token transfers via managed custody.
 *
 * Backed by (gbotTradingDashboardBackend v1.1.0):
 *   POST /v1/transfer        — native token transfer       (ServiceMain.transfer)
 *   POST /v1/transfer_token  — ERC20 / SPL token transfer  (ServiceMain.transfer)
 *
 * Both endpoints take `{ computedData, chainId }` (chainId is required,
 * ENCRYPTED_PAYLOAD_WITH_CHAIN, ServiceMain.ts:2780-2790 and :2946-2956):
 *   /transfer:       [recipient, amount(uint256), nonce], signed `transfer-${userId}-${data}`
 *   /transfer_token: [tokenAddress, recipient, amount(uint256), nonce], signed `transfer_token-...`
 * (decoder.ts:47-72). `amount` is raw base units.
 *
 * Each function accepts either:
 *   - a raw `{ computedData, chainId? }` payload built by the caller, or
 *   - a structured `{ recipient, amount, managed: { ... }, chainId? }` payload,
 *     in which case `buildTransferComputedData` is invoked internally.
 *
 * The wire format is unchanged — the backend always receives `{ computedData,
 * chainId? }`.
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import { buildTransferComputedData } from '../utils/gdexManagedCrypto';
import { parseRawAmount, validateRequired } from '../utils/validation';
import { GdexValidationError } from '../utils/errors';

/** Inputs required to build a transfer `computedData` payload internally. */
export interface TransferManagedInputs {
  apiKey: string;
  walletAddress: string;
  sessionPrivateKey: string;
  userId: string;
  /** Optional explicit nonce override (otherwise generated). */
  nonce?: string;
}

/** Raw-shape request: caller pre-built the encrypted `computedData` payload. */
export interface TransferRawRequest {
  /** Pre-built encrypted computedData payload */
  computedData: string;
  /** Optional chain identifier hint for the backend router */
  chainId?: number | string;
}

/** Structured-shape request: SDK builds `computedData` from the inputs. */
export interface TransferStructuredRequest {
  /** Destination wallet address */
  recipient: string;
  /** Raw base-unit integer string (native decimals, or the token's decimals for transferToken) */
  amount: string;
  /** Token to send. Required by transferToken; not allowed on transferNative. */
  tokenAddress?: string;
  /** Managed-custody signing inputs */
  managed: TransferManagedInputs;
  /** Chain id. Required: the backend rejects a structured transfer without it. */
  chainId?: number | string;
}

/** Request payload for a managed-custody transfer (native or token). */
export type TransferRequest = TransferRawRequest | TransferStructuredRequest;

/** Generic transfer response. */
export interface TransferResponse extends Record<string, unknown> {
  /** Async request id for polling /trade-status/:requestId, when async */
  requestId?: string;
  /** Status string (e.g. 'pending', 'success') */
  status?: string;
  /** Resulting transaction hash, when synchronous */
  txHash?: string;
}

function isStructured(req: TransferRequest): req is TransferStructuredRequest {
  return typeof (req as TransferStructuredRequest).recipient === 'string'
    && typeof (req as TransferStructuredRequest).amount === 'string'
    && typeof (req as TransferStructuredRequest).managed === 'object'
    && (req as TransferStructuredRequest).managed !== null;
}

/**
 * Resolve any accepted request shape into the on-the-wire body
 * `{ computedData, chainId? }`.
 */
function resolveTransferBody(req: TransferRequest, kind: 'native' | 'token'): TransferRawRequest {
  if (isStructured(req)) {
    validateRequired(req.recipient, 'recipient');
    // Checked before anything is signed: the amount is a uint256 slot in raw units.
    parseRawAmount(req.amount, 'amount');
    if (req.chainId === undefined || req.chainId === '') {
      throw new GdexValidationError('chainId is required: the transfer endpoints reject a body without it', 'chainId');
    }
    if (kind === 'token') validateRequired(req.tokenAddress, 'tokenAddress');
    if (kind === 'native' && req.tokenAddress) {
      throw new GdexValidationError('tokenAddress is not used by transferNative; call transferToken', 'tokenAddress');
    }
    validateRequired(req.managed?.apiKey, 'managed.apiKey');
    validateRequired(req.managed?.walletAddress, 'managed.walletAddress');
    validateRequired(req.managed?.sessionPrivateKey, 'managed.sessionPrivateKey');
    validateRequired(req.managed?.userId, 'managed.userId');

    const computedData = buildTransferComputedData({
      apiKey: req.managed.apiKey,
      walletAddress: req.managed.walletAddress,
      sessionPrivateKey: req.managed.sessionPrivateKey,
      userId: req.managed.userId,
      recipient: req.recipient,
      amount: req.amount,
      ...(kind === 'token' ? { tokenAddress: req.tokenAddress } : {}),
      nonce: req.managed.nonce,
    });
    return { computedData, chainId: req.chainId };
  }

  validateRequired(req.computedData, 'computedData');
  const body: TransferRawRequest = { computedData: req.computedData };
  if (req.chainId !== undefined) body.chainId = req.chainId;
  return body;
}

/**
 * Transfer the native asset (ETH, SOL, SUI, BNB, …) to a recipient.
 *
 * Accepts either a raw `{ computedData, chainId? }` payload or a structured
 * `{ recipient, amount, managed: {...}, chainId? }` payload — in both cases
 * the backend receives `{ computedData, chainId? }`.
 *
 * @param client - Authenticated API client
 * @param req - Transfer request (raw or structured shape)
 */
export async function transferNative(
  client: GdexApiClient,
  req: TransferRequest,
): Promise<TransferResponse> {
  const body = resolveTransferBody(req, 'native');
  return client.post<TransferResponse>(Endpoints.TRANSFER_NATIVE, body);
}

/**
 * Transfer an ERC20 / SPL token to a recipient.
 *
 * Accepts either a raw `{ computedData, chainId? }` payload or a structured
 * `{ recipient, amount, managed: {...}, chainId? }` payload — in both cases
 * the backend receives `{ computedData, chainId? }`.
 *
 * @param client - Authenticated API client
 * @param req - Transfer request (raw or structured shape)
 */
export async function transferToken(
  client: GdexApiClient,
  req: TransferRequest,
): Promise<TransferResponse> {
  const body = resolveTransferBody(req, 'token');
  return client.post<TransferResponse>(Endpoints.TRANSFER_TOKEN, body);
}
