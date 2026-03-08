/**
 * Limit order actions — limit buy, limit sell, update/cancel, and list.
 *
 * Backend endpoints:
 *   GET  /v1/orders       — list active orders (session-key auth via query params)
 *   POST /v1/limit_buy    — create limit buy  (computedData + chainId)
 *   POST /v1/limit_sell   — create limit sell  (computedData + chainId)
 *   POST /v1/update_order — update or delete   (computedData + chainId)
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import {
  GetLimitOrdersParams,
  GetLimitOrdersResponse,
  LimitBuyParams,
  LimitBuyResponse,
  LimitSellParams,
  LimitSellResponse,
  UpdateOrderParams,
  UpdateOrderResponse,
} from '../types/orders';
import { validateRequired, validateAmount } from '../utils/validation';
import { buildLimitOrderComputedData } from '../utils/gdexManagedCrypto';

/**
 * List active limit orders for a user on a specific chain.
 *
 * Uses session-key auth (encrypted `data` query param), not full computedData.
 *
 * @param client - Authenticated API client
 * @param params - userId, data (encrypted session key), chainId
 */
export async function getLimitOrders(
  client: GdexApiClient,
  params: GetLimitOrdersParams,
): Promise<GetLimitOrdersResponse> {
  validateRequired(params.userId, 'userId');
  validateRequired(params.data, 'data');
  validateRequired(params.chainId, 'chainId');

  return client.get<GetLimitOrdersResponse>(Endpoints.ORDERS, {
    userId: params.userId,
    data: params.data,
    chainId: params.chainId,
  });
}

/**
 * Create a limit buy order — "buy token X when its price drops to Y."
 *
 * ABI: ['string','string','string','uint256','uint256','string']
 *   = [tokenAddress, amount, triggerPrice, profitPercent, lossPercent, nonce]
 * Signature: "limit_buy-{userId}-{data}"
 *
 * @param client - Authenticated API client
 * @param params - Limit buy parameters
 */
export async function limitBuy(
  client: GdexApiClient,
  params: LimitBuyParams,
): Promise<LimitBuyResponse> {
  validateRequired(params.tokenAddress, 'tokenAddress');
  validateAmount(params.amount, 'amount');
  validateAmount(params.triggerPrice, 'triggerPrice');

  const computedData = buildLimitOrderComputedData({
    action: 'limit_buy',
    apiKey: params.apiKey,
    userId: params.userId,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: {
      tokenAddress: params.tokenAddress,
      amount: params.amount,
      triggerPrice: params.triggerPrice,
      profitPercent: params.profitPercent ?? '0',
      lossPercent: params.lossPercent ?? '0',
    },
  });

  return client.post<LimitBuyResponse>(Endpoints.LIMIT_BUY, {
    computedData,
    chainId: params.chainId,
  });
}

/**
 * Create a limit sell order — "sell token X when price reaches Y."
 *
 * Auto-classifies as take-profit (trigger > current) or stop-loss (trigger <= current).
 *
 * ABI: ['string','string','string','string']
 *   = [tokenAddress, amount, triggerPrice, nonce]
 * Signature: "limit_sell-{userId}-{data}"
 *
 * @param client - Authenticated API client
 * @param params - Limit sell parameters
 */
export async function limitSell(
  client: GdexApiClient,
  params: LimitSellParams,
): Promise<LimitSellResponse> {
  validateRequired(params.tokenAddress, 'tokenAddress');
  validateAmount(params.amount, 'amount');
  validateAmount(params.triggerPrice, 'triggerPrice');

  const computedData = buildLimitOrderComputedData({
    action: 'limit_sell',
    apiKey: params.apiKey,
    userId: params.userId,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: {
      tokenAddress: params.tokenAddress,
      amount: params.amount,
      triggerPrice: params.triggerPrice,
    },
  });

  return client.post<LimitSellResponse>(Endpoints.LIMIT_SELL, {
    computedData,
    chainId: params.chainId,
  });
}

/**
 * Update or delete an existing limit order.
 *
 * To delete: set isDelete=true.
 * To update: provide new amount/triggerPrice/profitPercent/lossPercent.
 *
 * ABI: ['string','string','string','uint256','uint256','string','string']
 *   = [orderId, amount, triggerPrice, profitPercent, lossPercent, nonce, isDelete]
 * Signature: "update_order-{userId}-{data}"
 *
 * @param client - Authenticated API client
 * @param params - Update/delete parameters
 */
export async function updateOrder(
  client: GdexApiClient,
  params: UpdateOrderParams,
): Promise<UpdateOrderResponse> {
  validateRequired(params.orderId, 'orderId');

  const computedData = buildLimitOrderComputedData({
    action: 'update_order',
    apiKey: params.apiKey,
    userId: params.userId,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: {
      orderId: params.orderId,
      amount: params.amount ?? '0',
      triggerPrice: params.triggerPrice ?? '0',
      profitPercent: params.profitPercent ?? '0',
      lossPercent: params.lossPercent ?? '0',
      isDelete: params.isDelete ? '1' : '',
    },
  });

  return client.post<UpdateOrderResponse>(Endpoints.UPDATE_ORDER, {
    computedData,
    chainId: params.chainId,
  });
}

// ── Legacy aliases ──────────────────────────────────────────────────────────

/** @deprecated Use limitBuy() */
export const createLimitOrder = limitBuy;
/** @deprecated Use updateOrder() with isDelete=true */
export async function cancelLimitOrder(
  client: GdexApiClient,
  params: UpdateOrderParams,
): Promise<UpdateOrderResponse> {
  return updateOrder(client, { ...params, isDelete: true });
}
