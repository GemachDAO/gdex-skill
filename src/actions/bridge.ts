/**
 * Bridge action — cross-chain asset bridging via ChangeNow.
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
import { validateAmount } from '../utils/validation';
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
 * @param params - Estimate parameters (fromChainId, toChainId, amount in raw units)
 */
export async function estimateBridge(
  client: GdexApiClient,
  params: BridgeEstimateParams,
): Promise<BridgeEstimate> {
  validateAmount(params.amount, 'amount');
  if (params.fromChainId === params.toChainId) {
    throw new Error('fromChainId and toChainId must be different');
  }

  return client.get<BridgeEstimate>(Endpoints.BRIDGE_ESTIMATE, {
    fromChainId: params.fromChainId,
    toChainId: params.toChainId,
    amount: params.amount,
  });
}

/**
 * Execute a cross-chain bridge transaction.
 *
 * Builds the ABI-encoded, signed, and AES-encrypted computedData payload
 * matching the backend's `serverDecryptData()` → `decodeInputData('request_bridge')` flow.
 *
 * @param client - Authenticated API client
 * @param params - Bridge request parameters
 */
export async function requestBridge(
  client: GdexApiClient,
  params: BridgeRequestParams,
): Promise<BridgeResult> {
  validateAmount(params.amount, 'amount');
  if (params.fromChainId === params.toChainId) {
    throw new Error('fromChainId and toChainId must be different');
  }

  const nonce = generateGdexNonce().toString();
  const data = encodeBridgeData(params.amount, params.fromChainId, params.toChainId, nonce);
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
