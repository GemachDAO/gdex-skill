/**
 * Types for GDEX managed-custody API flows that use encrypted computedData.
 */

export interface GdexManagedSignInParams {
  /** AES-encrypted auth payload expected by /v1/sign_in */
  computedData: string;
  /** Chain identifier (e.g. 900 for Solana) */
  chainId: number | string;
}

export interface GdexManagedSessionKeyPair {
  /** secp256k1 private key used for post-sign_in authenticated actions */
  sessionPrivateKey: string;
  /** compressed secp256k1 public key (0x + 66 hex chars) */
  sessionKey: string;
}

export interface GdexManagedComputedPayload {
  /** AES-encrypted payload sent to backend */
  computedData: string;
  /** Plain ABI data that was signed */
  data: string;
  /** Signature sent inside encrypted payload */
  signature: string;
}

export interface GdexManagedUserQuery {
  /** Control wallet address */
  userId: string;
  /** Encrypted session key payload */
  data: string;
  /** Chain identifier */
  chainId: number | string;
}

export interface GdexManagedTradeParams {
  /** AES-encrypted trade payload */
  computedData: string;
  /** Chain identifier */
  chainId: number | string;
  /** Optional chain tip/priority fee */
  tip?: string;
  /** Optional slippage percentage */
  slippage?: number;
}

export interface GdexManagedTradeSubmitResult {
  /** Async request ID (canonical field in current backend) */
  requestId?: string;
  /** Legacy field used by some deployments */
  jobId?: string;
  /** Current processing status */
  status?: string;
  /** Request creation timestamp */
  createdAt?: number;
  /** Additional backend fields */
  [key: string]: unknown;
}

export interface GdexManagedTradeStatus {
  /** Request ID */
  requestId?: string;
  /** Lifecycle status: pending/processing/success/failed */
  status?: string;
  /** Optional tx hash/signature */
  hash?: string;
  /** Additional backend fields */
  [key: string]: unknown;
}
