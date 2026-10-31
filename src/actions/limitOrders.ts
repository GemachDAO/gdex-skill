/**
 * Limit order actions — limit buy, limit sell, update/cancel, and list.
 *
 * Backend endpoints:
 *   GET  /v1/orders       — list active orders (session-key auth via query params)
 *   POST /v1/limit_buy    — create limit buy  (computedData + chainId)
 *   POST /v1/limit_sell   — create limit sell  (computedData + chainId)
 *   POST /v1/update_order — update or delete   (computedData + chainId)
 *
 * Units (gbotTradingDashboardBackend src/api/services/ServiceMain.ts):
 *   - limit_buy `amount`: native token to spend, raw base units
 *     (`toUserTokenAmount(amount, getNativeDecimals(chainId))`, :3820).
 *   - limit_sell `amount`: token to sell, raw base units of that token
 *     (`toUserTokenAmount(amount, token.decimals)`, :4034).
 *   - `triggerPrice`: USD price as a decimal string (`parseFloat`, :3822, :3992).
 *   - `profitPercent` / `lossPercent`: whole numbers in `uint64` slots
 *     (decoder.ts:168-210); 0 means "no TP/SL" (:3913-3918); lossPercent < 100 (:3867).
 *   - update_order rewrites price, amount and TP/SL together (:4213-4235,
 *     :4265-4279), so a non-delete update needs every field; a delete reads none
 *     of them (:4196-4208).
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
import { validateRequired, validateAmount, parseRawAmount, parseIntegerPercent } from '../utils/validation';
import { GdexValidationError } from '../utils/errors';
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

/** TP/SL percentages: whole numbers, profit >= 0, loss in [0, 100). */
function tpSlPercents(profitPercent: string | undefined, lossPercent: string | undefined): { profitPercent: string; lossPercent: string } {
  return {
    profitPercent: profitPercent === undefined ? '0' : parseIntegerPercent(profitPercent, 'profitPercent'),
    lossPercent: lossPercent === undefined ? '0' : parseIntegerPercent(lossPercent, 'lossPercent', { max: 100, maxExclusive: true }),
  };
}

/**
 * Create a limit buy order — "buy token X when its price drops to Y."
 *
 * ABI: ['string','string','string','uint64','uint64','string']
 *   = [tokenAddress, amount, triggerPrice, profitPercent, lossPercent, nonce]
 * Signature: "limit_buy-{userId}-{data}"
 *
 * `amount` is raw native units; omitted profitPercent / lossPercent mean no TP / SL.
 *
 * @param client - Authenticated API client
 * @param params - Limit buy parameters
 * @throws {GdexValidationError} on a malformed amount, price or percentage (nothing is signed)
 */
export async function limitBuy(
  client: GdexApiClient,
  params: LimitBuyParams,
): Promise<LimitBuyResponse> {
  validateRequired(params.tokenAddress, 'tokenAddress');
  const amount = parseRawAmount(params.amount, 'amount').toString();
  validateAmount(params.triggerPrice, 'triggerPrice');
  const percents = tpSlPercents(params.profitPercent, params.lossPercent);

  const computedData = buildLimitOrderComputedData({
    action: 'limit_buy',
    apiKey: params.apiKey,
    userId: params.userId,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: {
      tokenAddress: params.tokenAddress,
      amount,
      triggerPrice: params.triggerPrice,
      ...percents,
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
 * `amount` is raw units of the token being sold.
 *
 * @param params - Limit sell parameters
 * @throws {GdexValidationError} on a malformed amount or price (nothing is signed)
 */
export async function limitSell(
  client: GdexApiClient,
  params: LimitSellParams,
): Promise<LimitSellResponse> {
  validateRequired(params.tokenAddress, 'tokenAddress');
  const amount = parseRawAmount(params.amount, 'amount').toString();
  validateAmount(params.triggerPrice, 'triggerPrice');

  const computedData = buildLimitOrderComputedData({
    action: 'limit_sell',
    apiKey: params.apiKey,
    userId: params.userId,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: {
      tokenAddress: params.tokenAddress,
      amount,
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
 * To delete: set isDelete=true (no other fields are read).
 * To update: pass the order's full new state. The backend overwrites price,
 * amount and (for buy orders) TP/SL together, so `amount`, `triggerPrice`,
 * `profitPercent` and `lossPercent` are all required; nothing is defaulted.
 * Pass '0' for no TP / SL (sell orders ignore both).
 *
 * ABI: ['string','string','string','uint64','uint64','string','bool']
 *   = [orderId, amount, triggerPrice, profitPercent, lossPercent, nonce, isDelete]
 * Signature: "update_order-{userId}-{data}"
 *
 * @param client - Authenticated API client
 * @param params - Update/delete parameters
 * @throws {GdexValidationError} on a missing or malformed field (nothing is signed)
 */
export async function updateOrder(
  client: GdexApiClient,
  params: UpdateOrderParams,
): Promise<UpdateOrderResponse> {
  validateRequired(params.orderId, 'orderId');

  let fields: { amount: string; triggerPrice: string; profitPercent: string; lossPercent: string };
  if (params.isDelete === true) {
    // A delete returns before amount/price/TP/SL are read (ServiceMain.ts:4196-4208);
    // the slots still need well-typed placeholders for the ABI.
    fields = { amount: '0', triggerPrice: '0', profitPercent: '0', lossPercent: '0' };
  } else {
    for (const f of ['amount', 'triggerPrice', 'profitPercent', 'lossPercent'] as const) {
      if (params[f] === undefined || params[f] === '') {
        throw new GdexValidationError(
          `${f} is required to update an order: the backend replaces amount, triggerPrice and TP/SL together ` +
            "(pass '0' for no TP/SL; use isDelete: true to cancel)",
          f,
        );
      }
    }
    validateAmount(params.triggerPrice as string, 'triggerPrice');
    fields = {
      amount: parseRawAmount(params.amount as string, 'amount').toString(),
      triggerPrice: params.triggerPrice as string,
      ...tpSlPercents(params.profitPercent, params.lossPercent),
    };
  }

  const computedData = buildLimitOrderComputedData({
    action: 'update_order',
    apiKey: params.apiKey,
    userId: params.userId,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: {
      orderId: params.orderId,
      ...fields,
      isDelete: params.isDelete === true,
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
