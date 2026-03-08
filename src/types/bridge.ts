/**
 * Types for cross-chain bridge operations.
 */

/**
 * Parameters for requesting a bridge estimate / quote.
 */
export interface BridgeEstimateParams {
  /** Source chain ID (numeric) */
  fromChainId: number;
  /** Destination chain ID (numeric) */
  toChainId: number;
  /** Amount in raw token units (wei-like, before decimals) */
  amount: string;
}

/**
 * Parameters for executing a bridge via encrypted computedData.
 */
export interface BridgeRequestParams {
  /** Source chain ID (numeric) */
  fromChainId: number;
  /** Destination chain ID (numeric) */
  toChainId: number;
  /** Amount in raw token units */
  amount: string;
  /** User ID (control wallet address) */
  userId: string;
  /** Session private key for signing */
  sessionPrivateKey: string;
  /** API key for encryption */
  apiKey: string;
}

/**
 * Parameters for listing bridge order history.
 */
export interface BridgeOrdersParams {
  /** User ID (control wallet address) */
  userId: string;
  /** Encrypted session data (from buildGdexUserSessionData) */
  data: string;
}

/**
 * Bridge quote / estimate response from the backend.
 */
export interface BridgeEstimate {
  /** Bridge provider used (e.g. "ChangeNow") */
  tool: string;
  /** Source chain ID */
  fromChainId: number;
  /** Input amount in raw token units */
  fromAmount: string;
  /** Destination chain ID */
  toChainId: number;
  /** Estimated output amount in raw token units */
  estimateAmount: string;
  /** Minimum estimated time in seconds */
  minEstimateTime: number;
  /** Maximum estimated time in seconds */
  maxEstimateTime: number;
}

/**
 * Result of an executed bridge operation.
 */
export interface BridgeResult {
  /** Whether the bridge was successful */
  isSuccess: boolean;
  /** Transaction hash on the source chain (null on failure) */
  hash: string | null;
  /** Human-readable message */
  message: string;
  /** Minimum estimated completion time in seconds */
  minTime?: number;
  /** Maximum estimated completion time in seconds */
  maxTime?: number;
  /** Error message (on failure) */
  error?: string;
}

/**
 * A single bridge order from history.
 */
export interface BridgeOrder {
  userId: string;
  fromChainId: number;
  toChainId: number;
  fromAmount: string;
  estimateToAmount: string;
  fromWallet: string;
  toWallet: string;
  txHash: string;
  requestTime: number;
}

/**
 * Response from bridge_orders endpoint.
 */
export interface BridgeOrdersResponse {
  count: number;
  bridgeOrders: BridgeOrder[];
}

// Legacy aliases for backward compatibility
export type BridgeParams = BridgeRequestParams;
export type BridgeQuote = BridgeEstimate;
