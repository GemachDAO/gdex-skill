/**
 * Types for perpetual futures trading on HyperLiquid via GDEX managed custody.
 *
 * Write operations use the computedData flow (ABI encode → sign → encrypt → POST).
 * Read operations use the @nktkas/hyperliquid PublicClient directly.
 */

/** Perpetual position side */
export type PerpSide = 'long' | 'short';

// ── Read-only types ──────────────────────────────────────────────────────────

/**
 * An open perpetual position (from HyperLiquid clearinghouse state).
 */
export interface PerpPosition {
  /** Asset/coin symbol (e.g., "BTC", "ETH") */
  coin: string;
  /** Position side */
  side: PerpSide;
  /** Size in contract units */
  size: string;
  /** Average entry price */
  entryPrice: string;
  /** Current mark price */
  markPrice: string;
  /** Leverage */
  leverage: number;
  /** Liquidation price */
  liquidationPrice?: string;
  /** Unrealized P&L in USD */
  unrealizedPnl: string;
  /** Return on equity (%) */
  roe?: string;
  /** Margin used */
  margin?: string;
  /** Margin mode */
  marginMode?: 'isolated' | 'cross';
  /** Position value in USD */
  positionValue?: string;
}

/**
 * Parameters for fetching perp positions / account state.
 */
export interface GetPositionsParams {
  /** User wallet address (EVM) */
  walletAddress: string;
  /** Optional coin filter */
  coin?: string;
}

/**
 * HyperLiquid account state summary.
 */
export interface HlAccountState {
  /** Total account value in USD */
  accountValue: string;
  /** Total notional position value */
  totalNtlPos: string;
  /** Total raw USD (including unrealized P&L) */
  totalRawUsd: string;
  /** Total margin used */
  totalMarginUsed: string;
  /** Withdrawable balance */
  withdrawable: string;
  /** Open positions */
  positions: PerpPosition[];
}

// ── Managed-custody write params ─────────────────────────────────────────────

/**
 * Managed-custody credentials required for all HL write operations.
 */
export interface HlManagedCredentials {
  /** API key for AES encryption */
  apiKey: string;
  /** User wallet address (EVM) */
  walletAddress: string;
  /** Session private key (hex, from managed sign-in) */
  sessionPrivateKey: string;
}

/**
 * Parameters for depositing USDC to HyperLiquid via managed custody.
 */
export interface PerpDepositParams extends HlManagedCredentials {
  /** USDC token contract address on the source chain */
  tokenAddress: string;
  /** Amount in USDC (human readable, e.g. "10" for 10 USDC). Converted to smallest unit internally. Min: 10 USDC. */
  amount: string;
  /** Source chain ID — must be 42161 (Arbitrum) */
  chainId: number;
}

/**
 * Parameters for withdrawing USDC from HyperLiquid via managed custody.
 */
export interface PerpWithdrawParams extends HlManagedCredentials {
  /** Amount in USDC to withdraw */
  amount: string;
}

/**
 * Parameters for placing a market/limit order on HyperLiquid via managed custody.
 * This is the primary way to open positions.
 */
export interface HlCreateOrderParams extends HlManagedCredentials {
  /** Asset coin symbol (e.g., "BTC", "ETH") */
  coin: string;
  /** True for long, false for short */
  isLong: boolean;
  /** Order price (use mark price for market orders when isMarket=true) */
  price: string;
  /** Position size in contracts (e.g., "0.001" for 0.001 BTC) */
  size: string;
  /** Whether this order only reduces an existing position */
  reduceOnly?: boolean;
  /** Take-profit price (empty string "" to skip) */
  tpPrice?: string;
  /** Stop-loss price (empty string "" to skip) */
  slPrice?: string;
  /** True for market order, false for limit order */
  isMarket?: boolean;
}

/**
 * Parameters for placing a simple order (no TP/SL).
 */
export interface HlPlaceOrderParams extends HlManagedCredentials {
  /** Asset coin symbol */
  coin: string;
  /** True for long, false for short */
  isLong: boolean;
  /** Order price */
  price: string;
  /** Position size in contracts */
  size: string;
  /** Whether this order only reduces an existing position */
  reduceOnly?: boolean;
}

/**
 * Parameters for closing all open positions on HyperLiquid.
 */
export type HlCloseAllParams = HlManagedCredentials;

/**
 * Parameters for cancelling a specific order.
 */
export interface HlCancelOrderParams extends HlManagedCredentials {
  /** Asset coin symbol */
  coin: string;
  /** Order ID to cancel */
  orderId: string;
}

/**
 * Parameters for cancelling all open orders.
 */
export type HlCancelAllOrdersParams = HlManagedCredentials;

// ── Result types ─────────────────────────────────────────────────────────────

/**
 * Result from a managed-custody HL write operation.
 */
export interface HlResponse {
  isSuccess: boolean;
  message: string;
}

/**
 * Result from HL order placement (extends base response).
 */
export interface HlOrderResult extends HlResponse {
  /** Order ID from HyperLiquid (if returned) */
  orderId?: string;
}
