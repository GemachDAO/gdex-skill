/**
 * Types for perpetual futures trading on HyperLiquid.
 */
import { TransactionResult } from './common';

/** Perpetual position side */
export type PerpSide = 'long' | 'short';

/**
 * An open perpetual position.
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
  /** Funding payment */
  fundingPayment?: string;
  /** Take-profit price */
  takeProfitPrice?: string;
  /** Stop-loss price */
  stopLossPrice?: string;
}

/**
 * Parameters for opening a perpetual position.
 */
export interface OpenPerpParams {
  /**
   * Asset coin symbol to trade (e.g., "BTC", "ETH", "SOL").
   * Must be a valid HyperLiquid asset.
   */
  coin: string;
  /** Trade direction */
  side: PerpSide;
  /**
   * Position size in USD notional value.
   * @example "1000" for a $1000 position
   */
  sizeUsd: string;
  /**
   * Leverage multiplier (1–50 depending on the asset).
   * @default 5
   */
  leverage?: number;
  /**
   * Slippage tolerance as a percentage.
   * @default 1
   */
  slippage?: number;
  /**
   * Take-profit price in USD.
   */
  takeProfitPrice?: string;
  /**
   * Stop-loss price in USD.
   */
  stopLossPrice?: string;
  /**
   * Margin mode.
   * @default "cross"
   */
  marginMode?: 'isolated' | 'cross';
  /** User wallet address */
  walletAddress?: string;
}

/**
 * Parameters for closing a perpetual position.
 */
export interface ClosePerpParams {
  /** Asset coin symbol */
  coin: string;
  /**
   * Percentage of position to close (1–100).
   * @default 100 (close entire position)
   */
  closePercent?: number;
  /** Slippage tolerance % */
  slippage?: number;
  /** User wallet address */
  walletAddress?: string;
}

/**
 * Parameters for setting perpetual leverage.
 */
export interface SetLeverageParams {
  /** Asset coin symbol */
  coin: string;
  /** Leverage value */
  leverage: number;
  /** Margin mode */
  marginMode?: 'isolated' | 'cross';
  /** User wallet address */
  walletAddress?: string;
}

/**
 * Parameters for fetching perp positions.
 */
export interface GetPositionsParams {
  /** User wallet address */
  walletAddress: string;
  /** Optional coin filter */
  coin?: string;
}

/**
 * Parameters for depositing to HyperLiquid perp.
 */
export interface PerpDepositParams {
  /** Amount in USDC to deposit */
  amount: string;
  /** User wallet address */
  walletAddress?: string;
}

/**
 * Parameters for withdrawing from HyperLiquid perp.
 */
export interface PerpWithdrawParams {
  /** Amount in USDC to withdraw */
  amount: string;
  /** User wallet address */
  walletAddress?: string;
}

/**
 * Result of a perpetual trading operation.
 */
export interface PerpResult extends TransactionResult {
  /** Asset coin symbol */
  coin: string;
  /** Position side */
  side?: PerpSide;
  /** Execution price */
  executionPrice?: string;
  /** Position size */
  size?: string;
  /** Realized P&L (when closing) */
  realizedPnl?: string;
  /** Order ID on HyperLiquid */
  orderId?: string;
}
