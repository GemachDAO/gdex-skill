/**
 * Types for portfolio and balance management.
 */
import { SupportedChain } from './common';

/**
 * Parameters for fetching portfolio data.
 */
export interface PortfolioParams {
  /** User wallet address */
  walletAddress: string;
  /** Optional chain filter — if omitted, returns all chains */
  chain?: SupportedChain;
}

/**
 * Token balance for a specific chain.
 */
export interface Balance {
  /** Token contract address */
  tokenAddress: string;
  /** Token symbol */
  symbol: string;
  /** Token name */
  name: string;
  /** Token logo URL */
  logoUrl?: string;
  /** Decimal places of the token */
  decimals: number;
  /** Raw balance (in smallest unit as string) */
  rawBalance: string;
  /** Human-readable balance */
  balance: string;
  /** USD value of the balance */
  usdValue?: string;
  /** Token price in USD */
  priceUsd?: string;
  /** Percentage change in 24h */
  change24h?: string;
  /** Chain this balance belongs to */
  chain: SupportedChain;
}

/**
 * Aggregated cross-chain portfolio.
 */
export interface Portfolio {
  /** Total portfolio value in USD */
  totalValueUsd: string;
  /** Balances grouped by chain */
  balances: Balance[];
  /** Open perpetual positions */
  perpPositions?: import('./perp').PerpPosition[];
  /** Realized P&L */
  realizedPnl?: string;
  /** Unrealized P&L */
  unrealizedPnl?: string;
  /** Total P&L */
  totalPnl?: string;
}

/**
 * Parameters for fetching balance.
 */
export interface BalanceParams {
  /** User wallet address */
  walletAddress: string;
  /** Chain to query */
  chain: SupportedChain;
  /** Optional specific token address */
  tokenAddress?: string;
}

/**
 * A historical trade record.
 */
export interface TradeRecord {
  /** Unique trade identifier */
  id: string;
  /** Trade type */
  type: 'buy' | 'sell' | 'perp_open' | 'perp_close';
  /** Input token */
  inputToken: string;
  /** Output token */
  outputToken: string;
  /** Amount in */
  amountIn: string;
  /** Amount out */
  amountOut: string;
  /** USD value at time of trade */
  usdValue?: string;
  /** Chain */
  chain: SupportedChain;
  /** DEX used */
  dex?: string;
  /** Transaction hash */
  txHash: string;
  /** Unix timestamp */
  timestamp: number;
  /** Trade status */
  status: 'completed' | 'failed' | 'pending';
}

/**
 * Parameters for fetching trade history.
 */
export interface TradeHistoryParams {
  /** User wallet address */
  walletAddress: string;
  /** Optional chain filter */
  chain?: SupportedChain;
  /** Page number (1-indexed) */
  page?: number;
  /** Items per page */
  limit?: number;
  /** Start timestamp (Unix) */
  startTime?: number;
  /** End timestamp (Unix) */
  endTime?: number;
}
