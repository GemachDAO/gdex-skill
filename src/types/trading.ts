/**
 * Types for spot trading operations (buy/sell tokens).
 */
import { SupportedChain, SupportedDex, TransactionResult } from './common';

/**
 * Parameters for buying a token.
 */
export interface BuyTokenParams {
  /** Blockchain chain to execute the trade on */
  chain: SupportedChain;
  /** Token contract address to buy */
  tokenAddress: string;
  /**
   * Amount of native token (or input token) to spend.
   * Use a string to avoid floating-point precision issues.
   * @example "0.1" for 0.1 SOL
   */
  amount: string;
  /**
   * Slippage tolerance as a percentage (0–100).
   * @default 1
   * @example 1 for 1% slippage
   */
  slippage?: number;
  /**
   * Preferred DEX to use for the swap.
   * If omitted, the backend selects the best route.
   */
  dex?: SupportedDex;
  /**
   * User wallet address initiating the trade.
   * Required for authenticated requests.
   */
  walletAddress?: string;
  /**
   * Optional referrer address for fee sharing.
   */
  referrer?: string;
  /**
   * Optional priority fee in lamports (Solana only).
   */
  priorityFee?: number;
  /**
   * Input token address. Defaults to native token of the chain.
   */
  inputToken?: string;
}

/**
 * Parameters for selling a token.
 */
export interface SellTokenParams {
  /** Blockchain chain to execute the trade on */
  chain: SupportedChain;
  /** Token contract address to sell */
  tokenAddress: string;
  /**
   * Amount of tokens to sell.
   * Can be an absolute amount or a percentage string like "50%" to sell 50% of holdings.
   */
  amount: string;
  /**
   * Slippage tolerance as a percentage (0–100).
   * @default 1
   */
  slippage?: number;
  /**
   * Preferred DEX to use for the swap.
   * If omitted, the backend selects the best route.
   */
  dex?: SupportedDex;
  /**
   * User wallet address initiating the trade.
   */
  walletAddress?: string;
  /**
   * Optional referrer address for fee sharing.
   */
  referrer?: string;
  /**
   * Optional priority fee in lamports (Solana only).
   */
  priorityFee?: number;
  /**
   * Output token address. Defaults to native token of the chain.
   */
  outputToken?: string;
}

/**
 * Result of a spot trade (buy or sell) operation.
 */
export interface TradeResult extends TransactionResult {
  /** Input token address */
  inputToken: string;
  /** Output token address */
  outputToken: string;
  /** Amount of input token spent */
  inputAmount: string;
  /** Amount of output token received */
  outputAmount: string;
  /** Execution price (outputAmount / inputAmount) */
  executionPrice: string;
  /** Price impact as a percentage */
  priceImpact?: string;
  /** DEX used for the swap */
  dex?: string;
  /** Unique trade/job ID from the backend queue */
  jobId?: string;
}

/**
 * Parameters for getting a quote without executing a trade.
 */
export interface QuoteParams {
  /** Blockchain chain */
  chain: SupportedChain;
  /** Input token address */
  inputToken: string;
  /** Output token address */
  outputToken: string;
  /** Amount of input token */
  amount: string;
  /** Slippage tolerance */
  slippage?: number;
}

/**
 * Quote result.
 */
export interface QuoteResult {
  /** Expected output amount */
  outputAmount: string;
  /** Execution price */
  price: string;
  /** Price impact percentage */
  priceImpact: string;
  /** Best route DEX */
  dex: string;
  /** Minimum output amount after slippage */
  minimumReceived: string;
}
