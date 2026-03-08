/**
 * Types for limit order operations.
 *
 * Backend endpoints:
 *   GET  /v1/orders       — list active orders (session-key auth)
 *   POST /v1/limit_buy    — create limit buy (computedData + ABI)
 *   POST /v1/limit_sell   — create limit sell (computedData + ABI)
 *   POST /v1/update_order — update or delete order (computedData + ABI)
 */

// ── Order object returned by the backend ─────────────────────────────────────

/**
 * A limit order as stored in the backend (MongoDB).
 */
export interface LimitOrder {
  /** Unique order identifier (MongoDB _id or orderId) */
  orderId: string;
  /** Token being sold (fromToken) */
  fromToken: string;
  /** Token being bought (toToken) */
  toToken: string;
  /** Whether this is a buy limit order */
  isBuyLimit: boolean;
  /** Trigger price in USD */
  price: number;
  /** Take-profit price (0 = disabled) */
  takeProfitPrice: number;
  /** Stop-loss price (0 = disabled) */
  stopLossPrice: number;
  /** Amount of fromToken in raw units */
  fromTokenAmount: string;
  /** Computed output amount in raw units */
  toTokenAmount: string;
  /** From token decimals */
  fromTokenDecimals?: number;
  /** To token decimals */
  toTokenDecimals?: number;
  /** Managed wallet address that holds the funds */
  walletAddress: string;
  /** User control wallet address */
  userId: string;
  /** Numeric chain ID */
  chainId: number;
  /** DEX pair address */
  pairAddress: string;
  /** Whether the order is still active */
  isActive: boolean;
  /** Whether the order was cancelled */
  isCancelled?: boolean;
  /** Whether this is a stop-loss sell order */
  isStopLoss?: boolean;
  /** Whether this is a snipe order (always false for limit orders) */
  isSnipe?: boolean;
  /** Expiry timestamp (Unix seconds) */
  expiredAt: number;
  /** Take-profit percentage (buy orders) */
  profitPercent?: string;
  /** Stop-loss percentage (buy orders) */
  lossPercent?: string;
  /** Slippage tolerances [lowSlip, highSlip] in bps */
  slippages?: number[];
  /** Token name */
  name?: string;
  /** Token symbol */
  symbol?: string;
  /** Token decimals */
  decimals?: number;
}

// ── GET /v1/orders ───────────────────────────────────────────────────────────

/**
 * Parameters for GET /v1/orders (list active limit orders).
 *
 * Uses session-key auth (encrypted `data` query param), not full computedData.
 */
export interface GetLimitOrdersParams {
  /** Control wallet address (userId) */
  userId: string;
  /** Encrypted session key (from buildGdexUserSessionData) */
  data: string;
  /** Numeric chain ID */
  chainId: number;
}

/**
 * Response from GET /v1/orders.
 */
export interface GetLimitOrdersResponse {
  count: number;
  orders: LimitOrder[];
}

// ── POST /v1/limit_buy ──────────────────────────────────────────────────────

/**
 * Parameters for creating a limit buy order.
 *
 * ABI schema: ['string', 'string', 'string', 'string', 'string', 'string']
 *   [tokenAddress, amount, triggerPrice, profitPercent, lossPercent, nonce]
 *
 * - amount is in native token raw units (wei / lamports)
 * - triggerPrice is the USD price at which to trigger the buy
 * - profitPercent: take-profit % above trigger (e.g. "50" for 50%), "0" to skip
 * - lossPercent: stop-loss % below trigger (e.g. "50" for 50%), "0" to skip
 */
export interface LimitBuyParams {
  /** API key for encryption */
  apiKey: string;
  /** Control wallet address */
  userId: string;
  /** Session private key (for signing) */
  sessionPrivateKey: string;
  /** Numeric chain ID */
  chainId: number;
  /** Token address to buy */
  tokenAddress: string;
  /** Amount of native token to spend (raw units e.g. wei) */
  amount: string;
  /** USD price at which to trigger the buy */
  triggerPrice: string;
  /** Take-profit % above trigger price ("0" to skip) */
  profitPercent?: string;
  /** Stop-loss % below trigger price ("0" to skip) */
  lossPercent?: string;
}

/**
 * Response from POST /v1/limit_buy.
 */
export interface LimitBuyResponse {
  isSuccess: boolean;
  message?: string;
  order?: LimitOrder;
}

// ── POST /v1/limit_sell ─────────────────────────────────────────────────────

/**
 * Parameters for creating a limit sell order.
 *
 * ABI schema: ['string', 'string', 'string', 'string']
 *   [tokenAddress, amount, triggerPrice, nonce]
 *
 * - amount is in token raw units (based on token decimals)
 * - triggerPrice is the USD price at which to trigger the sell
 * - Auto-classifies as take-profit vs stop-loss based on current price
 */
export interface LimitSellParams {
  /** API key for encryption */
  apiKey: string;
  /** Control wallet address */
  userId: string;
  /** Session private key (for signing) */
  sessionPrivateKey: string;
  /** Numeric chain ID */
  chainId: number;
  /** Token address to sell */
  tokenAddress: string;
  /** Amount of tokens to sell (raw units) */
  amount: string;
  /** USD price at which to trigger the sell */
  triggerPrice: string;
}

/**
 * Response from POST /v1/limit_sell.
 */
export interface LimitSellResponse {
  isSuccess: boolean;
  message?: string;
  order?: LimitOrder;
}

// ── POST /v1/update_order ───────────────────────────────────────────────────

/**
 * Parameters for updating or deleting an existing limit order.
 *
 * ABI schema: ['string', 'string', 'string', 'string', 'string', 'string', 'string']
 *   [orderId, amount, triggerPrice, profitPercent, lossPercent, nonce, isDelete]
 *
 * To delete: set isDelete to "1" (or any truthy string).
 * To update: set isDelete to "" or "0".
 */
export interface UpdateOrderParams {
  /** API key for encryption */
  apiKey: string;
  /** Control wallet address */
  userId: string;
  /** Session private key (for signing) */
  sessionPrivateKey: string;
  /** Numeric chain ID */
  chainId: number;
  /** Order ID to update or delete */
  orderId: string;
  /** New amount in raw units */
  amount?: string;
  /** New trigger price (USD) */
  triggerPrice?: string;
  /** New take-profit % (buy orders only) */
  profitPercent?: string;
  /** New stop-loss % (buy orders only) */
  lossPercent?: string;
  /** Set to true to cancel/delete the order */
  isDelete?: boolean;
}

/**
 * Response from POST /v1/update_order.
 */
export interface UpdateOrderResponse {
  isSuccess: boolean;
  message?: string;
  order?: LimitOrder;
}

// ── Legacy aliases (backward compatibility) ─────────────────────────────────

/** @deprecated Use LimitBuyParams */
export type CreateLimitOrderParams = LimitBuyParams;
/** @deprecated Use UpdateOrderParams with isDelete=true */
export type CancelLimitOrderParams = UpdateOrderParams;
