/**
 * Bridge action — cross-chain native-asset bridging (ChangeNow / LI.FI).
 *
 * Backend contract (gbotTradingDashboardBackend src/api/services/ServiceBridge.ts):
 * `amount` is the SOURCE chain's native asset in raw base units (wei, lamports,
 * MIST): estimate and request both read it with
 * `toUserTokenAmount(amount, getNativeDecimals(fromChainId))` (:145-148, :356-358),
 * and the request forwards the same string to the bridge (:378-388). The signed
 * payload is `['string','uint64','uint64','string']` = [amount, fromChainId,
 * toChainId, nonce] (decoder.ts:211-220).
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import {
  BridgeEstimateParams,
  BridgeEstimate,
  BridgeRequestParams,
  BridgeResult,
  BridgeOrdersParams,
  BridgeOrdersResponse,
} from '../types/bridge';
import { parseRawAmount } from '../utils/validation';
import { GdexValidationError } from '../utils/errors';
import {
  buildEncryptedGdexPayload,
  generateGdexNonce,
} from '../utils/gdexManagedCrypto';
import { AbiCoder, SigningKey, keccak256, toUtf8Bytes } from 'ethers';

/**
 * ABI-encode bridge data using the backend schema:
 * ['string', 'uint64', 'uint64', 'string'] → [amount, fromChainId, toChainId, nonce]
 */
function encodeBridgeData(
  amount: string,
  fromChainId: number,
  toChainId: number,
  nonce: string,
): string {
  const abi = AbiCoder.defaultAbiCoder();
  const encoded = abi.encode(
    ['string', 'uint64', 'uint64', 'string'],
    [amount, fromChainId, toChainId, nonce],
  );
  return encoded.startsWith('0x') ? encoded.slice(2) : encoded;
}

/**
 * Check the amount and chain ids before anything is quoted or signed. Returns
 * the canonical raw amount string (no leading zeros).
 */
function checkBridgeParams(params: { amount: string; fromChainId: number; toChainId: number }): string {
  const raw = parseRawAmount(params.amount, 'amount');
  for (const f of ['fromChainId', 'toChainId'] as const) {
    const id = params[f];
    // uint64 slots in the signed payload; the backend parseInt()s them.
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
      throw new GdexValidationError(`${f} must be a positive integer chain id, got ${JSON.stringify(id)}`, f);
    }
  }
  if (params.fromChainId === params.toChainId) {
    throw new GdexValidationError('fromChainId and toChainId must be different', 'toChainId');
  }
  return raw.toString();
}

/**
 * Sign the bridge request message with the session private key.
 * Message format: "request_bridge-{userId}-{dataHex}"
 */
function signBridgeMessage(
  userId: string,
  dataHex: string,
  sessionPrivateKey: string,
): string {
  const normalizedUserId = userId.startsWith('0x') ? userId.toLowerCase() : userId;
  const msg = `request_bridge-${normalizedUserId}-${dataHex}`;
  const digest = keccak256(toUtf8Bytes(msg));
  const sig = new SigningKey(sessionPrivateKey).sign(digest);
  const r = sig.r.replace(/^0x/, '');
  const s = sig.s.replace(/^0x/, '');
  const v = sig.yParity.toString(16).padStart(2, '0');
  return `${r}${s}${v}`;
}

/**
 * Get a bridge estimate (quote) for bridging native tokens between chains.
 *
 * @param client - Authenticated API client
 * @param params - Estimate parameters (fromChainId, toChainId, amount in raw source-native units)
 * @throws {GdexValidationError} if amount is not a positive raw integer or the chains are invalid
 */
export async function estimateBridge(
  client: GdexApiClient,
  params: BridgeEstimateParams,
): Promise<BridgeEstimate> {
  const amount = checkBridgeParams(params);

  return client.get<BridgeEstimate>(Endpoints.BRIDGE_ESTIMATE, {
    fromChainId: params.fromChainId,
    toChainId: params.toChainId,
    amount,
  });
}

/**
 * Execute a cross-chain bridge transaction.
 *
 * Builds the ABI-encoded, signed, and AES-encrypted computedData payload
 * matching the backend's `serverDecryptData()` → `decodeInputData('request_bridge')` flow.
 *
 * @param client - Authenticated API client
 * @param params - Bridge request parameters (amount in raw source-native units)
 * @throws {GdexValidationError} if amount is not a positive raw integer or the chains are invalid (nothing is signed)
 */
export async function requestBridge(
  client: GdexApiClient,
  params: BridgeRequestParams,
): Promise<BridgeResult> {
  const amount = checkBridgeParams(params);

  const nonce = generateGdexNonce().toString();
  const data = encodeBridgeData(amount, params.fromChainId, params.toChainId, nonce);
  const signature = signBridgeMessage(params.userId, data, params.sessionPrivateKey);
  const computedData = buildEncryptedGdexPayload({
    apiKey: params.apiKey,
    userId: params.userId,
    data,
    signature,
  });

  return client.post<BridgeResult>(Endpoints.BRIDGE_REQUEST, { computedData });
}

/**
 * Get bridge order history for a user.
 *
 * @param client - Authenticated API client
 * @param params - userId and encrypted session data
 */
export async function getBridgeOrders(
  client: GdexApiClient,
  params: BridgeOrdersParams,
): Promise<BridgeOrdersResponse> {
  return client.get<BridgeOrdersResponse>(Endpoints.BRIDGE_ORDERS, {
    userId: params.userId,
    data: params.data,
  });
}

// Legacy aliases for backward compatibility
export { estimateBridge as getBridgeQuote };
export { requestBridge as bridge };
