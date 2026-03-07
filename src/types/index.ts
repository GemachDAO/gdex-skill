/**
 * Re-exports all types from the GdexSkill SDK.
 */
export * from './common';
export * from './trading';
export * from './portfolio';
export * from './token';
export * from './orders';
export * from './perp';
export * from './copyTrade';
export * from './bridge';
export * from './managed';

/**
 * Top trader information.
 */
export interface TopTrader {
  /** Wallet address */
  address: string;
  /** Display label or ENS name */
  label?: string;
  /** Chain */
  chain: import('./common').SupportedChain;
  /** Total P&L in USD */
  totalPnlUsd: string;
  /** Win rate percentage */
  winRate: string;
  /** Number of trades */
  tradeCount: number;
  /** Total volume in USD */
  totalVolumeUsd: string;
  /** Average trade size in USD */
  avgTradeSize?: string;
  /** Performance over time periods */
  performance?: {
    pnl7d?: string;
    pnl30d?: string;
    roi?: string;
  };
}

/**
 * Parameters for fetching top traders.
 */
export interface TopTradersParams {
  /** Chain to filter traders by */
  chain?: import('./common').SupportedChain;
  /** Time period for rankings */
  period?: '1d' | '7d' | '30d' | 'all';
  /** Number of traders to return */
  limit?: number;
  /** Sort by field */
  sortBy?: 'pnl' | 'winRate' | 'volume' | 'tradeCount';
}

/**
 * Wallet information.
 */
export interface WalletInfo {
  /** Wallet address */
  address: string;
  /** Chain */
  chain: import('./common').SupportedChain;
  /** Native token balance */
  nativeBalance: string;
  /** Native token symbol */
  nativeSymbol: string;
  /** Total USD value of all assets */
  totalValueUsd?: string;
  /** Number of token holdings */
  tokenCount?: number;
}

/**
 * Parameters for fetching wallet info.
 */
export interface WalletInfoParams {
  /** Wallet address */
  walletAddress: string;
  /** Chain */
  chain: import('./common').SupportedChain;
}
