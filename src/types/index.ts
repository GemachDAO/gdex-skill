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
 * Top trader information (as returned by /v1/copy_trade/top_traders).
 *
 * Backend returns snake_case fields from the trader leaderboard.
 */
export interface TopTrader {
  /** MongoDB _id */
  _id?: string;
  /** Wallet address */
  wallet_address: string;
  /** Wallet address (alias) */
  address: string;
  /** Display name (from Twitter or custom) */
  name?: string;
  /** Short nickname */
  nickname?: string;
  /** Twitter username */
  twitter_username?: string;
  /** Twitter display name */
  twitter_name?: string;
  /** Twitter bio */
  twitter_description?: string;
  /** Avatar URL */
  avatar?: string;
  /** ENS name */
  ens?: string | null;
  /** Tags (e.g. "app_smart_money", "kol") */
  tags?: string[];
  /** Free-form tag */
  tag?: string | null;
  /** Realized profit in last 1 day (USD) */
  realized_profit_1d?: number;
  /** Realized profit in last 7 days (USD) */
  realized_profit_7d?: number;
  /** Realized profit in last 30 days (USD) */
  realized_profit_30d?: number;
  /** PnL ratio (1d) */
  pnl_1d?: number;
  /** PnL ratio (7d) */
  pnl_7d?: number;
  /** PnL ratio (30d) */
  pnl_30d?: number;
  /** Buy count (recent) */
  buy?: number;
  /** Buy count (30d) */
  buy_30d?: number;
  /** Sell count (recent) */
  sell?: number;
  /** Sell count (30d) */
  sell_30d?: number;
  /** Last activity timestamp (Unix seconds) */
  last_active?: number;
  /** Recent buy token addresses */
  recent_buy_tokens?: string[];
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
