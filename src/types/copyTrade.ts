/**
 * Types for copy trading operations.
 */
import { SupportedChain } from './common';

/**
 * Copy trade settings for a user.
 */
export interface CopyTradeSettings {
  /** User ID */
  userId?: string;
  /** Whether copy trading is enabled */
  enabled: boolean;
  /**
   * Maximum trade size in USD per copied trade.
   * @example "100" to limit each copied trade to $100
   */
  maxTradeSize?: string;
  /**
   * Slippage tolerance for copied trades (%).
   * @default 1
   */
  slippage?: number;
  /**
   * Delay in milliseconds before executing a copied trade (to avoid front-running).
   * @default 0
   */
  delay?: number;
  /**
   * Whether to copy only buy orders.
   * @default false
   */
  copyBuysOnly?: boolean;
  /**
   * Whether to copy only sell orders.
   * @default false
   */
  copySellsOnly?: boolean;
  /**
   * Chains to copy trades on.
   * If empty, copies on all chains.
   */
  chains?: SupportedChain[];
  /**
   * Maximum number of simultaneous positions.
   */
  maxPositions?: number;
  /**
   * Auto stop-loss percentage (0 disables).
   */
  autoStopLossPercent?: number;
}

/**
 * A wallet being tracked for copy trading.
 */
export interface CopyTradeWallet {
  /** Wallet address to track */
  address: string;
  /** Optional label/alias */
  label?: string;
  /** Chain this wallet operates on */
  chain: SupportedChain;
  /** Whether tracking is active */
  active: boolean;
  /** When tracking started (Unix timestamp) */
  addedAt?: number;
  /** Performance stats */
  stats?: {
    totalCopiedTrades: number;
    profitableTrades: number;
    totalPnlUsd: string;
    winRate: string;
  };
}

/**
 * Parameters for adding a wallet to copy trade.
 */
export interface AddWalletParams {
  /** Wallet address to track */
  walletAddress: string;
  /** Chain the wallet is on */
  chain: SupportedChain;
  /** Optional label */
  label?: string;
  /** User ID */
  userId?: string;
}

/**
 * Parameters for removing a copy-traded wallet.
 */
export interface RemoveWalletParams {
  /** Wallet address to remove */
  walletAddress: string;
  /** Chain the wallet is on */
  chain: SupportedChain;
  /** User ID */
  userId?: string;
}

/**
 * Parameters for getting copy trade settings.
 */
export interface GetCopyTradeSettingsParams {
  /** User ID */
  userId: string;
  /** Optional chain filter */
  chain?: SupportedChain;
}
