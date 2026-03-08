import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { AbiCoder, SigningKey, keccak256, toUtf8Bytes } from 'ethers';
import type { GdexManagedComputedPayload, GdexManagedSessionKeyPair } from '../types/managed';

// ── HyperLiquid action type constants ────────────────────────────────────────

export type HlActionType =
  | 'hl_deposit'
  | 'hl_withdraw'
  | 'hl_create_order'
  | 'hl_place_order'
  | 'hl_close_all'
  | 'hl_cancel_order'
  | 'hl_cancel_all_orders'
  | 'hl_update_leverage';

/**
 * Derive AES-256-CBC key/iv from API key using the documented hash chain.
 */
export function deriveGdexAesMaterial(apiKey: string): { key: Buffer; iv: Buffer } {
  const hashApiHex = createHash('sha256').update(apiKey).digest('hex');
  const keyHex = hashApiHex.slice(0, 64);
  const ivHex = createHash('sha256').update(hashApiHex).digest('hex').slice(0, 32);
  return {
    key: Buffer.from(keyHex, 'hex'),
    iv: Buffer.from(ivHex, 'hex'),
  };
}

/**
 * Encrypt UTF-8 plaintext into hex using AES-256-CBC derived from API key.
 */
export function encryptGdexComputedData(plaintext: string, apiKey: string): string {
  const { key, iv } = deriveGdexAesMaterial(apiKey);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  return encrypted.toString('hex');
}

/**
 * Encrypt raw hex data (decoded to bytes) using AES-256-CBC derived from API key.
 */
export function encryptGdexHexData(hexData: string, apiKey: string): string {
  const { key, iv } = deriveGdexAesMaterial(apiKey);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(hexData, 'hex')), cipher.final()]);
  return encrypted.toString('hex');
}

/**
 * Decrypt hex ciphertext (AES-256-CBC) into UTF-8 plaintext.
 */
export function decryptGdexComputedData(cipherHex: string, apiKey: string): string {
  const { key, iv } = deriveGdexAesMaterial(apiKey);
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cipherHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/**
 * Generate a random secp256k1 session keypair used by managed custody flows.
 */
export function generateGdexSessionKeyPair(): GdexManagedSessionKeyPair {
  const sessionPrivateKey = `0x${randomBytes(32).toString('hex')}`;
  const signingKey = new SigningKey(sessionPrivateKey);
  return {
    sessionPrivateKey,
    sessionKey: signingKey.compressedPublicKey,
  };
}

/**
 * Build the exact sign_in message string expected by backend verification.
 */
export function buildGdexSignInMessage(userId: string, nonce: string, sessionKey: string): string {
  // Only lowercase EVM-style addresses (0x-prefixed); preserve Solana base58 casing
  const normalizedUserId = userId.startsWith('0x') ? userId.toLowerCase() : userId;
  const sessionKeyHex = sessionKey.startsWith('0x') ? sessionKey.slice(2) : sessionKey;
  return (
    'By signing, you agree to GDEX Trading Terms of Use and Privacy Policy. ' +
    `Your GDEX log in message: ${normalizedUserId} ${nonce} ${sessionKeyHex}`
  );
}

/**
 * Encode sign_in ABI data using the documented 3-field schema.
 */
export function encodeGdexSignInData(sessionKey: string, nonce: string, refSourceCode = ''): string {
  const abi = AbiCoder.defaultAbiCoder();
  return abi.encode(['bytes', 'string', 'string'], [sessionKey, nonce, refSourceCode]);
}

/**
 * ABI-encode trade data payload using the documented schema ['string','uint256','string'].
 */
export function encodeGdexTradeData(tokenAddress: string, amount: string | number | bigint, extra = ''): string {
  const abi = AbiCoder.defaultAbiCoder();
  return abi.encode(['string', 'uint256', 'string'], [tokenAddress, amount, extra]);
}

/**
 * Build trade signature message string used before signing.
 * Strips 0x from dataHex to match backend message reconstruction.
 */
export function buildGdexTradeSignatureMessage(
  action: 'purchase' | 'sell',
  userId: string,
  dataHex: string
): string {
  const d = dataHex.startsWith('0x') ? dataHex.slice(2) : dataHex;
  const normalizedUserId = userId.startsWith('0x') ? userId.toLowerCase() : userId;
  return `${action}-${normalizedUserId}-${d}`;
}

/**
 * Sign a managed trade message with the session private key using raw keccak256.
 * Returns 130-char hex string without 0x prefix: r(64)+s(64)+v(2).
 */
export function signGdexTradeMessageWithSessionKey(
  action: 'purchase' | 'sell',
  userId: string,
  dataHex: string,
  sessionPrivateKey: string
): string {
  const msg = buildGdexTradeSignatureMessage(action, userId, dataHex);
  const digest = keccak256(toUtf8Bytes(msg));
  const sig = new SigningKey(sessionPrivateKey).sign(digest);
  const r = sig.r.replace(/^0x/, '');
  const s = sig.s.replace(/^0x/, '');
  const v = sig.yParity.toString(16).padStart(2, '0');
  return `${r}${s}${v}`;
}

/**
 * Build plaintext JSON payload then encrypt it to computedData hex.
 * Strips 0x prefix from data to match backend expectations.
 */
export function buildEncryptedGdexPayload(params: {
  apiKey: string;
  userId: string;
  data: string;
  signature: string;
}): string {
  const dataNoPrefix = params.data.startsWith('0x') ? params.data.slice(2) : params.data;
  const plaintext = JSON.stringify({
    userId: params.userId,
    data: dataNoPrefix,
    signature: params.signature,
  });
  return encryptGdexComputedData(plaintext, params.apiKey);
}

/**
 * Encrypt session key as raw bytes for /v1/user `data` query parameter.
 * The session key hex is decoded to raw bytes before encryption (not UTF-8).
 */
export function buildGdexUserSessionData(sessionKey: string, apiKey: string): string {
  const sessionKeyHex = sessionKey.startsWith('0x') ? sessionKey.slice(2) : sessionKey;
  return encryptGdexHexData(sessionKeyHex, apiKey);
}

/**
 * Build computedData for /v1/sign_in after obtaining control-wallet signature.
 */
export function buildGdexSignInComputedData(params: {
  apiKey: string;
  userId: string;
  sessionKey: string;
  nonce: string;
  refSourceCode?: string;
  signature: string;
}): GdexManagedComputedPayload {
  const data = encodeGdexSignInData(params.sessionKey, params.nonce, params.refSourceCode ?? '');
  const computedData = buildEncryptedGdexPayload({
    apiKey: params.apiKey,
    userId: params.userId,
    data,
    signature: params.signature,
  });
  return {
    computedData,
    data,
    signature: params.signature,
  };
}

/**
 * Build computedData for /v1/purchase_v2 and /v1/sell_v2 using session key signing.
 */
export function buildGdexManagedTradeComputedData(params: {
  apiKey: string;
  action: 'purchase' | 'sell';
  userId: string;
  tokenAddress: string;
  amount: string | number | bigint;
  nonce: string;
  sessionPrivateKey: string;
}): GdexManagedComputedPayload {
  const data = encodeGdexTradeData(params.tokenAddress, params.amount, params.nonce);
  const signature = signGdexTradeMessageWithSessionKey(
    params.action,
    params.userId,
    data,
    params.sessionPrivateKey
  );
  const computedData = buildEncryptedGdexPayload({
    apiKey: params.apiKey,
    userId: params.userId,
    data,
    signature,
  });
  return {
    computedData,
    data,
    signature,
  };
}

// ── HyperLiquid managed-custody helpers ──────────────────────────────────────

/**
 * Generate a client-side nonce for managed-custody operations.
 * Matches the official SDK's generateUniqueNumber():
 *   Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000)
 */
export function generateGdexNonce(): number {
  return Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000);
}

/**
 * ABI-encode data for a HyperLiquid action.
 *
 * Each action type has a fixed schema matching the official SDK's encodeInputData().
 */
export function encodeHlActionData(
  action: HlActionType,
  params: Record<string, unknown>,
): string {
  const abi = AbiCoder.defaultAbiCoder();
  let encoded: string;

  switch (action) {
    case 'hl_deposit':
      // [uint64, address, uint256, string] = [chainId, tokenAddress, amount(smallest unit), nonce]
      encoded = abi.encode(
        ['uint64', 'address', 'uint256', 'string'],
        [params.chainId, params.tokenAddress, params.amount, params.nonce],
      );
      break;
    case 'hl_withdraw':
      // [string, string] = [amount, nonce]
      encoded = abi.encode(['string', 'string'], [params.amount, params.nonce]);
      break;
    case 'hl_create_order':
      // [string, bool, string, string, bool, string, string, string, bool]
      encoded = abi.encode(
        ['string', 'bool', 'string', 'string', 'bool', 'string', 'string', 'string', 'bool'],
        [
          params.coin, params.isLong, params.price, params.size,
          params.reduceOnly, params.nonce,
          params.tpPrice, params.slPrice, params.isMarket,
        ],
      );
      break;
    case 'hl_place_order':
      // [string, bool, string, string, bool, string]
      encoded = abi.encode(
        ['string', 'bool', 'string', 'string', 'bool', 'string'],
        [params.coin, params.isLong, params.price, params.size, params.reduceOnly, params.nonce],
      );
      break;
    case 'hl_close_all':
      // [string] = [nonce]
      encoded = abi.encode(['string'], [params.nonce]);
      break;
    case 'hl_cancel_order':
      // [string, string, string] = [nonce, coin, orderId]
      encoded = abi.encode(['string', 'string', 'string'], [params.nonce, params.coin, params.orderId]);
      break;
    case 'hl_cancel_all_orders':
      // [string] = [nonce]
      encoded = abi.encode(['string'], [params.nonce]);
      break;
    case 'hl_update_leverage':
      // [string, uint32, bool, string] = [coin, leverage, isCross, nonce]
      encoded = abi.encode(
        ['string', 'uint32', 'bool', 'string'],
        [params.coin, params.leverage, params.isCross, params.nonce],
      );
      break;
    default:
      throw new Error(`Unknown HL action: ${action}`);
  }

  // Return without 0x prefix to match official SDK convention
  return encoded.startsWith('0x') ? encoded.slice(2) : encoded;
}

/**
 * Sign a HyperLiquid action message with the session private key.
 *
 * Sign message format: `{action}-{address.toLowerCase()}-{dataHex}`
 * Returns 130-char hex (r64+s64+v2) without 0x prefix.
 */
export function signHlActionMessage(
  action: HlActionType,
  userId: string,
  dataHex: string,
  sessionPrivateKey: string,
): string {
  const normalizedUserId = userId.startsWith('0x') ? userId.toLowerCase() : userId;
  const msg = `${action}-${normalizedUserId}-${dataHex}`;
  const digest = keccak256(toUtf8Bytes(msg));
  const sig = new SigningKey(sessionPrivateKey).sign(digest);
  const r = sig.r.replace(/^0x/, '');
  const s = sig.s.replace(/^0x/, '');
  const v = sig.yParity.toString(16).padStart(2, '0');
  return `${r}${s}${v}`;
}

/**
 * Build encrypted computedData for any HyperLiquid managed-custody operation.
 *
 * This is the generic builder that handles encode → sign → encrypt for all HL actions.
 */
export function buildHlComputedData(params: {
  action: HlActionType;
  apiKey: string;
  walletAddress: string;
  sessionPrivateKey: string;
  actionParams: Record<string, unknown>;
}): string {
  const nonce = generateGdexNonce().toString();
  const fullParams = { ...params.actionParams, nonce };

  const data = encodeHlActionData(params.action, fullParams);
  const signature = signHlActionMessage(
    params.action,
    params.walletAddress,
    data,
    params.sessionPrivateKey,
  );
  return buildEncryptedGdexPayload({
    apiKey: params.apiKey,
    userId: params.walletAddress,
    data,
    signature,
  });
}

// ── Limit order action types ─────────────────────────────────────────────────

export type LimitOrderActionType = 'limit_buy' | 'limit_sell' | 'update_order';

/**
 * ABI-encode data for a limit order action.
 *
 * Schemas (all fields are strings):
 *   limit_buy:    [tokenAddress, amount, triggerPrice, profitPercent, lossPercent, nonce]
 *   limit_sell:   [tokenAddress, amount, triggerPrice, nonce]
 *   update_order: [orderId, amount, triggerPrice, profitPercent, lossPercent, nonce, isDelete]
 */
export function encodeLimitOrderData(
  action: LimitOrderActionType,
  params: Record<string, string>,
): string {
  const abi = AbiCoder.defaultAbiCoder();
  let encoded: string;

  switch (action) {
    case 'limit_buy':
      encoded = abi.encode(
        ['string', 'string', 'string', 'string', 'string', 'string'],
        [params.tokenAddress, params.amount, params.triggerPrice,
         params.profitPercent, params.lossPercent, params.nonce],
      );
      break;
    case 'limit_sell':
      encoded = abi.encode(
        ['string', 'string', 'string', 'string'],
        [params.tokenAddress, params.amount, params.triggerPrice, params.nonce],
      );
      break;
    case 'update_order':
      encoded = abi.encode(
        ['string', 'string', 'string', 'string', 'string', 'string', 'string'],
        [params.orderId, params.amount, params.triggerPrice,
         params.profitPercent, params.lossPercent, params.nonce, params.isDelete],
      );
      break;
    default:
      throw new Error(`Unknown limit order action: ${action}`);
  }

  return encoded.startsWith('0x') ? encoded.slice(2) : encoded;
}

/**
 * Sign a limit order action message with the session private key.
 * Message format: `{action}-{userId}-{dataHex}`
 * Returns 130-char hex (r64+s64+v2) without 0x prefix.
 */
export function signLimitOrderMessage(
  action: LimitOrderActionType,
  userId: string,
  dataHex: string,
  sessionPrivateKey: string,
): string {
  const normalizedUserId = userId.startsWith('0x') ? userId.toLowerCase() : userId;
  const msg = `${action}-${normalizedUserId}-${dataHex}`;
  const digest = keccak256(toUtf8Bytes(msg));
  const sig = new SigningKey(sessionPrivateKey).sign(digest);
  const r = sig.r.replace(/^0x/, '');
  const s = sig.s.replace(/^0x/, '');
  const v = sig.yParity.toString(16).padStart(2, '0');
  return `${r}${s}${v}`;
}

/**
 * Build encrypted computedData for a limit order action.
 */
export function buildLimitOrderComputedData(params: {
  action: LimitOrderActionType;
  apiKey: string;
  userId: string;
  sessionPrivateKey: string;
  actionParams: Record<string, string>;
}): string {
  const nonce = generateGdexNonce().toString();
  const fullParams = { ...params.actionParams, nonce };

  const data = encodeLimitOrderData(params.action, fullParams);
  const signature = signLimitOrderMessage(
    params.action,
    params.userId,
    data,
    params.sessionPrivateKey,
  );
  return buildEncryptedGdexPayload({
    apiKey: params.apiKey,
    userId: params.userId,
    data,
    signature,
  });
}
