/**
 * Limit order actions — create, cancel, and list limit orders.
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import {
  LimitOrder,
  CreateLimitOrderParams,
  CancelLimitOrderParams,
  GetLimitOrdersParams,
} from '../types/orders';
import { validateAmount, validateChain, validateRequired, validateSlippage } from '../utils/validation';

/**
 * Create a limit order.
 *
 * @param client - Authenticated API client
 * @param params - Order parameters
 */
export async function createLimitOrder(
  client: GdexApiClient,
  params: CreateLimitOrderParams
): Promise<LimitOrder> {
  validateChain(params.chain);
  validateRequired(params.side, 'side');
  validateRequired(params.inputToken, 'inputToken');
  validateRequired(params.outputToken, 'outputToken');
  validateAmount(params.inputAmount, 'inputAmount');
  validateAmount(params.limitPrice, 'limitPrice');
  if (params.slippage !== undefined) validateSlippage(params.slippage);

  const payload = {
    chain: params.chain,
    side: params.side,
    inputToken: params.inputToken,
    outputToken: params.outputToken,
    inputAmount: params.inputAmount,
    limitPrice: params.limitPrice,
    slippage: params.slippage ?? 1,
    expireIn: params.expireIn,
    walletAddress: params.walletAddress,
  };

  return client.post<LimitOrder>(Endpoints.ORDERS_CREATE, payload);
}

/**
 * Cancel an existing limit order.
 *
 * @param client - Authenticated API client
 * @param params - Cancel parameters
 */
export async function cancelLimitOrder(
  client: GdexApiClient,
  params: CancelLimitOrderParams
): Promise<void> {
  validateRequired(params.orderId, 'orderId');
  validateChain(params.chain);

  const payload = {
    orderId: params.orderId,
    chain: params.chain,
    walletAddress: params.walletAddress,
  };

  await client.post<void>(Endpoints.ORDERS_CANCEL, payload);
}

/**
 * Get limit orders for a wallet.
 *
 * @param client - Authenticated API client
 * @param params - Query parameters
 */
export async function getLimitOrders(
  client: GdexApiClient,
  params: GetLimitOrdersParams
): Promise<LimitOrder[]> {
  validateRequired(params.walletAddress, 'walletAddress');

  const queryParams: Record<string, unknown> = {
    walletAddress: params.walletAddress,
  };

  if (params.chain !== undefined) queryParams.chain = params.chain;
  if (params.status) queryParams.status = params.status;
  if (params.page) queryParams.page = params.page;
  if (params.limit) queryParams.limit = params.limit;

  return client.get<LimitOrder[]>(Endpoints.ORDERS, queryParams);
}
