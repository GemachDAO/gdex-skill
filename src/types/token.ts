/**
 * Types for token information, trending tokens, and OHLCV data.
 */
import { SupportedChain } from './common';

/**
 * Parameters for fetching token details.
 */
export interface TokenDetailsParams {
  /** Token contract address */
  tokenAddress: string;
  /** Chain the token is on */
  chain: SupportedChain;
}

/**
 * Detailed token information.
 */
export interface TokenDetails {
  /** Token contract address */
  address: string;
  /** Token symbol */
  symbol: string;
  /** Token name */
  name: string;
  /** Token logo URL */
  logoUrl?: string;
  /** Number of decimals */
  decimals: number;
  /** Chain the token is on */
  chain: SupportedChain;
  /** Current price in USD */
  priceUsd?: string;
  /** Price change in the last 24 hours (%) */
  priceChange24h?: string;
  /** Price change in the last 1 hour (%) */
  priceChange1h?: string;
  /** Market capitalization in USD */
  marketCap?: string;
  /** Fully diluted market cap in USD */
  fdv?: string;
  /** Total supply */
  totalSupply?: string;
  /** Circulating supply */
  circulatingSupply?: string;
  /** 24h trading volume in USD */
  volume24h?: string;
  /** Liquidity in USD */
  liquidity?: string;
  /** Token creation timestamp */
  createdAt?: number;
  /** Associated DEX pools */
  pools?: TokenPool[];
  /** Social links */
  socials?: {
    website?: string;
    twitter?: string;
    telegram?: string;
    discord?: string;
  };
}

/**
 * DEX pool information for a token.
 */
export interface TokenPool {
  /** Pool address */
  address: string;
  /** DEX name */
  dex: string;
  /** Paired token address */
  pairedToken: string;
  /** Paired token symbol */
  pairedSymbol: string;
  /** Pool liquidity in USD */
  liquidity?: string;
  /** Pool 24h volume in USD */
  volume24h?: string;
}

/**
 * Parameters for fetching trending tokens.
 */
export interface TrendingParams {
  /** Chain to get trending tokens for */
  chain?: SupportedChain;
  /** Time period for trending */
  period?: '1h' | '6h' | '24h' | '7d';
  /** Number of tokens to return */
  limit?: number;
  /** Minimum liquidity filter in USD */
  minLiquidity?: number;
  /** Minimum volume filter in USD */
  minVolume?: number;
}

/**
 * A trending token entry.
 */
export interface TrendingToken {
  /** Rank position */
  rank: number;
  /** Token address */
  address: string;
  /** Token symbol */
  symbol: string;
  /** Token name */
  name: string;
  /** Token logo URL */
  logoUrl?: string;
  /** Chain */
  chain: SupportedChain;
  /** Current price in USD */
  priceUsd: string;
  /** Price change % */
  priceChange: string;
  /** 24h volume in USD */
  volume24h: string;
  /** Liquidity in USD */
  liquidity: string;
  /** Market cap in USD */
  marketCap?: string;
  /** Transactions in 24h */
  txCount24h?: number;
}

/**
 * OHLCV (Open/High/Low/Close/Volume) candle data.
 */
export interface OHLCVCandle {
  /** Candle open time (Unix timestamp) */
  time: number;
  /** Opening price */
  open: string;
  /** Highest price */
  high: string;
  /** Lowest price */
  low: string;
  /** Closing price */
  close: string;
  /** Trading volume */
  volume: string;
}

/**
 * Parameters for fetching OHLCV data.
 */
export interface OHLCVParams {
  /** Token address */
  tokenAddress: string;
  /** Chain */
  chain: SupportedChain;
  /** Candle resolution */
  resolution: '1' | '5' | '15' | '30' | '60' | '240' | 'D' | 'W';
  /** Start timestamp (Unix) */
  from?: number;
  /** End timestamp (Unix) */
  to?: number;
  /** Number of candles to return */
  limit?: number;
}

/**
 * OHLCV data response.
 */
export interface OHLCVData {
  /** Token address */
  tokenAddress: string;
  /** Chain */
  chain: SupportedChain;
  /** Candle resolution */
  resolution: string;
  /** Candle data */
  candles: OHLCVCandle[];
}
