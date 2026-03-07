/**
 * Portfolio actions — fetch balances, trade history, and portfolio data.
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import {
  Portfolio,
  Balance,
  TradeRecord,
  PortfolioParams,
  BalanceParams,
  TradeHistoryParams,
} from '../types/portfolio';
import { validateChain, validateRequired } from '../utils/validation';

/**
 * Get the full portfolio for a wallet address.
 *
 * Returns balances across all chains (or a specific chain) with USD values.
 *
 * @param client - API client
 * @param params - Portfolio query parameters
 */
export async function getPortfolio(client: GdexApiClient, params: PortfolioParams): Promise<Portfolio> {
  validateRequired(params.walletAddress, 'walletAddress');
  if (params.chain !== undefined) validateChain(params.chain);

  const queryParams: Record<string, unknown> = {
    walletAddress: params.walletAddress,
  };
  if (params.chain !== undefined) queryParams.chain = params.chain;

  return client.get<Portfolio>(Endpoints.PORTFOLIO, queryParams);
}

/**
 * Get token balances for a wallet on a specific chain.
 *
 * @param client - API client
 * @param params - Balance query parameters
 */
export async function getBalances(client: GdexApiClient, params: BalanceParams): Promise<Balance[]> {
  validateRequired(params.walletAddress, 'walletAddress');
  validateChain(params.chain);

  const queryParams: Record<string, unknown> = {
    walletAddress: params.walletAddress,
    chain: params.chain,
  };
  if (params.tokenAddress) queryParams.tokenAddress = params.tokenAddress;

  return client.get<Balance[]>(Endpoints.BALANCES, queryParams);
}

/**
 * Get trade history for a wallet.
 *
 * @param client - API client
 * @param params - History query parameters
 */
export async function getTradeHistory(
  client: GdexApiClient,
  params: TradeHistoryParams
): Promise<TradeRecord[]> {
  validateRequired(params.walletAddress, 'walletAddress');
  if (params.chain !== undefined) validateChain(params.chain);

  const queryParams: Record<string, unknown> = {
    walletAddress: params.walletAddress,
  };

  if (params.chain !== undefined) queryParams.chain = params.chain;
  if (params.page) queryParams.page = params.page;
  if (params.limit) queryParams.limit = params.limit;
  if (params.startTime) queryParams.startTime = params.startTime;
  if (params.endTime) queryParams.endTime = params.endTime;

  return client.get<TradeRecord[]>(Endpoints.TRADE_HISTORY, queryParams);
}
