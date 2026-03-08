/**
 * Perpetual futures trading actions on HyperLiquid via GDEX managed custody.
 *
 * Write operations: ABI-encode → sign with session key → encrypt → POST computedData.
 * Read operations: Query the HyperLiquid L1 directly via @nktkas/hyperliquid PublicClient.
 */
import { HttpTransport, InfoClient } from '@nktkas/hyperliquid';
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import {
  GetPositionsParams,
  HlAccountState,
  HlCancelAllOrdersParams,
  HlCancelOrderParams,
  HlCloseAllParams,
  HlCreateOrderParams,
  HlPlaceOrderParams,
  HlResponse,
  HlOrderResult,
  HlUpdateLeverageParams,
  PerpDepositParams,
  PerpPosition,
  PerpWithdrawParams,
} from '../types/perp';
import { validateAmount, validateCoin, validateRequired } from '../utils/validation';
import { buildHlComputedData } from '../utils/gdexManagedCrypto';

// Create HL InfoClient on demand
function getHlClient(): InfoClient {
  return new InfoClient({ transport: new HttpTransport() });
}

// ── Read operations (direct HyperLiquid L1 queries) ──────────────────────────

/**
 * Get the full HyperLiquid clearinghouse state for a wallet.
 * Includes margin summary, positions, and withdrawable balance.
 */
export async function getHlAccountState(walletAddress: string): Promise<HlAccountState> {
  validateRequired(walletAddress, 'walletAddress');
  const state = await getHlClient().clearinghouseState({ user: walletAddress });

  const positions: PerpPosition[] = state.assetPositions.map((ap: any) => {
    const p = ap.position;
    const sizeNum = parseFloat(p.szi);
    return {
      coin: p.coin,
      side: sizeNum >= 0 ? 'long' as const : 'short' as const,
      size: Math.abs(sizeNum).toString(),
      entryPrice: p.entryPx ?? '0',
      markPrice: '0', // not available in clearinghouseState; use getHlMarkPrice
      leverage: p.leverage.value,
      liquidationPrice: p.liquidationPx ?? undefined,
      unrealizedPnl: p.unrealizedPnl,
      margin: p.marginUsed,
      positionValue: p.positionValue,
    };
  });

  return {
    accountValue: state.crossMarginSummary.accountValue,
    totalNtlPos: state.crossMarginSummary.totalNtlPos,
    totalRawUsd: state.crossMarginSummary.totalRawUsd,
    totalMarginUsed: state.crossMarginSummary.totalMarginUsed,
    withdrawable: state.withdrawable,
    positions,
  };
}

/**
 * Get open perpetual positions for a wallet.
 * Convenience wrapper around getHlAccountState().
 */
export async function getPerpPositions(params: GetPositionsParams): Promise<PerpPosition[]> {
  const state = await getHlAccountState(params.walletAddress);
  if (params.coin) {
    return state.positions.filter((p) => p.coin.toUpperCase() === params.coin!.toUpperCase());
  }
  return state.positions;
}

/**
 * Get the mark price for an asset from the HyperLiquid L2 book.
 */
export async function getHlMarkPrice(coin: string): Promise<number> {
  validateCoin(coin);
  const book = await getHlClient().l2Book({ coin: coin.toUpperCase() });
  if (!book) return 0;
  const asks = book.levels[1];
  return asks.length > 0 ? Number(asks[asks.length - 1].px) : 0;
}

/**
 * Get the USDC balance available on HyperLiquid for a wallet.
 */
export async function getHlUsdcBalance(walletAddress: string): Promise<number> {
  const state = await getHlClient().clearinghouseState({ user: walletAddress });
  const accountValue = Number(state.crossMarginSummary?.accountValue ?? 0);
  const totalMarginUsed = Number(state.crossMarginSummary?.totalMarginUsed ?? 0);
  return accountValue - totalMarginUsed;
}

/**
 * Get open orders on HyperLiquid.
 */
export async function getHlOpenOrders(walletAddress: string) {
  validateRequired(walletAddress, 'walletAddress');
  return getHlClient().frontendOpenOrders({ user: walletAddress });
}

/**
 * Get USDC balance via the GDEX backend (uses the managed custody session).
 */
export async function getGbotUsdcBalance(client: GdexApiClient, walletAddress: string): Promise<number> {
  validateRequired(walletAddress, 'walletAddress');
  const result = await client.get<{ balance: number }>(
    Endpoints.HL_GBOT_USDC_BALANCE,
    { address: walletAddress.toLowerCase() },
  );
  return result.balance ?? 0;
}

// ── Write operations (managed-custody computedData flow) ─────────────────────

/**
 * Deposit USDC into HyperLiquid via managed custody.
 *
 * @param client - Authenticated API client
 * @param params - Deposit parameters including chainId & tokenAddress
 */
export async function perpDeposit(client: GdexApiClient, params: PerpDepositParams): Promise<HlResponse> {
  validateAmount(params.amount, 'amount');
  validateRequired(params.walletAddress, 'walletAddress');
  validateRequired(params.tokenAddress, 'tokenAddress');
  validateRequired(params.chainId, 'chainId');

  // Convert human-readable USDC to smallest unit (6 decimals)
  const amountSmallestUnit = BigInt(Math.round(parseFloat(params.amount) * 1e6)).toString();

  const computedData = buildHlComputedData({
    action: 'hl_deposit',
    apiKey: params.apiKey,
    walletAddress: params.walletAddress,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: {
      chainId: params.chainId,
      tokenAddress: params.tokenAddress,
      amount: amountSmallestUnit,
    },
  });

  return client.post<HlResponse>(Endpoints.HL_DEPOSIT, { computedData });
}

/**
 * Withdraw USDC from HyperLiquid via managed custody.
 */
export async function perpWithdraw(client: GdexApiClient, params: PerpWithdrawParams): Promise<HlResponse> {
  validateAmount(params.amount, 'amount');
  validateRequired(params.walletAddress, 'walletAddress');

  const computedData = buildHlComputedData({
    action: 'hl_withdraw',
    apiKey: params.apiKey,
    walletAddress: params.walletAddress,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: { amount: params.amount },
  });

  return client.post<HlResponse>(Endpoints.HL_WITHDRAW, { computedData });
}

/**
 * Place a market or limit order with optional TP/SL on HyperLiquid.
 * This is the primary way to open/close positions.
 */
export async function hlCreateOrder(client: GdexApiClient, params: HlCreateOrderParams): Promise<HlOrderResult> {
  validateCoin(params.coin);
  validateRequired(params.price, 'price');
  validateRequired(params.size, 'size');
  validateRequired(params.walletAddress, 'walletAddress');

  const computedData = buildHlComputedData({
    action: 'hl_create_order',
    apiKey: params.apiKey,
    walletAddress: params.walletAddress,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: {
      coin: params.coin.toUpperCase(),
      isLong: params.isLong,
      price: params.price,
      size: params.size,
      reduceOnly: params.reduceOnly ?? false,
      tpPrice: params.tpPrice ?? '',
      slPrice: params.slPrice ?? '',
      isMarket: params.isMarket ?? true,
    },
  });

  return client.post<HlOrderResult>(Endpoints.HL_CREATE_ORDER, { computedData });
}

/**
 * Place a simple order (no TP/SL) on HyperLiquid.
 */
export async function hlPlaceOrder(client: GdexApiClient, params: HlPlaceOrderParams): Promise<HlOrderResult> {
  validateCoin(params.coin);
  validateRequired(params.price, 'price');
  validateRequired(params.size, 'size');
  validateRequired(params.walletAddress, 'walletAddress');

  const computedData = buildHlComputedData({
    action: 'hl_place_order',
    apiKey: params.apiKey,
    walletAddress: params.walletAddress,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: {
      coin: params.coin.toUpperCase(),
      isLong: params.isLong,
      price: params.price,
      size: params.size,
      reduceOnly: params.reduceOnly ?? false,
    },
  });

  return client.post<HlOrderResult>(Endpoints.HL_PLACE_ORDER, { computedData });
}

/**
 * Close all open positions on HyperLiquid.
 */
export async function hlCloseAll(client: GdexApiClient, params: HlCloseAllParams): Promise<HlResponse> {
  validateRequired(params.walletAddress, 'walletAddress');

  const computedData = buildHlComputedData({
    action: 'hl_close_all',
    apiKey: params.apiKey,
    walletAddress: params.walletAddress,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: {},
  });

  return client.post<HlResponse>(Endpoints.HL_CLOSE_ALL, { computedData });
}

/**
 * Cancel a specific order on HyperLiquid.
 */
export async function hlCancelOrder(client: GdexApiClient, params: HlCancelOrderParams): Promise<HlResponse> {
  validateCoin(params.coin);
  validateRequired(params.orderId, 'orderId');
  validateRequired(params.walletAddress, 'walletAddress');

  const computedData = buildHlComputedData({
    action: 'hl_cancel_order',
    apiKey: params.apiKey,
    walletAddress: params.walletAddress,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: {
      coin: params.coin.toUpperCase(),
      orderId: params.orderId,
    },
  });

  return client.post<HlResponse>(Endpoints.HL_CANCEL_ORDER, { computedData });
}

/**
 * Cancel all open orders on HyperLiquid.
 */
export async function hlCancelAllOrders(client: GdexApiClient, params: HlCancelAllOrdersParams): Promise<HlResponse> {
  validateRequired(params.walletAddress, 'walletAddress');

  const computedData = buildHlComputedData({
    action: 'hl_cancel_all_orders',
    apiKey: params.apiKey,
    walletAddress: params.walletAddress,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: {},
  });

  return client.post<HlResponse>(Endpoints.HL_CANCEL_ORDER, { computedData, isCancelAll: true });
}

/**
 * Update leverage for a specific asset on HyperLiquid.
 * The backend normally calls setMaxLeverage() before each trade,
 * but this allows explicit leverage configuration.
 */
export async function hlUpdateLeverage(client: GdexApiClient, params: HlUpdateLeverageParams): Promise<HlResponse> {
  validateCoin(params.coin);
  validateRequired(params.walletAddress, 'walletAddress');

  const computedData = buildHlComputedData({
    action: 'hl_update_leverage',
    apiKey: params.apiKey,
    walletAddress: params.walletAddress,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: {
      coin: params.coin.toUpperCase(),
      leverage: params.leverage,
      isCross: params.isCross ?? true,
    },
  });

  return client.post<HlResponse>(Endpoints.HL_UPDATE_LEVERAGE, { computedData });
}
