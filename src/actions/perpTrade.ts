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
  ClosePerpPositionParams,
  ClosePerpPositionResult,
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
  PerpClosePlan,
  PerpDepositParams,
  PerpPosition,
  PerpWithdrawParams,
} from '../types/perp';
import { validateAmount, validateCoin, validateRequired } from '../utils/validation';
import { GdexValidationError } from '../utils/errors';
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
  const price = await trader.getMidPrice(normalizeCoin(coin));
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
  return trader.getTraderLeverageContext(traderWallet, normalizeCoin(coin));
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
  validateRequired(params.price, 'price');
  validateRequired(params.positionSize, 'positionSize');
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
  validateRequired(params.price, 'price');
  validateRequired(params.size, 'size');
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
/**
 * Resolve the price to send for an order. Market orders must carry the current
 * mark price (not '0'): the backend multiplies the supplied price by a slippage
 * factor and enforces a min-notional check (price * size >= $11), so price '0'
 * fails with "Min order size value is 11$". For market orders with a missing or
 * '0' price, fetch the current mark price.
 */
async function resolveMarketPrice(coin: string, price: string, isMarket: boolean): Promise<string> {
  if (!isMarket) return price;
  if (price && price !== '0' && Number(price) > 0) return price;
  const mark = await getHlMarkPrice(coin);
  return String(mark);
}

export async function hlCreateOrder(client: GdexApiClient, params: HlCreateOrderParams): Promise<HlOrderResult> {
  validateCoin(params.coin);
  validateRequired(params.price, 'price');
  validateRequired(params.size, 'size');
  validateRequired(params.walletAddress, 'walletAddress');

  const isMarket = params.isMarket ?? true;
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
      tpPrice: params.tpPrice ?? '',
      slPrice: params.slPrice ?? '',
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
 * Place a simple order (no TP/SL) on HyperLiquid.
 */
export async function hlPlaceOrder(client: GdexApiClient, params: HlPlaceOrderParams): Promise<HlOrderResult> {
  // hl_place_order's ABI has no isMarket field, so a market flag would be
  // silently dropped and the order sent as a limit at `price`. Refuse it.
  if ((params as { isMarket?: unknown }).isMarket === true) {
    throw new GdexValidationError(
      'hlPlaceOrder cannot place market orders (hl_place_order has no isMarket field); use hlCreateOrder with isMarket: true',
      'isMarket',
    );
  }
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
      coin: normalizeCoin(params.coin),
      isLong: params.isLong,
      price: params.price,
      size: params.size,
      reduceOnly: params.reduceOnly ?? false,
    },
  });

  return client.post<HlOrderResult>(Endpoints.HL_PLACE_ORDER, { computedData });
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
 * Close (fully or partially) one perp position with a reduce-only market order.
 *
 * Direction and size come from the live position (see `resolvePerpClose`) —
 * a long is closed with a sell, a short with a buy. Omit `size` for a full
 * close. HL's $11 minimum order value still applies.
 */
export async function closePerpPosition(
  client: GdexApiClient,
  params: ClosePerpPositionParams,
): Promise<ClosePerpPositionResult> {
  const plan = await resolvePerpClose(client, params);
  const order = await hlCreateOrder(client, {
    apiKey: params.apiKey,
    walletAddress: params.walletAddress,
    sessionPrivateKey: params.sessionPrivateKey,
    coin: plan.coin,
    isLong: plan.isLong,
    price: params.price || '0',
    size: plan.size,
    reduceOnly: true,
    isMarket: true,
    tpPrice: '',
    slPrice: '',
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
      coin: normalizeCoin(params.coin),
      leverage: params.leverage,
      isCross: params.isCross ?? true,
    },
  });

  return client.post<HlResponse>(Endpoints.HL_UPDATE_LEVERAGE, { computedData });
}
