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
 * Detailed token information (as returned by /v1/token_details).
 *
 * The backend stores tokens in MongoDB with these fields.
 */
export interface TokenDetails {
  /** MongoDB _id (internal) */
  _id?: string | null;
  /** Token contract address */
  address: string;
  /** Numeric chain ID */
  chainId: number;
  /** Token symbol (may include $ prefix e.g. "$WIF") */
  symbol: string;
  /** Token name */
  name: string;
  /** Number of decimals */
  decimals: number;
  /** Current price in USD */
  priceUsd?: number | string;
  /** Current price in native token (ETH/SOL) */
  priceNative?: number | string;
  /** Market capitalization in USD */
  marketCap?: number;
  /** Total supply in raw units */
  totalSupply?: string;
  /** Liquidity in USD */
  liquidityUsd?: number;
  /** Liquidity in native token */
  liquidityEth?: number;
  /** Native reserves in pool */
  ethReserve?: number;
  /** Token reserves in pool */
  tokenReserve?: number;
  /** User's share of native reserves */
  userEthReserve?: number;
  /** User's share of token reserves */
  userTokenReserve?: number;
  /** DEX pair address */
  pairAddress?: string;
  /** Primary DEX name (e.g. "raydium") */
  dexId?: string;
  /** All DEXes this token is on */
  dexes?: string[];
  /** Whether listed on a DEX */
  isListedOnDex?: boolean;
  /** Whether on Raydium */
  isRaydium?: boolean;
  /** Whether on Meteora */
  isMeteora?: boolean;
  /** Whether launched via pump.fun */
  isPumpfun?: boolean;
  /** Whether on PumpSwap */
  isPumpSwap?: boolean;
  /** Whether on Raydium LaunchLab */
  isRaydiumLaunchLab?: boolean;
  /** Price changes by period */
  priceChanges?: {
    m5?: number;
    h1?: number;
    h6?: number;
    h24?: number;
  };
  /** Volume by period */
  volumes?: {
    m5?: number;
    h1?: number;
    h6?: number;
    h24?: number;
  };
  /** Social/branding info */
  socialInfo?: {
    telegramUrl?: string;
    twitterUrl?: string;
    websiteUrl?: string;
    logoUrl?: string;
  };
  /** Security audit info */
  securities?: {
    mintAbility?: boolean;
    freezeAbility?: boolean;
    mintAddress?: string;
    freezeAddress?: string;
    lpLockPercentage?: number;
    topHoldersPercentage?: number;
    isValidTop10HoldersPercent?: boolean;
    holderCount?: number;
    contractVerified?: number;
    buyTax?: number;
    sellTax?: number;
  };
  /** Security tag summary */
  securitiesTag?: string;
  /** Bonding curve progress (pump.fun tokens) */
  bondingCurveProgress?: number;
  /** Token creation timestamp (Unix ms) */
  createdTime?: number;
  /** Search array for text matching */
  searchArray?: string[];
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
 * A trending token entry (same MongoDB schema as TokenDetails).
 *
 * The /v1/trending/list endpoint returns tokens from the same collection,
 * so the shape is identical to TokenDetails.
 */
export type TrendingToken = TokenDetails;

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
