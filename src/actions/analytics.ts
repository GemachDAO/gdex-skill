/**
 * Portfolio analytics actions — wallet performance, nof1 analytics, native
 * token prices, and on-demand PnL generation.
 *
 * Backed by:
 *   GET  /v1/wallet_performance
 *   GET  /v1/nof1_analytics
 *   GET  /v1/native_prices
 *   POST /v1/generate_pnl
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import { validateRequired } from '../utils/validation';
import { buildWalletAliases, buildChainAliases } from '../utils/apiAliases';
import type { SupportedChain } from '../types/common';

export interface WalletPerformanceParams {
  walletAddress: string;
  chain?: SupportedChain;
  period?: '1d' | '7d' | '30d' | 'all' | string;
}

export interface Nof1AnalyticsParams {
  walletAddress: string;
  chain?: SupportedChain;
}

export interface NativePricesParams {
  /** Optional list of chain IDs to filter */
  chainIds?: Array<string | number>;
}

export interface GeneratePnlParams {
  walletAddress: string;
  chain?: SupportedChain;
  /** Optional from/to time bounds (unix seconds) */
  startTime?: number;
  endTime?: number;
}

/** Get wallet performance / PnL summary across recent periods. */
export async function getWalletPerformance(
  client: GdexApiClient,
  params: WalletPerformanceParams,
): Promise<Record<string, unknown>> {
  validateRequired(params.walletAddress, 'walletAddress');
  const query: Record<string, unknown> = {
    ...buildWalletAliases(params.walletAddress),
    ...buildChainAliases(params.chain),
  };
  if (params.period) query.period = params.period;
  return client.get(Endpoints.WALLET_PERFORMANCE, query);
}

/** Get NoF1 analytics (advanced trader benchmarking). */
export async function getNof1Analytics(
  client: GdexApiClient,
  params: Nof1AnalyticsParams,
): Promise<Record<string, unknown>> {
  validateRequired(params.walletAddress, 'walletAddress');
  return client.get(Endpoints.NOF1_ANALYTICS, {
    ...buildWalletAliases(params.walletAddress),
    ...buildChainAliases(params.chain),
  });
}

/** Get current native token prices (ETH, SOL, SUI, BNB, …) keyed by chain. */
export async function getNativePrices(
  client: GdexApiClient,
  params: NativePricesParams = {},
): Promise<Record<string, unknown>> {
  const query: Record<string, unknown> = {};
  if (params.chainIds && params.chainIds.length > 0) {
    query.chainIds = params.chainIds.join(',');
  }
  return client.get(Endpoints.NATIVE_PRICES, query);
}

/** Trigger backend PnL generation for a wallet. Returns a PnL summary report. */
export async function generatePnl(
  client: GdexApiClient,
  params: GeneratePnlParams,
): Promise<Record<string, unknown>> {
  validateRequired(params.walletAddress, 'walletAddress');
  const payload: Record<string, unknown> = {
    ...buildWalletAliases(params.walletAddress),
    ...buildChainAliases(params.chain),
  };
  if (params.startTime !== undefined) payload.startTime = params.startTime;
  if (params.endTime !== undefined) payload.endTime = params.endTime;
  return client.post(Endpoints.GENERATE_PNL, payload);
}
