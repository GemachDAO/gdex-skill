/**
 * Perpetual futures trading actions on HyperLiquid via GDEX managed custody.
 *
 * Write operations: ABI-encode → sign with session key → encrypt → POST computedData.
 * Read operations: Query the HyperLiquid L1 via @gdexsdk/hyper-liquid-trader SDK.
 *
 * Direct execution (private key trading): Uses HyperLiquidTrading class for
 * cross perp, isolated perp, and spot execution without managed custody.
 */
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

// Lazy-load @gdexsdk/hyper-liquid-trader to avoid CJS/ESM incompatibility
// with @noble/hashes v2 (ESM-only) on Node < 22.
// In production: dynamic import() preserves ESM semantics in CJS output.
// In Jest: require() so moduleNameMapper can intercept it.
let _hlTraderModule: { HyperLiquidTrading: any } | null = null;
async function getHlTraderModule(): Promise<{ HyperLiquidTrading: any }> {
  if (!_hlTraderModule) {
    if (process.env.JEST_WORKER_ID) {
      _hlTraderModule = require('@gdexsdk/hyper-liquid-trader');
    } else {
      const dynamicImport = new Function('modulePath', 'return import(modulePath)');
      _hlTraderModule = await dynamicImport('@gdexsdk/hyper-liquid-trader');
    }
  }
  return _hlTraderModule!;
}

// Singleton HyperLiquidTrading instance for read operations
let _hlTrader: any = null;
async function getHlTrader() {
  if (!_hlTrader) {
    const { HyperLiquidTrading } = await getHlTraderModule();
    _hlTrader = new HyperLiquidTrading();
  }
  return _hlTrader;
}

/**
 * Create a fresh HyperLiquidTrading instance (e.g. for direct execution).
 * Useful when callers need their own instance with custom WS URLs.
 */
export async function createHlTrader(wsUrls?: string[]) {
  const { HyperLiquidTrading } = await getHlTraderModule();
  return new HyperLiquidTrading(wsUrls);
}

// ── Read operations (HyperLiquid L1 queries via @gdexsdk/hyper-liquid-trader) ─

/**
 * Get the full HyperLiquid clearinghouse state for a wallet.
 * Includes margin summary, positions, and withdrawable balance.
 */
export async function getHlAccountState(walletAddress: string): Promise<HlAccountState> {
  validateRequired(walletAddress, 'walletAddress');
  const trader = await getHlTrader();
  const state = await trader.getAccountState(walletAddress);

  if (!state) {
    return {
      accountValue: '0',
      totalNtlPos: '0',
      totalRawUsd: '0',
      totalMarginUsed: '0',
      withdrawable: '0',
      positions: [],
    };
  }

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

  // Withdrawable is approximately accountValue - totalMarginUsed
  const accountVal = parseFloat(state.marginSummary.accountValue || '0');
  const marginUsed = parseFloat(state.marginSummary.totalMarginUsed || '0');
  const withdrawable = Math.max(0, accountVal - marginUsed).toString();

  return {
    accountValue: state.marginSummary.accountValue,
    totalNtlPos: state.marginSummary.totalNtlPos,
    totalRawUsd: state.marginSummary.totalRawUsd,
    totalMarginUsed: state.marginSummary.totalMarginUsed,
    withdrawable,
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
 * Get the mark price for an asset from HyperLiquid mid prices.
 */
export async function getHlMarkPrice(coin: string): Promise<number> {
  validateCoin(coin);
  const trader = await getHlTrader();
  const price = await trader.getMidPrice(coin.toUpperCase());
  return price ?? 0;
}

/**
 * Get the USDC balance available on HyperLiquid for a wallet.
 */
export async function getHlUsdcBalance(walletAddress: string): Promise<number> {
  const trader = await getHlTrader();
  const balance = await trader.getBalance(walletAddress);
  return balance ?? 0;
}

/**
 * Get open orders on HyperLiquid.
 */
export async function getHlOpenOrders(walletAddress: string) {
  validateRequired(walletAddress, 'walletAddress');
  const trader = await getHlTrader();
  return trader.getOpenOrders(walletAddress) ?? [];
}

/**
 * Get all mid prices for all assets on HyperLiquid.
 */
export async function getHlAllMids(): Promise<Record<string, string> | undefined> {
  const trader = await getHlTrader();
  return trader.getAllMids();
}

/**
 * Get trade history for a wallet on HyperLiquid.
 */
export async function getHlTradeHistory(walletAddress: string) {
  validateRequired(walletAddress, 'walletAddress');
  const trader = await getHlTrader();
  return trader.getTradeHistory(walletAddress);
}

/**
 * Get the leverage context for a trader on a specific coin.
 * Useful for copy trading to match the trader's leverage settings.
 */
export async function getHlTraderLeverageContext(traderWallet: string, coin: string): Promise<number | undefined> {
  validateRequired(traderWallet, 'traderWallet');
  validateCoin(coin);
  const trader = await getHlTrader();
  return trader.getTraderLeverageContext(traderWallet, coin.toUpperCase());
}

/**
 * Get spot clearinghouse state for a wallet on HyperLiquid.
 */
export async function getHlSpotState(walletAddress: string) {
  validateRequired(walletAddress, 'walletAddress');
  const trader = await getHlTrader();
  return trader.getSpotState(walletAddress);
}

// ── Direct execution (private key trading via @gdexsdk/hyper-liquid-trader) ──

/**
 * Execute a cross-margin perpetual trade directly on HyperLiquid.
 * This bypasses the GDEX managed custody flow and requires a private key.
 *
 * @param privateKey - Wallet private key (hex string)
 * @param params - Trade parameters (coin, isLong, price, positionSize, etc.)
 * @param isMarket - Whether this is a market order (default: true)
 */
export async function hlExecuteCrossPerp(
  privateKey: string,
  params: {
    coin: string;
    isLong: boolean;
    price: string;
    positionSize: string;
    reduceOnly?: boolean;
    leverage?: number;
    takeProfit?: { price: string; triggerPrice: string };
    stopLoss?: { price: string; triggerPrice: string };
    builderFee?: { address: string; feeRate: number };
  },
  isMarket = true,
): Promise<unknown> {
  validateCoin(params.coin);
  validateRequired(params.price, 'price');
  validateRequired(params.positionSize, 'positionSize');
  validateRequired(privateKey, 'privateKey');

  const trader = await getHlTrader();
  return trader.executeCrossPerp(privateKey, {
    ...params,
    coin: params.coin.toUpperCase(),
  }, isMarket);
}

/**
 * Execute an isolated-margin perpetual trade directly on HyperLiquid.
 * Automatically sets leverage and forces isolated margin mode.
 *
 * @param privateKey - Wallet private key (hex string)
 * @param params - Trade parameters including required leverage
 * @param isMarket - Whether this is a market order (default: true)
 */
export async function hlExecuteIsolatedPerp(
  privateKey: string,
  params: {
    coin: string;
    isLong: boolean;
    price: string;
    positionSize: string;
    leverage: number;
    reduceOnly?: boolean;
    takeProfit?: { price: string; triggerPrice: string };
    stopLoss?: { price: string; triggerPrice: string };
    builderFee?: { address: string; feeRate: number };
  },
  isMarket = true,
): Promise<unknown> {
  validateCoin(params.coin);
  validateRequired(params.price, 'price');
  validateRequired(params.positionSize, 'positionSize');
  validateRequired(privateKey, 'privateKey');

  const trader = await getHlTrader();
  return trader.executeIsolatedPerp(privateKey, {
    ...params,
    coin: params.coin.toUpperCase(),
  }, isMarket);
}

/**
 * Execute a spot trade directly on HyperLiquid.
 *
 * @param privateKey - Wallet private key (hex string)
 * @param params - Spot trade parameters
 * @param isMarket - Whether this is a market order (default: true)
 */
export async function hlExecuteSpot(
  privateKey: string,
  params: {
    coin: string;
    isBuy: boolean;
    price: string;
    size: string;
    builderFee?: { address: string; feeRate: number };
  },
  isMarket = true,
): Promise<unknown> {
  validateCoin(params.coin);
  validateRequired(params.price, 'price');
  validateRequired(params.size, 'size');
  validateRequired(privateKey, 'privateKey');

  const trader = await getHlTrader();
  return trader.executeSpot(privateKey, {
    ...params,
    coin: params.coin.toUpperCase(),
  }, isMarket);
}

/**
 * Cancel an open order directly on HyperLiquid by order ID.
 *
 * @param privateKey - Wallet private key (hex string)
 * @param coin - Asset coin symbol
 * @param oid - Order ID to cancel
 */
export async function hlDirectCancelOrder(
  privateKey: string,
  coin: string,
  oid: number,
): Promise<unknown> {
  validateCoin(coin);
  validateRequired(privateKey, 'privateKey');

  const trader = await getHlTrader();
  return trader.cancelOrder(privateKey, coin.toUpperCase(), oid);
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
