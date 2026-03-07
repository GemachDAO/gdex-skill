import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { AbiCoder, SigningKey, keccak256, toUtf8Bytes } from 'ethers';
import type { GdexManagedComputedPayload, GdexManagedSessionKeyPair } from '../types/managed';

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
