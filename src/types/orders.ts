/**
 * Types for limit order operations.
 */
import { SupportedChain, OrderSide } from './common';

/**
 * A limit order.
 */
export interface LimitOrder {
  /** Unique order identifier */
  id: string;
  /** User wallet address */
  walletAddress: string;
  /** Chain */
  chain: SupportedChain;
  /** Order side */
  side: OrderSide;
  /** Input token address */
  inputToken: string;
  /** Output token address */
  outputToken: string;
  /** Input token symbol */
  inputSymbol?: string;
  /** Output token symbol */
  outputSymbol?: string;
  /** Input amount */
  inputAmount: string;
  /** Target output amount (at limit price) */
  targetOutputAmount: string;
  /** Limit price (output per input) */
  limitPrice: string;
  /** Slippage tolerance % */
  slippage?: number;
  /** Order status */
  status: 'open' | 'filled' | 'cancelled' | 'expired' | 'partially_filled';
  /** Amount already filled */
  filledAmount?: string;
  /** Expiry timestamp (Unix) */
  expiresAt?: number;
  /** Creation timestamp (Unix) */
  createdAt: number;
  /** Last updated timestamp (Unix) */
  updatedAt?: number;
  /** Transaction hash when filled */
  fillTxHash?: string;
}

/**
 * Parameters for creating a limit order.
 */
export interface CreateLimitOrderParams {
  /** Chain */
  chain: SupportedChain;
  /** Order side */
  side: OrderSide;
  /** Input token address */
  inputToken: string;
  /** Output token address */
  outputToken: string;
  /** Input amount */
  inputAmount: string;
  /**
   * Target limit price (output token per input token).
   * E.g., for a BUY order on SOL/USDC, this is how many SOL you expect per USDC.
   */
  limitPrice: string;
  /** Slippage tolerance % (default: 1) */
  slippage?: number;
  /** Expiry duration in seconds from now (optional) */
  expireIn?: number;
  /** User wallet address */
  walletAddress?: string;
}

/**
 * Parameters for cancelling a limit order.
 */
export interface CancelLimitOrderParams {
  /** Order ID to cancel */
  orderId: string;
  /** Chain the order is on */
  chain: SupportedChain;
  /** User wallet address */
  walletAddress?: string;
}

/**
 * Parameters for fetching limit orders.
 */
export interface GetLimitOrdersParams {
  /** User wallet address */
  walletAddress: string;
  /** Optional chain filter */
  chain?: SupportedChain;
  /** Filter by status */
  status?: LimitOrder['status'];
  /** Page */
  page?: number;
  /** Items per page */
  limit?: number;
}
