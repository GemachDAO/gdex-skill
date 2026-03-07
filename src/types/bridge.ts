/**
 * Types for cross-chain bridge operations.
 */
import { SupportedChain } from './common';

/**
 * Parameters for a bridge operation.
 */
export interface BridgeParams {
  /** Source chain */
  fromChain: SupportedChain;
  /** Destination chain */
  toChain: SupportedChain;
  /** Token address on source chain */
  tokenAddress: string;
  /**
   * Amount to bridge.
   * @example "1.5" for 1.5 tokens
   */
  amount: string;
  /**
   * Destination wallet address.
   * Defaults to the same address on the destination chain.
   */
  destinationAddress?: string;
  /**
   * Slippage tolerance %.
   * @default 0.5
   */
  slippage?: number;
  /** Source wallet address */
  walletAddress?: string;
}

/**
 * Bridge quote information.
 */
export interface BridgeQuote {
  /** Source chain */
  fromChain: SupportedChain;
  /** Destination chain */
  toChain: SupportedChain;
  /** Input amount */
  inputAmount: string;
  /** Expected output amount (after fees) */
  outputAmount: string;
  /** Bridge fee in USD */
  feeUsd?: string;
  /** Estimated time in seconds */
  estimatedTime?: number;
  /** Bridge protocol used */
  protocol?: string;
}

/**
 * Result of a bridge operation.
 */
export interface BridgeResult {
  /** Source transaction hash */
  sourceTxHash: string;
  /** Destination transaction hash (may not be available immediately) */
  destinationTxHash?: string;
  /** Source chain */
  fromChain: SupportedChain;
  /** Destination chain */
  toChain: SupportedChain;
  /** Amount sent */
  inputAmount: string;
  /** Expected amount to receive */
  outputAmount: string;
  /** Bridge status */
  status: 'pending' | 'in_transit' | 'completed' | 'failed';
  /** Estimated completion timestamp */
  estimatedCompletionTime?: number;
  /** Bridge protocol */
  protocol?: string;
}
