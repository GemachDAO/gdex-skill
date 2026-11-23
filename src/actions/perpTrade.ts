/**
 * Perpetual futures trading actions on HyperLiquid via GDEX managed custody.
 *
 * Write operations: ABI-encode → sign with session key → encrypt → POST computedData.
 * Read operations: plain HTTP requests to the public HyperLiquid info API.
 *
 * Direct execution (private key trading): Uses the HyperLiquidTrading class
 * (@gdexsdk/hyper-liquid-trader) for cross perp, isolated perp, and spot
 * execution without managed custody. Only that path loads the trader package.
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import {
  ClosePerpPositionParams,
  ClosePerpPositionResult,
  GetPositionsParams,
  HlAccountState,
  HlCancelAllOrdersParams,
  HlAddPositionTpslParams,
  HlAddPositionTpslResult,
  HlCancelOrderParams,
  HlCloseAllParams,
  HlClosePositionParams,
  HlCreateOrderParams,
  HlModifyOrderParams,
  HlModifyOrderResult,
  HlPlaceOrderParams,
  HlResponse,
  HlOrderResult,
  HlUpdateLeverageParams,
  PerpClosePlan,
  PerpDepositParams,
  PerpPosition,
  PerpWithdrawParams,
} from '../types/perp';
import {
  validateAmount,
  validateCoin,
  validateRequired,
  parseAmountUnits,
  validateHlPrice,
  validateHlSize,
  validateLeverage,
} from '../utils/validation';
import { GdexError, GdexValidationError } from '../utils/errors';
import { hlInfoRequest } from '../utils/hlInfo';
import { buildHlComputedData } from '../utils/gdexManagedCrypto';
import { getHlClearinghouseState, getHlClearinghouseStateAll } from './hlCopyTrade';

/**
 * Normalize a coin symbol for HyperLiquid.
 *
 * Builder-DEX (HIP-3) assets are named `dex:ASSET` where the DEX prefix is
 * LOWERCASE (e.g. `xyz:NVDA`, `flx:OIL`). Uppercasing the whole symbol
 * (`XYZ:NVDA`) makes HL reject the order — the asset isn't found. So for
 * `dex:ASSET` symbols we lowercase the DEX and uppercase only the asset; plain
 * coins are uppercased as before.
 */
export function normalizeCoin(coin: string): string {
  const i = coin.indexOf(':');
  if (i === -1) return coin.toUpperCase();
  return coin.slice(0, i).toLowerCase() + ':' + coin.slice(i + 1).toUpperCase();
}

// Lazy-load @gdexsdk/hyper-liquid-trader — used for DIRECT execution only.
// The package is CommonJS and require()s an ESM-only dependency
// (@nktkas/hyperliquid → @noble/hashes v2), so it loads only on a Node that
// supports require(esm) (22.12+). Reads and managed-custody writes never touch it.
// In production: dynamic import() so nothing is loaded until direct execution is used.
// In Jest: require() so moduleNameMapper can intercept it.
let _hlTraderModule: { HyperLiquidTrading: any } | null = null;
async function getHlTraderModule(): Promise<{ HyperLiquidTrading: any }> {
  if (!_hlTraderModule) {
    try {
      if (process.env.JEST_WORKER_ID) {
        _hlTraderModule = require('@gdexsdk/hyper-liquid-trader');
      } else {
        const dynamicImport = new Function('modulePath', 'return import(modulePath)');
        _hlTraderModule = await dynamicImport('@gdexsdk/hyper-liquid-trader');
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message.split('\n')[0] : String(err);
      throw new GdexError(
        'Direct HyperLiquid execution could not load @gdexsdk/hyper-liquid-trader ' +
          `on Node ${process.version}. It needs Node 22.12 or newer (require of ES modules). ` +
          'Reads and managed-custody orders (hlCreateOrder, closePerpPosition, ...) do not need it. ' +
          `Cause: ${reason}`,
      );
    }
  }
  return _hlTraderModule!;
}

// Singleton HyperLiquidTrading instance for direct execution
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

// ── Read operations (public HyperLiquid info API over HTTP) ──────────────────

/** Builder-DEX prefix of a coin symbol, lowercased (`xyz:NVDA` → `xyz`; `BTC` → ``). */
function dexOf(coin: string): string {
  const i = coin.indexOf(':');
  return i === -1 ? '' : coin.slice(0, i).toLowerCase();
}

interface HlClearinghouseState {
  marginSummary: { accountValue: string; totalNtlPos: string; totalRawUsd: string; totalMarginUsed: string };
  assetPositions: Array<{ position: any }>;
}

/**
 * Get the full HyperLiquid clearinghouse state for a wallet (default dex).
 * Includes margin summary, positions, and withdrawable balance.
 *
 * @throws {GdexNetworkError} when HyperLiquid cannot be reached (a failed read is never reported as an empty account)
 */
export async function getHlAccountState(walletAddress: string): Promise<HlAccountState> {
  validateRequired(walletAddress, 'walletAddress');
  const state = await hlInfoRequest<HlClearinghouseState | null>({ type: 'clearinghouseState', user: walletAddress });

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
      marginMode: p.leverage.type === 'isolated' ? 'isolated' as const : 'cross' as const,
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
 * Get the MARK price for a perp market — HyperLiquid `markPx` from
 * `metaAndAssetCtxs`, the price gdex.pro shows and the back-end checks limit
 * orders against. It is not the order-book mid (see `getHlAllMids`).
 *
 * Builder-DEX markets (`dex:ASSET`, e.g. `xyz:NVDA`) are read from their own dex.
 *
 * @returns the mark price, or 0 when the market is not listed or has no mark
 * @throws {GdexNetworkError} when HyperLiquid cannot be reached
 */
export async function getHlMarkPrice(coin: string): Promise<number> {
  validateCoin(coin);
  const name = normalizeCoin(coin.trim());
  const dex = dexOf(name);
  const res = await hlInfoRequest<unknown>({ type: 'metaAndAssetCtxs', ...(dex ? { dex } : {}) });
  const [meta, ctxs] = (Array.isArray(res) ? res : []) as [
    { universe?: Array<{ name?: string }> } | undefined,
    Array<{ markPx?: string }> | undefined,
  ];
  const universe = Array.isArray(meta?.universe) ? meta!.universe! : [];
  // Builder-DEX universes name assets `dex:ASSET`; accept a bare asset name too.
  const index = universe.findIndex((asset) => {
    const assetName = String(asset?.name ?? '');
    return normalizeCoin(dex && !assetName.includes(':') ? `${dex}:${assetName}` : assetName) === name;
  });
  if (index === -1) return 0;
  const mark = Number(ctxs?.[index]?.markPx);
  return Number.isFinite(mark) && mark > 0 ? mark : 0;
}

/**
 * Get the USDC balance on HyperLiquid for a wallet: perp account value plus
 * spot USDC.
 */
export async function getHlUsdcBalance(walletAddress: string): Promise<number> {
  validateRequired(walletAddress, 'walletAddress');
  const [perp, spot] = await Promise.all([
    hlInfoRequest<HlClearinghouseState | null>({ type: 'clearinghouseState', user: walletAddress }),
    hlInfoRequest<{ balances?: Array<{ coin: string; total: string }> } | null>({
      type: 'spotClearinghouseState',
      user: walletAddress,
    }),
  ]);
  let total = 0;
  if (perp?.marginSummary?.accountValue) total += parseFloat(perp.marginSummary.accountValue);
  const usdc = spot?.balances?.find((b) => b.coin === 'USDC');
  if (usdc?.total) total += parseFloat(usdc.total);
  return total;
}

/**
 * Get open orders on HyperLiquid (default dex, HL `openOrders`). For builder
 * DEXes and TP/SL trigger details use `getHlOpenOrdersForCopy` /
 * `getHlOpenOrdersAllForCopy`.
 */
export async function getHlOpenOrders(walletAddress: string) {
  validateRequired(walletAddress, 'walletAddress');
  return (await hlInfoRequest<any[] | null>({ type: 'openOrders', user: walletAddress })) ?? [];
}

/**
 * Get all mid prices for all assets on HyperLiquid (default dex).
 */
export async function getHlAllMids(): Promise<Record<string, string> | undefined> {
  return (await hlInfoRequest<Record<string, string> | null>({ type: 'allMids' })) ?? undefined;
}

/**
 * Get trade history (fills) for a wallet on HyperLiquid.
 */
export async function getHlTradeHistory(walletAddress: string) {
  validateRequired(walletAddress, 'walletAddress');
  return hlInfoRequest<any[]>({ type: 'userFills', user: walletAddress });
}

/**
 * Get the leverage a trader currently uses on a specific coin (from their open
 * position; undefined when they hold none).
 * Useful for copy trading to match the trader's leverage settings.
 */
export async function getHlTraderLeverageContext(traderWallet: string, coin: string): Promise<number | undefined> {
  validateRequired(traderWallet, 'traderWallet');
  validateCoin(coin);
  const name = normalizeCoin(coin);
  const dex = dexOf(name);
  const state = await hlInfoRequest<HlClearinghouseState | null>({
    type: 'clearinghouseState',
    user: traderWallet,
    ...(dex ? { dex } : {}),
  });
  const position = state?.assetPositions?.find((p) => p.position.coin === name);
  return position?.position.leverage ? position.position.leverage.value : undefined;
}

/**
 * Get spot clearinghouse state for a wallet on HyperLiquid.
 */
export async function getHlSpotState(walletAddress: string) {
  validateRequired(walletAddress, 'walletAddress');
  return hlInfoRequest<any>({ type: 'spotClearinghouseState', user: walletAddress });
}

// ── Direct execution (private key trading via @gdexsdk/hyper-liquid-trader) ──

/** TP/SL leg of a direct order: both prices must be positive decimals. */
function checkTriggerLeg(leg: { price: string; triggerPrice: string } | undefined, field: string): void {
  if (leg === undefined) return;
  validateHlPrice(leg.price, `${field}.price`);
  validateHlPrice(leg.triggerPrice, `${field}.triggerPrice`);
}

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
  validateHlPrice(params.price, 'price');
  validateHlSize(params.positionSize, 'positionSize');
  checkTriggerLeg(params.takeProfit, 'takeProfit');
  checkTriggerLeg(params.stopLoss, 'stopLoss');
  validateRequired(privateKey, 'privateKey');

  const trader = await getHlTrader();
  return trader.executeCrossPerp(privateKey, {
    ...params,
    coin: normalizeCoin(params.coin),
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
  validateHlPrice(params.price, 'price');
  validateHlSize(params.positionSize, 'positionSize');
  checkTriggerLeg(params.takeProfit, 'takeProfit');
  checkTriggerLeg(params.stopLoss, 'stopLoss');
  validateRequired(privateKey, 'privateKey');

  const trader = await getHlTrader();
  return trader.executeIsolatedPerp(privateKey, {
    ...params,
    coin: normalizeCoin(params.coin),
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
  validateHlPrice(params.price, 'price');
  validateHlSize(params.size, 'size');
  validateRequired(privateKey, 'privateKey');

  const trader = await getHlTrader();
  return trader.executeSpot(privateKey, {
    ...params,
    coin: normalizeCoin(params.coin),
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
  return trader.cancelOrder(privateKey, normalizeCoin(coin), oid);
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

  // Convert human-readable USDC to smallest unit (6 decimals), exactly; excess precision throws
  const amountSmallestUnit = parseAmountUnits(params.amount, 6, 'amount').toString();

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
  // Sent as a human USD string; the backend applies toFixed(1), so reject finer precision instead of rounding
  parseAmountUnits(params.amount, 1, 'amount');
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

/** True for a market order's "use the mark price" placeholder ('0', '0.0', ...). */
function isZeroPrice(price: string): boolean {
  return /^0+(\.0+)?$/.test(price);
}

/**
 * Resolve the price to send for an order. Market orders must carry the current
 * mark price (not '0'): the backend multiplies the supplied price by a slippage
 * factor and enforces a min-notional check (price * size >= $11), so price '0'
 * fails with "Min order size value is 11$". For a market order with price '0',
 * fetch the current mark price.
 */
async function resolveMarketPrice(coin: string, price: string, isMarket: boolean): Promise<string> {
  if (!isMarket || !isZeroPrice(price)) return price;
  const mark = await getHlMarkPrice(coin);
  if (!Number.isFinite(mark) || mark <= 0) {
    throw new GdexValidationError(`No mark price for ${coin}; pass an explicit price`, 'price');
  }
  return String(mark);
}

/**
 * Check order numbers before anything is fetched or signed.
 *
 * Always: price (unless a market order's '0' placeholder), size and any TP/SL
 * are positive plain decimals — no sign, exponent or trailing characters.
 * With `szDecimals` (HL meta for the market) Hyperliquid's precision rules
 * apply too, since the backend rounds instead of rejecting
 * (hyperLiquid.ts:109-131 toFormattedPrice/toFormattedSize): size up to
 * szDecimals decimals; limit and TP/SL prices up to 5 significant figures and
 * 6 - szDecimals decimals (integers always allowed). A market order's price is
 * only a slippage reference, so its precision is not checked.
 */
function checkOrderNumbers(p: {
  price: string;
  size: string;
  isMarket: boolean;
  szDecimals?: number;
  tpPrice?: string;
  slPrice?: string;
}): { tpPrice: string; slPrice: string } {
  validateRequired(p.price, 'price');
  if (!(p.isMarket && isZeroPrice(p.price))) {
    validateHlPrice(p.price, 'price', p.isMarket ? undefined : p.szDecimals);
  }
  validateHlSize(p.size, 'size', p.szDecimals);
  // '' (or omitted) means no TP/SL; anything else must be a valid price.
  const tpPrice = p.tpPrice ?? '';
  const slPrice = p.slPrice ?? '';
  if (tpPrice !== '') validateHlPrice(tpPrice, 'tpPrice', p.szDecimals);
  if (slPrice !== '') validateHlPrice(slPrice, 'slPrice', p.szDecimals);
  // The backend attaches TP/SL only when both are set and silently drops a lone
  // one (hyperLiquidWorker.ts:425-431), so refuse half a pair.
  if ((tpPrice === '') !== (slPrice === '')) {
    throw new GdexValidationError(
      'tpPrice and slPrice must be set together: GDEX ignores a take-profit without a stop-loss (and vice versa)',
      tpPrice === '' ? 'tpPrice' : 'slPrice',
    );
  }
  return { tpPrice, slPrice };
}

/**
 * Place a market or limit order with optional TP/SL on HyperLiquid
 * (`POST /v1/hl/create_order`). This is how positions are opened, and how a
 * resting reduce-only limit ("limit close") is placed.
 *
 * - **Market** (`isMarket: true`, default): `price` is the mark-price reference
 *   ('0' fetches the mark); the back-end applies its own 5% slippage bound.
 * - **Limit** (`isMarket: false`): rests at `price`. A non-reduce-only limit at
 *   or through the mark (>= mark for a long, <= mark for a short) is refused by
 *   the back-end — use a market order instead.
 * - **Limit close**: `reduceOnly: true, isMarket: false` rests as a normal GTC
 *   reduce-only order. Pass the position's current `leverage` with it (below).
 * - **Leverage** travels as a top-level `leverage` field and is the only way to
 *   set it. The back-end updates the account's leverage for the market before
 *   placing the order and clamps a value above the market's maximum. When it
 *   is OMITTED the back-end applies the market's MAXIMUM leverage, on
 *   reduce-only orders too, so always pass it.
 * - **Margin mode** is chosen by the back-end: builder-DEX (`dex:ASSET`) and
 *   isolated-only markets are isolated, everything else is cross.
 * - **TP/SL** attach only as a pair and become market triggers. Edit them
 *   later with `hlModifyOrder`, add a missing one with `hlAddPositionTpsl`.
 * - Minimum order value is $11 unless reduce-only.
 *
 * The response is `{ isSuccess: true }` with no order id; read open orders to
 * get one.
 *
 * @throws {GdexValidationError} on a malformed or over-precise price, size or
 *   TP/SL (before any mark-price fetch or signing)
 */
export async function hlCreateOrder(client: GdexApiClient, params: HlCreateOrderParams): Promise<HlOrderResult> {
  validateCoin(params.coin);
  validateRequired(params.walletAddress, 'walletAddress');
  const isMarket = params.isMarket ?? true;
  const { tpPrice, slPrice } = checkOrderNumbers({ ...params, isMarket });
  if (params.leverage != null) validateLeverage(params.leverage);

  const price = await resolveMarketPrice(params.coin, params.price, isMarket);

  const computedData = buildHlComputedData({
    action: 'hl_create_order',
    apiKey: params.apiKey,
    walletAddress: params.walletAddress,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: {
      coin: normalizeCoin(params.coin),
      isLong: params.isLong,
      price,
      size: params.size,
      reduceOnly: params.reduceOnly ?? false,
      tpPrice,
      slPrice,
      isMarket,
    },
  });

  // Leverage is a TOP-LEVEL field in the request body (sibling of computedData),
  // NOT inside the encrypted actionParams — this is how the backend reads it.
  return client.post<HlOrderResult>(Endpoints.HL_CREATE_ORDER, {
    computedData,
    ...(params.leverage != null ? { leverage: params.leverage } : {}),
  });
}

/**
 * Close (part of) an open position at market — the gdex.pro "Close" button
 * (`POST /v1/hl/place_order`, action `hl_place_order`).
 *
 * The back-end reads the live position itself: it closes up to `size` of
 * `coin` with a reduce-only IOC order at its own mark price ±5%, on the side
 * opposite to the position, and keeps the position's leverage and margin mode
 * unchanged. The `price` and `isLong` fields of the signed payload are
 * IGNORED; they are sent as gdex.pro sends them (price = current mark).
 *
 * - `size` larger than the position closes the whole position.
 * - A partial close must leave at least $11 of position, or the back-end
 *   refuses it ("Close the full position instead").
 * - With no open position the back-end still answers `{ isSuccess: true }`.
 *
 * Use `closePerpPosition` to have the size and side resolved (and a missing
 * position rejected) from the live position first.
 *
 * @throws {GdexValidationError} on a malformed size or price (nothing is signed)
 */
export async function hlClosePosition(client: GdexApiClient, params: HlClosePositionParams): Promise<HlResponse> {
  validateCoin(params.coin);
  validateRequired(params.walletAddress, 'walletAddress');
  validateHlSize(params.size, 'size', params.szDecimals);
  const explicitPrice = params.price !== undefined && params.price !== '' && !isZeroPrice(params.price);
  if (explicitPrice) validateHlPrice(params.price!, 'price');
  const coin = normalizeCoin(params.coin.trim());

  let price = explicitPrice ? params.price! : '0';
  if (!explicitPrice) {
    // The back-end never reads this field (it resolves its own mark and fails
    // closed without one), so an unavailable mark must not block a close:
    // send the '0' placeholder instead of the reference price.
    const mark = await getHlMarkPrice(coin).catch(() => 0);
    if (Number.isFinite(mark) && mark > 0) price = String(mark);
  }

  const computedData = buildHlComputedData({
    action: 'hl_place_order',
    apiKey: params.apiKey,
    walletAddress: params.walletAddress,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: {
      coin,
      isLong: params.isLong ?? false,
      price,
      size: params.size,
      reduceOnly: true,
    },
  });

  return client.post<HlResponse>(Endpoints.HL_PLACE_ORDER, { computedData });
}

/**
 * @deprecated Use `hlClosePosition` (close at market) or `hlCreateOrder`
 * (market and limit orders, including a reduce-only limit close).
 *
 * `/v1/hl/place_order` is NOT a general limit-order call: the back-end refuses
 * anything that is not reduce-only ("Now only support close position"),
 * ignores the `price` and `isLong` sent, and closes `size` of the live
 * position at market. This alias therefore requires `reduceOnly: true` and
 * rejects everything else before signing.
 *
 * @throws {GdexValidationError} when `reduceOnly` is not `true`, or on a malformed price or size (nothing is signed)
 */
export async function hlPlaceOrder(client: GdexApiClient, params: HlPlaceOrderParams): Promise<HlOrderResult> {
  if (params.reduceOnly !== true) {
    throw new GdexValidationError(
      'hlPlaceOrder only closes positions: /v1/hl/place_order rejects non-reduce-only orders, ignores price and ' +
        'isLong, and closes `size` of the open position at MARKET. To open a position or rest a limit order use ' +
        'hlCreateOrder (isMarket: false for a limit; add reduceOnly: true for a limit close). To close at market ' +
        'use hlClosePosition or closePerpPosition.',
      'reduceOnly',
    );
  }
  validateCoin(params.coin);
  validateRequired(params.walletAddress, 'walletAddress');
  checkOrderNumbers({ price: params.price, size: params.size, isMarket: false, szDecimals: params.szDecimals });

  return hlClosePosition(client, {
    apiKey: params.apiKey,
    walletAddress: params.walletAddress,
    sessionPrivateKey: params.sessionPrivateKey,
    coin: params.coin,
    isLong: params.isLong,
    price: params.price,
    size: params.size,
    szDecimals: params.szDecimals,
  });
}

// ── Close one position (side + size resolved from live HL state) ────────────

/** An exact decimal: value = units / 10^scale. No float math on sizes. */
interface ExactDecimal {
  units: bigint;
  scale: number;
}

function parseExactDecimal(value: string, field: string, allowNegative = false): ExactDecimal {
  const s = String(value).trim();
  const re = allowNegative ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/;
  if (!re.test(s)) {
    throw new GdexValidationError(`${field} must be a decimal string, got "${value}"`, field);
  }
  const negative = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const units = BigInt(whole + frac);
  return { units: negative ? -units : units, scale: frac.length };
}

function rescale(d: ExactDecimal, scale: number): bigint {
  return d.units * 10n ** BigInt(scale - d.scale);
}

function formatExactDecimal(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  let out = scale > 0 ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
  if (out.includes('.')) out = out.replace(/0+$/, '').replace(/\.$/, '');
  return negative ? `-${out}` : out;
}

/** Unwrap `/hl/clearinghouse_state` (`{ isSuccess, state }`) to its assetPositions. */
function extractAssetPositions(res: unknown, source: string): Array<{ coin: string; szi: string }> {
  const body = (res ?? {}) as Record<string, any>;
  if (body.isSuccess === false) {
    throw new Error(`${source} failed: ${body.error ?? 'unknown error'}`);
  }
  const state = body.state !== undefined ? body.state : body;
  const list = state?.assetPositions;
  if (!Array.isArray(list)) return [];
  return list
    .map((ap: any) => ap?.position)
    .filter((p: any) => p && typeof p.coin === 'string' && p.szi !== undefined)
    .map((p: any) => ({ coin: p.coin, szi: String(p.szi) }));
}

/** Asset part of a coin symbol, uppercased (`xyz:tsla` → `TSLA`). */
function assetOf(coin: string): string {
  const i = coin.indexOf(':');
  return (i === -1 ? coin : coin.slice(i + 1)).toUpperCase();
}

/**
 * Resolve the reduce-only order that closes (part of) an open perp position,
 * without submitting it.
 *
 * Reads the position from HyperLiquid clearinghouse state via the backend
 * (`getHlClearinghouseState`, dex-scoped for builder DEXes). The position's
 * signed `szi` decides direction: positive = long → close with a sell,
 * negative = short → close with a buy. A bare coin missing from the default
 * dex is looked up across builder DEXes (`getHlClearinghouseStateAll`);
 * more than one match is rejected as ambiguous.
 *
 * @throws {GdexValidationError} when flat, ambiguous, or `size` exceeds the position
 */
export async function resolvePerpClose(
  client: GdexApiClient,
  params: ClosePerpPositionParams,
): Promise<PerpClosePlan> {
  validateCoin(params.coin);
  validateRequired(params.walletAddress, 'walletAddress');
  const address = params.positionAddress || params.walletAddress;

  let coin = normalizeCoin(params.coin.trim());
  const prefix = coin.includes(':') ? coin.slice(0, coin.indexOf(':')) : '';
  const dexParam = (params.dex ?? '').trim().toLowerCase();
  if (dexParam && prefix && dexParam !== prefix) {
    throw new GdexValidationError(`dex "${params.dex}" does not match coin prefix "${prefix}"`, 'dex');
  }
  let dex = prefix || dexParam;
  if (dex && !prefix) coin = `${dex}:${coin}`;

  let matches: Array<{ coin: string; szi: string; dex: string }>;
  if (dex) {
    const res = await getHlClearinghouseState(client, { userAddress: address, dex });
    // HL names builder positions `dex:ASSET`; accept a bare asset name too.
    matches = extractAssetPositions(res, 'clearinghouse_state')
      .filter((p) => normalizeCoin(p.coin.includes(':') ? p.coin : `${dex}:${p.coin}`) === coin)
      .map((p) => ({ ...p, dex }));
  } else {
    const res = await getHlClearinghouseState(client, { userAddress: address });
    matches = extractAssetPositions(res, 'clearinghouse_state')
      .filter((p) => normalizeCoin(p.coin) === coin)
      .map((p) => ({ ...p, dex: '' }));
    if (!matches.some((p) => parseExactDecimal(p.szi, 'szi', true).units !== 0n)) {
      // Not on the default dex — the bare symbol may be a builder-dex asset.
      const all = (await getHlClearinghouseStateAll(client, address)) as Record<string, any>;
      if (all?.isSuccess === false) {
        throw new Error(`clearinghouse_state_all failed: ${all.error ?? 'unknown error'}`);
      }
      const rows: any[] = Array.isArray(all?.allPositions) ? all.allPositions : [];
      matches = rows
        .filter((r) => r?.dex && r?.position && typeof r.position.coin === 'string')
        .filter((r) => assetOf(r.position.coin) === coin)
        .map((r) => ({
          coin: normalizeCoin(r.position.coin.includes(':') ? r.position.coin : `${r.dex}:${r.position.coin}`),
          szi: String(r.position.szi),
          dex: String(r.dex).toLowerCase(),
        }));
    }
  }

  const open = matches.filter((p) => parseExactDecimal(p.szi, 'szi', true).units !== 0n);
  if (open.length === 0) {
    throw new GdexValidationError(
      `No open ${coin} position found for ${address}` +
        (dex ? ` on dex "${dex}"` : '') +
        '. HL positions live on the MANAGED wallet — pass positionAddress if walletAddress is the control wallet.',
      'coin',
    );
  }
  if (open.length > 1) {
    const where = open.map((p) => p.coin).join(', ');
    throw new GdexValidationError(
      `Ambiguous close: ${coin} has open positions on several DEXes (${where}). Pass the dex-prefixed coin or dex.`,
      'coin',
    );
  }

  const position = open[0];
  coin = normalizeCoin(position.coin.includes(':') ? position.coin : coin);
  dex = position.dex;
  const szi = parseExactDecimal(position.szi, 'szi', true);
  const isShort = szi.units < 0n;
  const absPosition: ExactDecimal = { units: isShort ? -szi.units : szi.units, scale: szi.scale };
  const positionSize = formatExactDecimal(absPosition.units, absPosition.scale);

  let size = positionSize;
  let remaining = '0';
  if (params.size !== undefined && params.size !== '') {
    const req = parseExactDecimal(params.size, 'size');
    if (req.units === 0n) {
      throw new GdexValidationError('size must be greater than 0', 'size');
    }
    size = formatExactDecimal(req.units, req.scale);
    // Count significant decimals only — "0.50" is fine at szDecimals 1.
    const decimals = size.includes('.') ? size.split('.')[1].length : 0;
    if (params.szDecimals !== undefined && decimals > params.szDecimals) {
      throw new GdexValidationError(
        `size ${params.size} has more than ${params.szDecimals} decimals allowed for ${coin}`,
        'size',
      );
    }
    const scale = Math.max(req.scale, absPosition.scale);
    const diff = rescale(absPosition, scale) - rescale(req, scale);
    if (diff < 0n) {
      throw new GdexValidationError(
        `size ${params.size} exceeds the open ${coin} position (${positionSize})`,
        'size',
      );
    }
    remaining = formatExactDecimal(diff, scale);
  }

  return {
    coin,
    dex,
    positionSide: isShort ? 'short' : 'long',
    closeSide: isShort ? 'buy' : 'sell',
    isLong: isShort,
    positionSize,
    size,
    remainingSize: remaining,
    isFullClose: remaining === '0',
  };
}

/**
 * Close (fully or partially) one perp position at market.
 *
 * Direction and size come from the live position (see `resolvePerpClose`) —
 * a long is closed with a sell, a short with a buy — and a flat or missing
 * position is rejected before anything is signed. The close itself is sent
 * the way gdex.pro's Close button sends it (`hlClosePosition`,
 * `/v1/hl/place_order`): the back-end closes at its own mark ±5% and leaves
 * the position's leverage and margin mode untouched. Omit `size` for a full
 * close; a partial close must leave at least $11 of position.
 */
export async function closePerpPosition(
  client: GdexApiClient,
  params: ClosePerpPositionParams,
): Promise<ClosePerpPositionResult> {
  // Check the caller's price before reading the position.
  if (params.price && !isZeroPrice(params.price)) validateHlPrice(params.price, 'price');
  const plan = await resolvePerpClose(client, params);
  const order = await hlClosePosition(client, {
    apiKey: params.apiKey,
    walletAddress: params.walletAddress,
    sessionPrivateKey: params.sessionPrivateKey,
    coin: plan.coin,
    isLong: plan.isLong,
    price: params.price,
    size: plan.size,
    szDecimals: params.szDecimals,
  });
  return { ...plan, order };
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
      coin: normalizeCoin(params.coin),
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

// ── Edit open orders / add TP/SL to an open position ────────────────────────

const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;

/** '' / undefined → '' (keep / none); anything else must be a plain positive decimal. */
function optionalDecimal(
  value: string | undefined,
  field: string,
  opts: { allowZero?: boolean; szDecimals?: number; kind: 'price' | 'size' },
): string {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || !PLAIN_DECIMAL.test(value) || !Number.isFinite(Number(value))) {
    throw new GdexValidationError(`${field} must be a plain decimal string, got "${String(value)}"`, field);
  }
  if (Number(value) === 0) {
    if (opts.allowZero) return value;
    throw new GdexValidationError(`${field} must be greater than 0`, field);
  }
  if (opts.kind === 'price') validateHlPrice(value, field, opts.szDecimals);
  else validateHlSize(value, field, opts.szDecimals);
  return value;
}

/**
 * Change an open order (`POST /v1/hl/modify_order`, action `hl_modify_order`):
 * move a TP/SL trigger, re-price a resting limit, or change the remaining size.
 *
 * Fields left out (or '') keep the order's current value; at least one of
 * `price`, `size`, `triggerPrice` is required.
 *
 * - **TP/SL trigger**: send `triggerPrice`. Leave `price` out and a market
 *   trigger keeps its execution-price buffer.
 * - **Resting limit**: send `price` (`triggerPrice` is refused on a non-trigger
 *   order). A non-reduce-only limit moved to or through the mark is refused.
 * - `size` is the remaining base quantity; `'0'` is accepted only for a
 *   position-level TP/SL (it means "the whole position").
 *
 * HyperLiquid replaces the order, so `retData.orderId` is the NEW id and
 * `retData.previousOrderId` the old one. A refusal arrives as a
 * `GdexApiError` (HTTP 400; `responseBody.code` 102 = no such open order).
 * To remove a TP/SL use `hlCancelOrder` with its order id.
 *
 * @throws {GdexValidationError} on a bad order id or numbers (nothing is signed)
 */
export async function hlModifyOrder(client: GdexApiClient, params: HlModifyOrderParams): Promise<HlModifyOrderResult> {
  validateCoin(params.coin);
  validateRequired(params.walletAddress, 'walletAddress');
  const orderId = String(params.orderId ?? '');
  if (!/^\d+$/.test(orderId) || !Number.isSafeInteger(Number(orderId)) || Number(orderId) <= 0) {
    throw new GdexValidationError(`orderId must be a positive integer, got "${orderId}"`, 'orderId');
  }
  const price = optionalDecimal(params.price, 'price', { kind: 'price', szDecimals: params.szDecimals });
  const size = optionalDecimal(params.size, 'size', { kind: 'size', szDecimals: params.szDecimals, allowZero: true });
  const triggerPrice = optionalDecimal(params.triggerPrice, 'triggerPrice', {
    kind: 'price',
    szDecimals: params.szDecimals,
  });
  if (!price && !size && !triggerPrice) {
    throw new GdexValidationError('At least one of price, size or triggerPrice is required', 'price');
  }

  const computedData = buildHlComputedData({
    action: 'hl_modify_order',
    apiKey: params.apiKey,
    walletAddress: params.walletAddress,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: { coin: normalizeCoin(params.coin.trim()), orderId, price, size, triggerPrice },
  });

  return client.post<HlModifyOrderResult>(Endpoints.HL_MODIFY_ORDER, { computedData });
}

/**
 * Add a missing take-profit and/or stop-loss to an OPEN position
 * (`POST /v1/hl/add_position_tpsl`, action `hl_add_position_tpsl`; HyperLiquid
 * grouping `positionTpsl`). One side or both in one call.
 *
 * - Omit `size` to cover the whole position (what gdex.pro sends).
 * - Triggers are market triggers by default (`tpIsMarket` / `slIsMarket`
 *   true); leave `tpPrice` / `slPrice` out and the back-end sets the execution
 *   price. An execution price needs its trigger price.
 * - The TP trigger must be on the profit side of the current mark and the SL
 *   trigger on the loss side, or the back-end refuses.
 * - It only ADDS: a side that already has a trigger is refused (HTTP 400,
 *   `responseBody.code` 409, "use modify_order") — move it with
 *   `hlModifyOrder`, remove it with `hlCancelOrder`. No open position is
 *   `responseBody.code` 102.
 *
 * `retData.createdOrders` lists what was placed. When one side is accepted and
 * the other rejected the back-end answers HTTP 400 with `partialSuccess: true`,
 * which surfaces as a `GdexApiError` whose `responseBody.retData` still lists
 * the created order — read open orders before retrying.
 *
 * @throws {GdexValidationError} on missing or malformed prices (nothing is signed)
 */
export async function hlAddPositionTpsl(
  client: GdexApiClient,
  params: HlAddPositionTpslParams,
): Promise<HlAddPositionTpslResult> {
  validateCoin(params.coin);
  validateRequired(params.walletAddress, 'walletAddress');
  const num = (value: string | undefined, field: string, kind: 'price' | 'size') =>
    optionalDecimal(value, field, { kind, szDecimals: params.szDecimals });
  const size = num(params.size, 'size', 'size');
  const tpTriggerPrice = num(params.tpTriggerPrice, 'tpTriggerPrice', 'price');
  const tpPrice = num(params.tpPrice, 'tpPrice', 'price');
  const slTriggerPrice = num(params.slTriggerPrice, 'slTriggerPrice', 'price');
  const slPrice = num(params.slPrice, 'slPrice', 'price');
  if (!tpTriggerPrice && !slTriggerPrice) {
    throw new GdexValidationError('At least one of tpTriggerPrice or slTriggerPrice is required', 'tpTriggerPrice');
  }
  if (tpPrice && !tpTriggerPrice) {
    throw new GdexValidationError('tpPrice (execution price) requires tpTriggerPrice', 'tpPrice');
  }
  if (slPrice && !slTriggerPrice) {
    throw new GdexValidationError('slPrice (execution price) requires slTriggerPrice', 'slPrice');
  }
  for (const field of ['tpIsMarket', 'slIsMarket'] as const) {
    if (params[field] !== undefined && typeof params[field] !== 'boolean') {
      throw new GdexValidationError(`${field} must be a boolean`, field);
    }
  }

  const computedData = buildHlComputedData({
    action: 'hl_add_position_tpsl',
    apiKey: params.apiKey,
    walletAddress: params.walletAddress,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: {
      coin: normalizeCoin(params.coin.trim()),
      size,
      tpTriggerPrice,
      tpPrice,
      tpIsMarket: params.tpIsMarket ?? true,
      slTriggerPrice,
      slPrice,
      slIsMarket: params.slIsMarket ?? true,
    },
  });

  return client.post<HlAddPositionTpslResult>(Endpoints.HL_ADD_POSITION_TPSL, { computedData });
}

/**
 * @deprecated There is no leverage route on the GDEX back-end
 * (`/v1/hl/update_leverage` does not exist), so this always throws without
 * signing or sending anything. Leverage is set per order with the `leverage`
 * field of `hlCreateOrder`.
 *
 * @throws {GdexValidationError} always
 */
export async function hlUpdateLeverage(_client: GdexApiClient, _params: HlUpdateLeverageParams): Promise<HlResponse> {
  throw new GdexValidationError(
    'hlUpdateLeverage is not available: the GDEX back-end has no /v1/hl/update_leverage route. ' +
      'Set leverage with the `leverage` field of hlCreateOrder — the back-end applies it to the market ' +
      "just before placing that order (clamped to the market's maximum).",
    'leverage',
  );
}
