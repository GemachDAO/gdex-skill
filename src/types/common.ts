/**
 * Common types and enumerations shared across the GdexSkill SDK.
 */

/** Supported blockchain chain IDs */
export enum ChainId {
  /** Ethereum Mainnet */
  ETHEREUM = 1,
  /** BNB Smart Chain */
  BSC = 56,
  /** Optimism */
  OPTIMISM = 10,
  /** Arbitrum One */
  ARBITRUM = 42161,
  /** Avalanche C-Chain */
  AVALANCHE = 43114,
  /** Base */
  BASE = 8453,
  /** Polygon */
  POLYGON = 137,
  /** Fraxtal */
  FRAXTAL = 252,
  /** Linea */
  LINEA = 59144,
  /** Scroll */
  SCROLL = 534352,
  /** Blast */
  BLAST = 81457,
  /** zkSync Era */
  ZKSYNC = 324,
}

/** Supported non-EVM chains (use string identifiers) */
export type NonEvmChain = 'solana' | 'sui';

/** All supported chain identifiers */
export type SupportedChain = ChainId | NonEvmChain;

/** Supported DEX identifiers */
export type SupportedDex =
  | 'raydium'
  | 'raydium-v2'
  | 'orca'
  | 'uniswap-v2'
  | 'uniswap-v3'
  | 'cetus'
  | 'bluefin'
  | 'odos'
  | 'arcadia'
  | 'pancakeswap';

/**
 * Transaction status.
 *
 * - `'queued'`    — job accepted by backend, not yet submitted on-chain
 * - `'pending'`   — submitted on-chain, awaiting confirmation
 * - `'completed'` — successfully confirmed on-chain
 * - `'confirmed'` — alias for completed (some API endpoints return this)
 * - `'failed'`    — transaction reverted or rejected
 */
export type TransactionStatus = 'queued' | 'pending' | 'completed' | 'confirmed' | 'failed';

/** Order side */
export type OrderSide = 'buy' | 'sell';

/** Order type */
export type OrderType = 'market' | 'limit';

/**
 * Configuration for the GdexSkill SDK.
 */
export interface GdexSkillConfig {
  /**
   * Base URL of the Gbot backend API.
  * @default "https://trade-api.gemach.io/v1"
   */
  apiUrl?: string;

  /**
   * API key for authenticated requests.
   */
  apiKey?: string;

  /**
   * Request timeout in milliseconds.
   * @default 30000
   */
  timeout?: number;

  /**
   * Maximum number of retry attempts on transient failures.
   * @default 3
   */
  maxRetries?: number;

  /**
   * Enable debug logging.
   * @default false
   */
  debug?: boolean;

  /**
   * Custom User-Agent string.
   * @default "GdexSkill/1.0.0"
   */
  userAgent?: string;
}

/**
 * Generic transaction result returned from on-chain operations.
 */
export interface TransactionResult {
  /** Transaction hash or signature */
  txHash: string;
  /** Chain the transaction was executed on */
  chain: SupportedChain;
  /** Transaction status */
  status: TransactionStatus;
  /** Block number or slot */
  blockNumber?: number;
  /** Unix timestamp of the transaction */
  timestamp?: number;
  /** Gas used (EVM only) */
  gasUsed?: string;
  /** Raw response from the backend */
  raw?: unknown;
}

/**
 * Paginated response wrapper.
 */
export interface PaginatedResponse<T> {
  /** Result items */
  data: T[];
  /** Total number of items */
  total: number;
  /** Current page */
  page: number;
  /** Items per page */
  limit: number;
  /** Whether there are more pages */
  hasMore: boolean;
}

/**
 * SDK error codes for programmatic error handling.
 */
export enum GdexErrorCode {
  UNKNOWN = 'UNKNOWN',
  AUTH_FAILED = 'AUTH_FAILED',
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  RATE_LIMITED = 'RATE_LIMITED',
  NOT_FOUND = 'NOT_FOUND',
  CHAIN_NOT_SUPPORTED = 'CHAIN_NOT_SUPPORTED',
  DEX_NOT_SUPPORTED = 'DEX_NOT_SUPPORTED',
  API_ERROR = 'API_ERROR',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  SLIPPAGE_EXCEEDED = 'SLIPPAGE_EXCEEDED',
}
