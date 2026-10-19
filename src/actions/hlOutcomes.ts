/**
 * Hyperliquid HIP-4 outcome-market actions.
 *
 * These are Hyperliquid **HIP-4 outcome** markets: spot-settled contracts whose
 * side tokens trade at a probability price in (0,1) and are collateralised in the
 * market's quote token (USDC today) from the managed wallet's HL **spot** balance.
 * They are not HIP-3 builder perps, not perps, and not Polymarket/Kalshi — GDEX has
 * no Polymarket or Kalshi integration.
 *
 * Backed by (backend src/api/hyperLiquid.ts:42-46, ServiceHyperLiquid.ts:1842-1978):
 *   GET  /v1/hl/outcomes            → { meta: outcomeMeta, mids: allMids } (no query params are read)
 *   GET  /v1/hl/outcome_account     → ?address=<managed>&outcomeId=<id>
 *   POST /v1/hl/outcome/create_order  { computedData }
 *   POST /v1/hl/outcome/cancel_order  { computedData }
 *   POST /v1/hl/outcome/close_order   { computedData }
 *
 * The structured write helpers discover the market first and validate the order
 * against it ({@link validateOutcomeOrder}) before anything is signed.
 */
import axios from 'axios';
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import { validateRequired } from '../utils/validation';
import { GdexValidationError } from '../utils/errors';
import { buildHlComputedData } from '../utils/gdexManagedCrypto';
import {
  OutcomeAccountState,
  OutcomeMarket,
  OutcomeOrderResult,
  OutcomeTradingState,
  findOutcomeMarket,
  normalizeOutcomeAccount,
  normalizeOutcomeMarkets,
  normalizeOutcomeOrderResult,
  parseOutcomeId,
  resolveOutcomeSide,
  validateOutcomeClose,
  validateOutcomeOrder,
} from './hlOutcomeMarkets';
import { computeOutcomeVolume, fetchHlOutcomeVolumeReadings } from './hlOutcomeVolume';

const HL_INFO_URL = 'https://api.hyperliquid.xyz/info';

export interface OutcomesListParams {
  /** @deprecated Ignored: the backend does not read query params on /hl/outcomes. */
  dex?: string;
  /** @deprecated Ignored by the backend; filter with {@link getHlOutcomeMarkets} `state` instead. */
  status?: 'open' | 'resolved' | string;
}

export interface OutcomeAccountParams {
  /** MANAGED EVM wallet address (outcome balances live there, not on the control address). */
  userAddress: string;
  /** Outcome market id the account is queried against (backend requires it). */
  outcomeId: string | number;
}

/** Managed-custody credentials for outcome write operations. */
export interface OutcomeManagedCreds {
  apiKey: string;
  /** CONTROL wallet address from sign-in (NOT the managed address). */
  walletAddress: string;
  sessionPrivateKey: string;
}

/** Shared options for the structured write helpers. */
export interface OutcomeWriteOptions {
  /** A market from {@link getHlOutcomeMarkets}; skips the discovery fetch. */
  market?: OutcomeMarket;
  /**
   * Managed wallet address. When given, sells/closes are checked against the
   * actual position (sellable size, full-position minimum exemption, partial-close rules).
   */
  managedAddress?: string;
}

export interface CreateOutcomeOrderParams extends OutcomeManagedCreds, OutcomeWriteOptions {
  outcomeId: string | number;
  /** Side coin, `#<assetId>` from the market's `sides[].coin`. Give exactly one of coin / sideIndex / sideLabel. */
  coin?: string;
  sideIndex?: number;
  sideLabel?: string;
  /** true = buy side tokens with quote collateral; false = sell side tokens you hold. */
  isBuy: boolean;
  /** Limit price in [0.00001, 0.99999], max 5 decimals. Omit (or "0") when isMarket. */
  price?: string;
  /** Whole contracts. */
  size: string;
  /** Ignored by the backend (always r:false). */
  reduceOnly?: boolean;
  isMarket?: boolean;
  /** @deprecated Ignored by the backend. */
  dex?: string;
}

export interface CancelOutcomeOrderParams extends OutcomeManagedCreds, OutcomeWriteOptions {
  outcomeId: string | number;
  coin: string;
  /** Hyperliquid order id (oid) — a non-negative integer. */
  orderId: string;
  /** @deprecated Ignored by the backend. */
  dex?: string;
}

export interface CloseOutcomeOrderParams extends OutcomeManagedCreds, OutcomeWriteOptions {
  outcomeId: string | number;
  coin?: string;
  sideIndex?: number;
  sideLabel?: string;
  /** Limit price; omit (or "0") when isMarket. */
  price?: string;
  /** Contracts to sell; omit for the full available position (backend caps to what you hold). */
  size?: string;
  isMarket?: boolean;
  /** @deprecated Ignored by the backend. */
  dex?: string;
}

/** Pre-built encrypted-payload write request (advanced callers). No other fields allowed. */
export interface OutcomeOrderRequest {
  computedData: string;
}

/** Fields that only make sense on the structured path. */
const STRUCTURED_FIELDS = [
  'apiKey', 'walletAddress', 'sessionPrivateKey', 'outcomeId', 'coin', 'sideIndex', 'sideLabel', 'isBuy',
  'price', 'size', 'reduceOnly', 'isMarket', 'orderId', 'market', 'managedAddress',
] as const;

/**
 * Decide between the pre-built (`computedData` only) and structured paths and
 * reject a mix of both. Exported so the MCP layer reports the same error.
 */
export function resolveOutcomeWriteMode(
  req: Record<string, unknown>,
  required: readonly string[],
): 'prebuilt' | 'structured' {
  const has = (k: string): boolean => req[k] !== undefined && req[k] !== null && req[k] !== '';
  if (has('computedData')) {
    const mixed = STRUCTURED_FIELDS.filter((k) => has(k));
    if (typeof req.computedData !== 'string') throw new GdexValidationError('computedData must be a string', 'computedData');
    if (mixed.length > 0) {
      throw new GdexValidationError(
        `Pass either computedData alone or the structured fields, not both (got computedData with ${mixed.join(', ')})`,
        'computedData',
      );
    }
    return 'prebuilt';
  }
  const missing = required.filter((k) => !has(k));
  if (missing.length > 0) {
    throw new GdexValidationError(
      `Missing ${missing.join(', ')}. Pass the structured fields (${required.join(', ')}) or a pre-built computedData.`,
      missing[0],
    );
  }
  return 'structured';
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** Raw `GET /v1/hl/outcomes` (`{ isSuccess, data: { meta, mids } }`). Prefer {@link getHlOutcomeMarkets}. */
export async function getHlOutcomes(
  client: GdexApiClient,
  _params: OutcomesListParams = {},
): Promise<Record<string, unknown>> {
  return client.get(Endpoints.HL_OUTCOMES);
}

export interface OutcomeMarketsParams {
  /** Keep only these states (default: all). */
  state?: OutcomeTradingState | OutcomeTradingState[];
  /** Case-insensitive match on title, side labels or raw params. */
  query?: string;
  /** Hide question fallback legs ("none of the listed outcomes"). Default false. */
  excludeFallback?: boolean;
  /** Attach 24h volume from the Hyperliquid WS. */
  withVolume?: boolean;
  /** Hard cap on the volume wait so discovery never stalls (default 2500 ms). */
  volumeTimeoutMs?: number;
  /** WS URL override (tests). */
  volumeWsUrl?: string;
  limit?: number;
  /** Clock override (tests). */
  now?: number;
}

export interface OutcomeMarketsResult {
  markets: OutcomeMarket[];
  count: number;
  /** Markets before filtering/limit. */
  total: number;
  asOf: string;
  source: 'GET /v1/hl/outcomes (Hyperliquid outcomeMeta + allMids)';
  /** Present when withVolume: overall coverage across the returned markets. */
  volumeCoverage?: 'complete' | 'partial' | 'unavailable';
  notes: string[];
}

/**
 * Live HIP-4 outcome markets in the normalised {@link OutcomeMarket} shape.
 * Volume (optional) is bounded by `volumeTimeoutMs` and never fails discovery.
 */
export async function getHlOutcomeMarkets(
  client: GdexApiClient,
  params: OutcomeMarketsParams = {},
): Promise<OutcomeMarketsResult> {
  const raw = await client.get(Endpoints.HL_OUTCOMES);
  const now = params.now ?? Date.now();
  const all = normalizeOutcomeMarkets(raw, { now });
  const states = params.state === undefined ? null : new Set(Array.isArray(params.state) ? params.state : [params.state]);
  const q = params.query?.trim().toLowerCase();
  let markets = all.filter(
    (m) =>
      (!states || states.has(m.state)) &&
      (!params.excludeFallback || !m.isFallback) &&
      (!q ||
        m.title.toLowerCase().includes(q) ||
        m.sides.some((s) => s.label.toLowerCase().includes(q)) ||
        m.rawDescription.toLowerCase().includes(q) ||
        String(m.outcomeId) === q),
  );
  if (params.limit !== undefined && params.limit >= 0) markets = markets.slice(0, params.limit);

  const notes = [
    'Hyperliquid HIP-4 outcome markets. Collateral is each market\'s quoteToken in the managed wallet\'s HL spot balance.',
    'Side order follows Hyperliquid sideSpecs; read sides[].label — the first side is not necessarily "Yes".',
  ];
  const result: OutcomeMarketsResult = {
    markets,
    count: markets.length,
    total: all.length,
    asOf: new Date(now).toISOString(),
    source: 'GET /v1/hl/outcomes (Hyperliquid outcomeMeta + allMids)',
    notes,
  };

  if (params.withVolume && markets.length > 0) {
    const coins = markets.flatMap((m) => m.sides.map((s) => s.coin));
    let readings: { volumes: Record<string, number>; receivedAt: Record<string, number> } = { volumes: {}, receivedAt: {} };
    try {
      readings = await fetchHlOutcomeVolumeReadings(coins, {
        timeoutMs: params.volumeTimeoutMs ?? 2500,
        wsUrl: params.volumeWsUrl,
      });
    } catch {
      notes.push('Volume feed failed; volume24h.coverage is "unavailable".');
    }
    for (const m of markets) {
      m.volume24h = computeOutcomeVolume(m.sides.map((s) => s.coin), readings.volumes, readings.receivedAt);
    }
    const cov = markets.map((m) => m.volume24h!.coverage);
    result.volumeCoverage = cov.every((c) => c === 'complete') ? 'complete' : cov.every((c) => c === 'unavailable') ? 'unavailable' : 'partial';
  }
  return result;
}

/** One live market by id (throws GdexValidationError when unknown). */
export async function getHlOutcomeMarket(
  client: GdexApiClient,
  outcomeId: string | number,
  options: { now?: number } = {},
): Promise<OutcomeMarket> {
  const id = parseOutcomeId(outcomeId);
  const { markets } = await getHlOutcomeMarkets(client, { now: options.now });
  return findOutcomeMarket(markets, id);
}

/** Raw account state for a wallet on one outcome market. Prefer {@link getHlOutcomeAccountState}. */
export async function getHlOutcomeAccount(
  client: GdexApiClient,
  params: OutcomeAccountParams,
): Promise<Record<string, unknown>> {
  validateRequired(params.userAddress, 'userAddress');
  validateRequired(params.outcomeId, 'outcomeId');
  return client.get(Endpoints.HL_OUTCOME_ACCOUNT, {
    address: params.userAddress,
    outcomeId: String(parseOutcomeId(params.outcomeId)),
  });
}

/** Normalised positions / open orders / fills / order history for one market. */
export async function getHlOutcomeAccountState(
  client: GdexApiClient,
  params: OutcomeAccountParams & { market?: OutcomeMarket },
): Promise<OutcomeAccountState> {
  const [raw, market] = await Promise.all([
    getHlOutcomeAccount(client, params),
    params.market ? Promise.resolve(params.market) : getHlOutcomeMarket(client, params.outcomeId).catch(() => null),
  ]);
  return normalizeOutcomeAccount(raw, market);
}

export interface OutcomeCollateralCheck {
  quoteToken: string;
  total: number;
  hold: number;
  available: number;
  required: number | null;
  sufficient: boolean | null;
  source: 'hyperliquid info spotClearinghouseState';
  next: string;
}

/** Post a Hyperliquid info request (public, unauthenticated). */
export type HlInfoFetcher = (body: Record<string, unknown>) => Promise<unknown>;

const defaultHlInfo: HlInfoFetcher = async (body) =>
  (await axios.post(HL_INFO_URL, body, { timeout: 10000, headers: { 'Content-Type': 'application/json' } })).data;

/**
 * Check the managed wallet's HL spot balance of the market's quote token
 * against an intended buy (size × price). Outcome buys draw on HL **spot**
 * collateral, not the perp account (gdex.pro reads spot USDC:
 * HyperliquidOutcomeDetail.tsx:1037; backend agent check: hyperLiquidAgent/service.ts:447-453).
 */
export async function checkHlOutcomeCollateral(
  params: { managedAddress: string; quoteToken?: string; size?: string | number; price?: string | number },
  hlInfo: HlInfoFetcher = defaultHlInfo,
): Promise<OutcomeCollateralCheck> {
  validateRequired(params.managedAddress, 'managedAddress');
  const token = params.quoteToken ?? 'USDC';
  const state = (await hlInfo({ type: 'spotClearinghouseState', user: params.managedAddress })) as {
    balances?: Array<{ coin: string; total: string; hold: string }>;
  };
  const bal = (state?.balances ?? []).find((b) => b.coin === token);
  const total = Number(bal?.total ?? 0) || 0;
  const hold = Number(bal?.hold ?? 0) || 0;
  const available = Math.max(total - hold, 0);
  const required =
    params.size !== undefined && params.price !== undefined && Number(params.price) > 0
      ? Number(params.size) * Number(params.price)
      : null;
  const sufficient = required === null ? null : available >= required;
  return {
    quoteToken: token,
    total,
    hold,
    available,
    required,
    sufficient,
    source: 'hyperliquid info spotClearinghouseState',
    next:
      sufficient === false
        ? `Fund the managed wallet's HL spot ${token} (e.g. move USDC perp→spot or hl_swap_collateral into ${token}) before buying.`
        : 'Collateral read from HL spot balance.',
  };
}

// ── Writes ───────────────────────────────────────────────────────────────────

async function sellableSize(client: GdexApiClient, managedAddress: string | undefined, market: OutcomeMarket, coin: string): Promise<number | undefined> {
  if (!managedAddress) return undefined;
  const state = await getHlOutcomeAccountState(client, { userAddress: managedAddress, outcomeId: market.outcomeId, market });
  return state.positions.find((p) => p.coin === coin)?.available ?? 0;
}

async function marketFor(client: GdexApiClient, req: { market?: OutcomeMarket; outcomeId: string | number }): Promise<OutcomeMarket> {
  const id = parseOutcomeId(req.outcomeId);
  if (req.market) {
    if (req.market.outcomeId !== id) throw new GdexValidationError(`market is outcome ${req.market.outcomeId}, not ${id}`, 'market');
    return req.market;
  }
  return getHlOutcomeMarket(client, id);
}

/**
 * Create an order on an outcome market. Structured requests are validated
 * against the live market (side/coin, whole-contract size, price bounds, minimum
 * notional, tradable state) before signing.
 */
export async function createHlOutcomeOrder(
  client: GdexApiClient,
  req: CreateOutcomeOrderParams | OutcomeOrderRequest,
): Promise<OutcomeOrderResult> {
  const r = req as unknown as Record<string, unknown>;
  if (resolveOutcomeWriteMode(r, ['apiKey', 'walletAddress', 'sessionPrivateKey', 'outcomeId', 'isBuy', 'size']) === 'prebuilt') {
    const raw = await client.post(Endpoints.HL_OUTCOME_CREATE_ORDER, { computedData: r.computedData });
    return normalizeOutcomeOrderResult(raw, 'create', { warnings: ['Pre-built computedData: the SDK did not validate this order.'] });
  }
  const p = req as CreateOutcomeOrderParams;
  const market = await marketFor(client, p);
  const side = resolveOutcomeSide(market, p);
  const availableSize = p.isBuy ? undefined : await sellableSize(client, p.managedAddress, market, side.coin);
  const v = validateOutcomeOrder(market, { ...p, coin: side.coin, sideIndex: undefined, sideLabel: undefined }, { availableSize });
  const computedData = buildHlComputedData({
    action: 'hl_outcome_create_order',
    apiKey: p.apiKey,
    walletAddress: p.walletAddress,
    sessionPrivateKey: p.sessionPrivateKey,
    actionParams: {
      outcomeId: String(v.outcomeId),
      coin: v.side.coin,
      isBuy: v.isBuy,
      price: v.price,
      size: v.size,
      reduceOnly: p.reduceOnly ?? false,
      isMarket: v.isMarket,
    },
  });
  const raw = await client.post(Endpoints.HL_OUTCOME_CREATE_ORDER, { computedData });
  return normalizeOutcomeOrderResult(raw, 'create', {
    warnings: v.warnings,
    request: {
      outcomeId: v.outcomeId, coin: v.side.coin, sideLabel: v.side.label, isBuy: v.isBuy, isMarket: v.isMarket,
      price: v.price, size: v.size, notional: v.notional, notionalIsEstimate: v.notionalIsEstimate, quoteToken: v.quoteToken,
    },
  });
}

/** Cancel a resting outcome-market order. */
export async function cancelHlOutcomeOrder(
  client: GdexApiClient,
  req: CancelOutcomeOrderParams | OutcomeOrderRequest,
): Promise<OutcomeOrderResult> {
  const r = req as unknown as Record<string, unknown>;
  if (resolveOutcomeWriteMode(r, ['apiKey', 'walletAddress', 'sessionPrivateKey', 'outcomeId', 'coin', 'orderId']) === 'prebuilt') {
    const raw = await client.post(Endpoints.HL_OUTCOME_CANCEL_ORDER, { computedData: r.computedData });
    return normalizeOutcomeOrderResult(raw, 'cancel');
  }
  const p = req as CancelOutcomeOrderParams;
  const orderId = String(p.orderId).trim();
  // Backend requires a non-negative integer oid (hyperLiquidOutcomes.ts:400-403).
  if (!/^\d+$/.test(orderId)) throw new GdexValidationError(`orderId must be the numeric Hyperliquid oid, got "${p.orderId}"`, 'orderId');
  const market = await marketFor(client, p);
  const side = resolveOutcomeSide(market, { coin: p.coin });
  const computedData = buildHlComputedData({
    action: 'hl_outcome_cancel_order',
    apiKey: p.apiKey,
    walletAddress: p.walletAddress,
    sessionPrivateKey: p.sessionPrivateKey,
    actionParams: { outcomeId: String(market.outcomeId), coin: side.coin, orderId },
  });
  const raw = await client.post(Endpoints.HL_OUTCOME_CANCEL_ORDER, { computedData });
  return normalizeOutcomeOrderResult(raw, 'cancel', {
    request: { outcomeId: market.outcomeId, coin: side.coin, sideLabel: side.label, orderId },
  });
}

/**
 * Exit an outcome position: a sell of held side tokens (the backend always sells,
 * hyperLiquidOutcomes.ts:451). Omit size for a full exit; the backend caps size to
 * what the wallet holds.
 */
export async function closeHlOutcomeOrder(
  client: GdexApiClient,
  req: CloseOutcomeOrderParams | OutcomeOrderRequest,
): Promise<OutcomeOrderResult> {
  const r = req as unknown as Record<string, unknown>;
  if (resolveOutcomeWriteMode(r, ['apiKey', 'walletAddress', 'sessionPrivateKey', 'outcomeId']) === 'prebuilt') {
    const raw = await client.post(Endpoints.HL_OUTCOME_CLOSE_ORDER, { computedData: r.computedData });
    return normalizeOutcomeOrderResult(raw, 'close', { warnings: ['Pre-built computedData: the SDK did not validate this close.'] });
  }
  const p = req as CloseOutcomeOrderParams;
  const market = await marketFor(client, p);
  const side = resolveOutcomeSide(market, p);
  const availableSize = await sellableSize(client, p.managedAddress, market, side.coin);
  const v = validateOutcomeClose(market, { ...p, coin: side.coin, sideIndex: undefined, sideLabel: undefined }, { availableSize });
  const computedData = buildHlComputedData({
    action: 'hl_outcome_close_order',
    apiKey: p.apiKey,
    walletAddress: p.walletAddress,
    sessionPrivateKey: p.sessionPrivateKey,
    actionParams: {
      outcomeId: String(v.outcomeId),
      coin: v.side.coin,
      price: v.price,
      size: v.size,
      isMarket: v.isMarket,
    },
  });
  const raw = await client.post(Endpoints.HL_OUTCOME_CLOSE_ORDER, { computedData });
  return normalizeOutcomeOrderResult(raw, 'close', {
    warnings: v.warnings,
    request: { outcomeId: v.outcomeId, coin: v.side.coin, sideLabel: v.side.label, isMarket: v.isMarket, price: v.price, size: v.size || 'all', full: v.full },
  });
}
