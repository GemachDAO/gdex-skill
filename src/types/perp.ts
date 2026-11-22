/**
 * Types for perpetual futures trading on HyperLiquid via GDEX managed custody.
 *
 * Write operations use the computedData flow (ABI encode → sign → encrypt → POST).
 * Read operations use the public HyperLiquid info API.
 * Direct execution uses the HyperLiquidTrading class (@gdexsdk/hyper-liquid-trader) for cross/isolated perp and spot.
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
 * Parameters for placing a market/limit order on HyperLiquid via managed custody
 * (`/v1/hl/create_order`). This is the way to open positions and to rest limit
 * orders, including a reduce-only limit close.
 */
export interface HlCreateOrderParams extends HlManagedCredentials {
  /** Asset coin symbol (e.g., "BTC", "ETH"; builder-DEX markets as "dex:ASSET", e.g. "xyz:NVDA") */
  coin: string;
  /** True for long, false for short */
  isLong: boolean;
  /**
   * Order price, a positive decimal string. Market order: the mark-price
   * reference ('0' fetches the mark price); the back-end adds its own 5%
   * slippage bound. Limit order: the resting price — a non-reduce-only limit
   * at or through the mark (>= mark long, <= mark short) is refused.
   */
  price: string;
  /** Position size in contracts, a positive decimal string (e.g., "0.001" for 0.001 BTC) */
  size: string;
  /**
   * Whether this order only reduces an existing position. With
   * `isMarket: false` it rests as a GTC reduce-only limit ("limit close").
   */
  reduceOnly?: boolean;
  /** Take-profit price; omit or "" for none. Must be set together with slPrice. Becomes a market trigger. */
  tpPrice?: string;
  /** Stop-loss price; omit or "" for none. Must be set together with tpPrice. Becomes a market trigger. */
  slPrice?: string;
  /**
   * Market size decimals (HL meta `szDecimals`). When set, the size, limit
   * price and TP/SL are also checked against Hyperliquid's precision rules
   * instead of being rounded by the backend.
   */
  szDecimals?: number;
  /** True for market order (default), false for limit order */
  isMarket?: boolean;
  /**
   * @deprecated Not sent: the back-end decides the margin mode itself.
   * Builder-DEX (`dex:ASSET`) and isolated-only markets are isolated; every
   * other market is cross.
   */
  marginMode?: 'cross' | 'isolated';
  /**
   * Leverage, a whole number from 1 up to the market's own maximum (a larger
   * value is clamped to that maximum by the back-end). Sent as a top-level
   * request field; the back-end sets it on the market just before placing the
   * order, and this is the only way to set leverage.
   *
   * When OMITTED the back-end applies the market's MAXIMUM leverage — also on
   * a reduce-only order, which changes the leverage of the open position. Pass
   * it on every order; for a reduce-only order pass the position's current
   * leverage.
   */
  leverage?: number;
}

/**
 * Parameters for closing (part of) a position at market via
 * `/v1/hl/place_order` — the gdex.pro Close button.
 */
export interface HlClosePositionParams extends HlManagedCredentials {
  /** Asset coin symbol; builder-DEX markets as "dex:ASSET" (e.g. "xyz:TSLA") */
  coin: string;
  /** Size to close in contracts, a positive decimal string. More than the position closes all of it. */
  size: string;
  /**
   * Ignored by the back-end (it closes at its own mark ±5%). Sent as gdex.pro
   * sends it: the current mark price, fetched when omitted or '0'.
   */
  price?: string;
  /**
   * Ignored by the back-end (the side comes from the live position). gdex.pro
   * sends the closing side: false to close a long, true to close a short.
   */
  isLong?: boolean;
  /** Market size decimals (HL meta `szDecimals`); when set, a `size` with more decimals is rejected. */
  szDecimals?: number;
}

/**
 * @deprecated Parameters of the `hlPlaceOrder` alias. `/v1/hl/place_order`
 * only closes positions at market; use `HlClosePositionParams` with
 * `hlClosePosition`, or `hlCreateOrder` for limit orders.
 */
export interface HlPlaceOrderParams extends HlManagedCredentials {
  /** Asset coin symbol */
  coin: string;
  /** Ignored by the back-end: the side comes from the live position. */
  isLong: boolean;
  /** Ignored by the back-end: the close executes at its own mark ±5%. Must still be a positive decimal string. */
  price: string;
  /** Size to close in contracts, a positive decimal string */
  size: string;
  /** Must be `true`; anything else is rejected before signing. */
  reduceOnly?: boolean;
  /** Market size decimals (HL meta `szDecimals`); when set, size and price precision are checked too. */
  szDecimals?: number;
}

/**
 * Parameters for changing an open order (`/v1/hl/modify_order`).
 * Omitted or '' fields keep the order's current value; at least one of
 * `price`, `size`, `triggerPrice` is required.
 */
export interface HlModifyOrderParams extends HlManagedCredentials {
  /** Asset coin symbol of the order; builder-DEX markets as "dex:ASSET" */
  coin: string;
  /** Order id (oid) of the open order to change */
  orderId: string | number;
  /**
   * New limit / execution price. For a resting limit this is the new price.
   * For a TP/SL leave it out so a market trigger keeps its execution buffer.
   */
  price?: string;
  /** New remaining size in contracts. '0' only for a position-level TP/SL (= whole position). */
  size?: string;
  /** New trigger price. Only valid for TP/SL (trigger) orders. */
  triggerPrice?: string;
  /** Market size decimals (HL meta `szDecimals`); when set, precision is checked instead of rounded by the back-end. */
  szDecimals?: number;
}

/** Order state reported by HyperLiquid for a placed or modified order. */
export type HlOrderState = 'resting' | 'filled' | 'waitingForTrigger' | 'waitingForFill';

/**
 * Result of `hlModifyOrder`.
 */
export interface HlModifyOrderResult {
  isSuccess: boolean;
  code?: number;
  error?: string;
  retData?: {
    /** Id of the order that was replaced */
    previousOrderId: number;
    /** Id of the replacement order (HyperLiquid issues a new one); absent when the exchange did not return it */
    orderId?: number;
    status: HlOrderState;
    price: string;
    size: string;
    /** Present for TP/SL orders */
    triggerPrice?: string;
    triggerType?: 'tp' | 'sl';
    /** Set when the exchange accepted the change but the back-end's own bookkeeping did not; do not retry. */
    trackingWarning?: string;
  };
}

/**
 * Parameters for adding a missing take-profit and/or stop-loss to an open
 * position (`/v1/hl/add_position_tpsl`). At least one trigger price is required.
 */
export interface HlAddPositionTpslParams extends HlManagedCredentials {
  /** Asset coin symbol of the open position; builder-DEX markets as "dex:ASSET" */
  coin: string;
  /** Size the triggers cover, in contracts. Omit (or '') for the whole position; must not exceed it. */
  size?: string;
  /** Take-profit trigger price; omit or '' to add no take-profit */
  tpTriggerPrice?: string;
  /** Take-profit execution price; omit to let the back-end set it. Requires tpTriggerPrice. */
  tpPrice?: string;
  /** True (default) for a market trigger, false for a limit trigger */
  tpIsMarket?: boolean;
  /** Stop-loss trigger price; omit or '' to add no stop-loss */
  slTriggerPrice?: string;
  /** Stop-loss execution price; omit to let the back-end set it. Requires slTriggerPrice. */
  slPrice?: string;
  /** True (default) for a market trigger, false for a limit trigger */
  slIsMarket?: boolean;
  /** Market size decimals (HL meta `szDecimals`); when set, precision is checked instead of rounded by the back-end. */
  szDecimals?: number;
}

/** One trigger order created by `hlAddPositionTpsl`. */
export interface HlCreatedPositionTpsl {
  triggerType: 'tp' | 'sl';
  cloid: string;
  /** Order id; absent when the exchange has not reported it yet (read open orders) */
  orderId?: number;
  status: HlOrderState;
  triggerPrice: string;
  price: string;
  isMarket: boolean;
}

/**
 * Result of `hlAddPositionTpsl`.
 */
export interface HlAddPositionTpslResult {
  isSuccess: boolean;
  code?: number;
  error?: string;
  retData?: {
    coin: string;
    /** Size the triggers cover */
    size: string;
    /** Side of the trigger orders (true = buy, i.e. the position is short) */
    isBuy: boolean;
    createdOrders: HlCreatedPositionTpsl[];
    failedOrders: Array<{ triggerType: 'tp' | 'sl'; error: string }>;
    partialSuccess: boolean;
    trackingWarning?: string;
  };
}

/**
 * Parameters for closing (fully or partially) one perp position.
 * Side and size are resolved from the live HyperLiquid position — the caller
 * never supplies a direction.
 */
export interface ClosePerpPositionParams extends HlManagedCredentials {
  /** Asset coin symbol. Builder-DEX assets use the `dex:ASSET` form (e.g. "xyz:TSLA"). */
  coin: string;
  /** Builder DEX name for a bare `coin` (e.g. "xyz"). Must match the prefix if `coin` has one. */
  dex?: string;
  /** Size to close, as a decimal string. Omit for a full close. Must not exceed the position. */
  size?: string;
  /**
   * Ignored by the back-end, which always closes at its own mark ±5%. Omit it;
   * the current mark price is sent, as gdex.pro does.
   */
  price?: string;
  /**
   * Address whose HyperLiquid account holds the position — normally the
   * MANAGED wallet from sign-in. Defaults to `walletAddress`.
   */
  positionAddress?: string;
  /** Market size decimals (HL meta `szDecimals`); when set, a `size` with more decimals is rejected. */
  szDecimals?: number;
}

/**
 * The close order resolved from the live position (no order submitted yet).
 */
export interface PerpClosePlan {
  /** Coin as submitted (dex-prefixed for builder DEXes) */
  coin: string;
  /** Builder DEX the position lives on ('' for the default dex) */
  dex: string;
  /** Side of the open position */
  positionSide: PerpSide;
  /** Side of the close order: 'sell' closes a long, 'buy' closes a short */
  closeSide: 'buy' | 'sell';
  /** Order direction sent to the backend (true = buy) */
  isLong: boolean;
  /** Absolute position size before the close (exact HL string) */
  positionSize: string;
  /** Size being closed */
  size: string;
  /** Size left open after a full fill */
  remainingSize: string;
  /** True when the whole position is being closed */
  isFullClose: boolean;
}

/**
 * Result of closePerpPosition: the resolved plan plus the backend response.
 */
export interface ClosePerpPositionResult extends PerpClosePlan {
  order: HlOrderResult;
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

/**
 * @deprecated Parameters of `hlUpdateLeverage`, which always throws: the
 * back-end has no leverage route. Set leverage with `leverage` on `hlCreateOrder`.
 */
export interface HlUpdateLeverageParams extends HlManagedCredentials {
  /** Asset coin symbol (e.g., "BTC", "ETH") */
  coin: string;
  /** Leverage multiplier (e.g., 40 for 40x). Use maxLeverage from HL meta for max. */
  leverage: number;
  /** True for cross margin, false for isolated margin */
  isCross?: boolean;
}

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
  /** Not returned by create_order or place_order today (they answer `{ isSuccess: true }`); read open orders for ids. */
  orderId?: string;
}
