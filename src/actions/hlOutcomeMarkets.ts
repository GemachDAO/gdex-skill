/**
 * Normalisation and pre-flight validation for Hyperliquid HIP-4 outcome markets.
 *
 * GDEX outcome markets are Hyperliquid **HIP-4 outcome** markets — spot-settled
 * binary/multi-outcome contracts priced in (0,1) — not HIP-3 builder perp DEXes,
 * not perps and not Polymarket/Kalshi (GDEX has no Polymarket or Kalshi
 * integration). Everything here is derived from two sources, never assumed:
 *
 *   - `GET /v1/hl/outcomes` → `{ meta, mids }` where `meta` is Hyperliquid's
 *     `outcomeMeta` info response and `mids` is `allMids`
 *     (backend `src/services/perp/hyperLiquidOutcomes.ts:481-485`).
 *   - The rules the GDEX backend and gdex.pro apply when an order is placed
 *     (cited per field in {@link OUTCOME_ORDER_RULES}).
 *
 * All functions here are pure: no network, so they are safe to unit-test with
 * captured fixtures.
 */
import { GdexValidationError } from '../utils/errors';

// ── Rules ────────────────────────────────────────────────────────────────────

/**
 * Order rules for every HIP-4 outcome market. Hyperliquid's `outcomeMeta` carries
 * no per-market tick/size fields, so these are the rules the GDEX path enforces.
 */
export const OUTCOME_ORDER_RULES = {
  /** Prices are probabilities strictly inside (0,1). */
  priceMin: 0.00001,
  priceMax: 0.99999,
  /** Backend rounds prices with `toFixed(5)` (hyperLiquidOutcomes.ts:85-91); market-order slippage clamps to [0.00001, 0.99999] (:119-126). */
  priceDecimals: 5,
  priceTick: '0.00001',
  /** "HIP-4 outcomes trade whole contracts" — OUTCOME_SIZE_DECIMALS = 0 (hyperLiquidOutcomes.ts:69,185-188). */
  sizeDecimals: 0,
  minSize: 1,
  /**
   * gdex.pro refuses outcome orders below 11 quote units of notional (size × price):
   * MIN_OUTCOME_ORDER_USDC = 11 (gbotTradingDashboardUI@staging
   * src/components/outcomes/HyperliquidOutcomeDetail.tsx:84,1150-1158). Hyperliquid's own
   * floor is 10; 11 leaves headroom for rounding. The backend does not check it.
   */
  minOrderNotional: 11,
  /** A sell of the whole position is exempt from the minimum (HyperliquidOutcomeDetail.tsx:1145-1152). */
  fullPositionSellExempt: true,
  /** Market orders take the top of book ±5% (hyperLiquidOutcomes.ts:119-126,154-168). */
  marketSlippagePct: 5,
  /** Limit orders rest as GTC, market orders go out as FrontendMarket (hyperLiquidOutcomes.ts:321). */
  limitTif: 'Gtc',
  marketTif: 'FrontendMarket',
  /** The backend hard-codes `r: false` (hyperLiquidOutcomes.ts:330): reduceOnly is NOT honoured. */
  reduceOnlyHonoured: false,
  /** Close is always a sell of held side tokens, capped to available size (hyperLiquidOutcomes.ts:420-479). */
  closeIsSellOfHeldTokens: true,
} as const;

/** Exchange asset id offset for outcome coins (hyperLiquidOutcomes.ts:68,71-76). */
export const OUTCOME_EXCHANGE_ASSET_ID_BASE = 100000000;

/** Where to find the payout after a market resolves. Same for every market. */
export const OUTCOME_SETTLEMENT_SUPPORT = {
  mechanism: 'hyperliquid_hip4',
  /**
   * The GDEX backend exposes exactly five outcome routes (src/api/hyperLiquid.ts:42-46):
   * outcomes, outcome_account, outcome/create_order, outcome/cancel_order, outcome/close_order.
   * There is no claim, redeem or settle route.
   */
  claimViaGdex: false,
  summary:
    'Settlement is done on Hyperliquid by the market deployer (settleOutcome / settleQuestion permissions in outcomeMeta.deployers). ' +
    'GDEX has no claim or redeem endpoint, so there is nothing to call after resolution: read the managed wallet\'s Hyperliquid spot balances ' +
    '(get_hl_outcome_account / spotClearinghouseState) to see the result. Before resolution, exit by selling (hl_close_outcome_order).',
} as const;

// ── Types ────────────────────────────────────────────────────────────────────

/** `outcomeMeta.outcomes[i]` as Hyperliquid returns it. */
export interface RawOutcome {
  outcome: number;
  name: string;
  description: string;
  sideSpecs: Array<{ name: string; token?: number }>;
  quoteToken?: string;
  venue?: string;
  deployerFeeScale?: string;
}

/** `outcomeMeta.questions[i]` as Hyperliquid returns it. */
export interface RawOutcomeQuestion {
  question: number;
  name: string;
  description: string;
  fallbackOutcome: number;
  namedOutcomes: number[];
  settledNamedOutcomes: number[];
}

/** `data` of `GET /v1/hl/outcomes`. */
export interface RawOutcomesPayload {
  meta?: { outcomes?: RawOutcome[]; questions?: RawOutcomeQuestion[] };
  mids?: Record<string, string>;
}

/**
 * - `active`     — at least one side has a live mid price.
 * - `pre_launch` — listed but no side has a mid yet (no book).
 * - `expired`    — the market's own expiry/deadline has passed but Hyperliquid has not marked it settled.
 * - `settled`    — the question lists this outcome in `settledNamedOutcomes`.
 * (Same derivation as gdex.pro: gbotTradingDashboardUI@staging src/utils/hlApi.ts:961-969.)
 */
export type OutcomeTradingState = 'active' | 'pre_launch' | 'expired' | 'settled';

export interface OutcomeSide {
  sideIndex: number;
  /** Display label, with Hyperliquid `template:` placeholders filled from the market's parameters. */
  label: string;
  /** `sideSpecs[i].name` exactly as Hyperliquid sends it (may be `template:{shortNameA}`). */
  rawName: string;
  /** Order coin, `#<assetId>`. Use this as `coin` in create/cancel/close. */
  coin: string;
  /** `sideSpecs[i].token`, or `outcomeId*10 + sideIndex` when absent (backend hyperLiquidOutcomes.ts:128-141). */
  assetId: number;
  /** Spot balance key for this side's tokens, `+<assetId>` (hyperLiquidOutcomes.ts:78-83). */
  balanceCoin: string;
  /** Exchange asset id, `100000000 + assetId` (hyperLiquidOutcomes.ts:71-76). */
  exchangeAssetId: number;
  /** Current mid (probability) from `allMids`, or null when the side has no book. */
  price: number | null;
}

export interface OutcomeMarketRules {
  priceMin: number;
  priceMax: number;
  priceTick: string;
  priceDecimals: number;
  sizeDecimals: number;
  minSize: number;
  minOrderNotional: number;
  minOrderNotionalCurrency: string;
  fullPositionSellExempt: boolean;
  marketSlippagePct: number;
  reduceOnlyHonoured: boolean;
}

export interface OutcomeSettlementInfo {
  mechanism: 'hyperliquid_hip4';
  claimViaGdex: false;
  /** `officialSource` / `priceDescription` parameter, when the market publishes one. */
  resolutionSource: string | null;
  /** Deadline / expiry parameter, ISO-8601 UTC. */
  resolutionDeadline: string | null;
  summary: string;
}

/** One HIP-4 outcome market in a stable, documented shape. */
export interface OutcomeMarket {
  kind: 'hyperliquid_hip4_outcome';
  outcomeId: number;
  title: string;
  /** Raw `outcome.name` / `outcome.description` (often template ids / key:value params). */
  rawName: string;
  rawDescription: string;
  /** Merged `key:value` parameters (question first, outcome overrides). */
  params: Record<string, string>;
  questionId: number | null;
  questionTitle: string | null;
  /** The "none of the listed outcomes" leg of a question. */
  isFallback: boolean;
  /** Deployer venue (`out`, `skew`, `txyz`, …) when Hyperliquid reports one. */
  venue: string | null;
  /** Collateral / quote currency (`outcome.quoteToken`); held in the managed wallet's HL **spot** balance. */
  quoteToken: string;
  sides: OutcomeSide[];
  state: OutcomeTradingState;
  /** True only when `state === 'active'`. */
  tradable: boolean;
  expiry: string | null;
  expiryMs: number | null;
  rules: OutcomeMarketRules;
  settlement: OutcomeSettlementInfo;
  /** Filled by the volume enrichment; absent when volume was not requested. */
  volume24h?: OutcomeVolume;
}

/** 24h notional volume for a market (GDX-14). */
export interface OutcomeVolume {
  /** Sum of the side readings that arrived; null when none did. A verified 0 stays 0. */
  volume: number | null;
  /** ISO time of the oldest side reading used, or null. */
  asOf: string | null;
  source: 'hyperliquid_ws_activeAssetCtx.dayNtlVlm';
  /** `complete` = every side reported; `partial` = some did; `unavailable` = none did. */
  coverage: 'complete' | 'partial' | 'unavailable';
  /** Side coins with no reading. */
  missingCoins: string[];
}

// ── Parsing helpers ──────────────────────────────────────────────────────────

/** `key:value|key:value`, split on the first colon only (UI hlApi.ts:244-254). */
export function parseOutcomeParams(description: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (description ?? '').split('|')) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}

/** `YYYYMMDD-HHMM` (UTC) → epoch ms. */
export function parseOutcomeTime(value: string | undefined): number | null {
  const m = value?.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
}

/** "sportsContestParticipant2" → "Sports Contest Participant 2". */
export function humanizeOutcomeName(name: string | undefined): string {
  const bare = (name ?? '').replace(/^template:/, '').trim();
  if (!bare) return '';
  return bare
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

/** Fill `template:{key}` from params; strip `template:` from literal labels. */
export function renderOutcomeSideLabel(rawName: string, params: Record<string, string>, sideIndex: number): string {
  const name = rawName ?? '';
  const placeholder = name.match(/^template:\{(.+)\}$/)?.[1];
  if (placeholder) return params[placeholder] || humanizeOutcomeName(placeholder);
  const label = name.startsWith('template:') ? name.slice('template:'.length) : name;
  return label.trim() || `Side ${sideIndex + 1}`;
}

const EXPIRY_KEYS = [
  'expiry', 'time', 'scheduledDecision', 'decisionDeadline', 'resolutionDeadline', 'dateTime', 'listingDeadline',
] as const;

function pickExpiry(params: Record<string, string>): number | null {
  for (const k of EXPIRY_KEYS) {
    const ms = parseOutcomeTime(params[k]);
    if (ms !== null) return ms;
  }
  return null;
}

function fmtTime(ms: number | null): string {
  return ms === null ? 'unscheduled' : `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function fmtNum(v: string | undefined): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : String(v);
}

function buildQuestionTitle(q: RawOutcomeQuestion | undefined, p: Record<string, string>): string | null {
  if (!q) return null;
  if (p.participantA && p.participantB) {
    return `${p.participantA} vs ${p.participantB}${p.competition ? ` (${p.competition})` : ''}`;
  }
  if (p.class === 'priceBucket' && p.underlying) return `${p.underlying} price range at ${fmtTime(pickExpiry(p))}`;
  if (p.award) return `${p.award}${p.period ? ` ${p.period}` : ''} winner`;
  return humanizeOutcomeName(q.name) || `Question #${q.question}`;
}

function buildTitle(
  o: RawOutcome,
  p: Record<string, string>,
  q: RawOutcomeQuestion | undefined,
  isFallback: boolean,
  expiryMs: number | null,
): string {
  const qTitle = buildQuestionTitle(q, p);
  const underlying = p.underlying ?? p.perp ?? p.shortName;
  const target = p.targetPrice ?? p.threshold ?? p.target;
  const cls = p.class ?? (p.threshold !== undefined ? 'priceBinary' : p.target !== undefined ? 'priceTouch' : undefined);
  if (isFallback) return qTitle ? `${qTitle}: none of the listed outcomes` : 'None of the listed outcomes';
  if (cls === 'priceBinary' && underlying && target !== undefined) {
    return `${underlying} above ${fmtNum(target)} at ${fmtTime(expiryMs)}?`;
  }
  if (cls === 'priceTouch' && underlying && target !== undefined) {
    return `${underlying} touches ${fmtNum(target)} by ${fmtTime(expiryMs)}?`;
  }
  if (cls === 'priceBucket' && underlying && p.priceThresholds) {
    const [lo, hi] = p.priceThresholds.split(',').map((s) => s.trim());
    const idx = p.index !== undefined ? Number(p.index) : q ? q.namedOutcomes.indexOf(o.outcome) : -1;
    const when = fmtTime(expiryMs);
    if (idx === 0) return `${underlying} below ${fmtNum(lo)} at ${when}?`;
    if (idx === 1) return `${underlying} between ${fmtNum(lo)} and ${fmtNum(hi)} at ${when}?`;
    if (idx === 2) return `${underlying} above ${fmtNum(hi)} at ${when}?`;
  }
  const own = parseOutcomeParams(o.description);
  const subject = own.participant ?? own.candidate ?? own.company ?? own.shortName;
  if (/draw/i.test(o.name)) return qTitle ? `${qTitle}: draw` : 'Draw';
  if (qTitle && subject) return `${qTitle}: ${subject}`;
  if (!q && p.participantA && p.participantB) {
    return `${p.participantA} vs ${p.participantB}${p.competition ? ` (${p.competition})` : ''}`;
  }
  if (qTitle) return `${qTitle}: ${humanizeOutcomeName(o.name)}`;
  const human = humanizeOutcomeName(o.name);
  if (human && subject) return `${human}: ${subject}`;
  return human || `Outcome #${o.outcome}`;
}

/** Order coin for a side: `#<token>` or `#<outcomeId*10 + sideIndex>` (backend hyperLiquidOutcomes.ts:128-141,178-181). */
export function outcomeSideAssetId(outcomeId: number, sideIndex: number, token?: number): number {
  const t = Number(token);
  if (token !== undefined && Number.isInteger(t) && t >= 0) {
    return t >= OUTCOME_EXCHANGE_ASSET_ID_BASE ? t - OUTCOME_EXCHANGE_ASSET_ID_BASE : t;
  }
  return outcomeId * 10 + sideIndex;
}

// ── Normalisation ────────────────────────────────────────────────────────────

/**
 * Normalise `GET /v1/hl/outcomes` (`{ meta, mids }`, with or without the
 * `{ isSuccess, data }` envelope) into {@link OutcomeMarket}s.
 */
export function normalizeOutcomeMarkets(
  payload: unknown,
  options: { now?: number } = {},
): OutcomeMarket[] {
  const env = payload as { data?: RawOutcomesPayload } & RawOutcomesPayload;
  const data: RawOutcomesPayload = (env && typeof env === 'object' && 'data' in env ? env.data : env) ?? {};
  const outcomes = data.meta?.outcomes ?? [];
  const questions = data.meta?.questions ?? [];
  const mids = data.mids ?? {};
  const now = options.now ?? Date.now();

  const qByOutcome = new Map<number, RawOutcomeQuestion>();
  for (const q of questions) {
    qByOutcome.set(q.fallbackOutcome, q);
    for (const id of q.namedOutcomes ?? []) qByOutcome.set(id, q);
  }

  return outcomes.map((o): OutcomeMarket => {
    const q = qByOutcome.get(o.outcome);
    const params = { ...parseOutcomeParams(q?.description), ...parseOutcomeParams(o.description) };
    const isFallback = q?.fallbackOutcome === o.outcome;
    const expiryMs = pickExpiry(params);
    const quoteToken = o.quoteToken || 'USDC';
    const sides: OutcomeSide[] = (o.sideSpecs ?? []).map((s, i) => {
      const assetId = outcomeSideAssetId(o.outcome, i, s.token);
      const coin = `#${assetId}`;
      const mid = Number(mids[coin]);
      return {
        sideIndex: i,
        label: renderOutcomeSideLabel(s.name, params, i),
        rawName: s.name,
        coin,
        assetId,
        balanceCoin: `+${assetId}`,
        exchangeAssetId: OUTCOME_EXCHANGE_ASSET_ID_BASE + assetId,
        price: mids[coin] !== undefined && Number.isFinite(mid) ? mid : null,
      };
    });
    const settled = Boolean(q?.settledNamedOutcomes?.includes(o.outcome));
    const state: OutcomeTradingState = settled
      ? 'settled'
      : expiryMs !== null && expiryMs <= now
        ? 'expired'
        : sides.some((s) => s.price !== null)
          ? 'active'
          : 'pre_launch';
    return {
      kind: 'hyperliquid_hip4_outcome',
      outcomeId: o.outcome,
      title: buildTitle(o, params, q, isFallback, expiryMs),
      rawName: o.name,
      rawDescription: o.description,
      params,
      questionId: q?.question ?? null,
      questionTitle: buildQuestionTitle(q, params),
      isFallback,
      venue: o.venue ?? null,
      quoteToken,
      sides,
      state,
      tradable: state === 'active',
      expiry: expiryMs === null ? null : new Date(expiryMs).toISOString(),
      expiryMs,
      rules: {
        priceMin: OUTCOME_ORDER_RULES.priceMin,
        priceMax: OUTCOME_ORDER_RULES.priceMax,
        priceTick: OUTCOME_ORDER_RULES.priceTick,
        priceDecimals: OUTCOME_ORDER_RULES.priceDecimals,
        sizeDecimals: OUTCOME_ORDER_RULES.sizeDecimals,
        minSize: OUTCOME_ORDER_RULES.minSize,
        minOrderNotional: OUTCOME_ORDER_RULES.minOrderNotional,
        minOrderNotionalCurrency: quoteToken,
        fullPositionSellExempt: OUTCOME_ORDER_RULES.fullPositionSellExempt,
        marketSlippagePct: OUTCOME_ORDER_RULES.marketSlippagePct,
        reduceOnlyHonoured: OUTCOME_ORDER_RULES.reduceOnlyHonoured,
      },
      settlement: {
        mechanism: OUTCOME_SETTLEMENT_SUPPORT.mechanism,
        claimViaGdex: OUTCOME_SETTLEMENT_SUPPORT.claimViaGdex,
        resolutionSource: params.officialSource ?? params.priceDescription ?? null,
        resolutionDeadline: expiryMs === null ? null : new Date(expiryMs).toISOString(),
        summary:
          state === 'settled'
            ? `Resolved on Hyperliquid. ${OUTCOME_SETTLEMENT_SUPPORT.summary}`
            : state === 'expired'
              ? `Past its deadline and not yet marked settled by Hyperliquid; new orders are refused by the SDK. ${OUTCOME_SETTLEMENT_SUPPORT.summary}`
              : OUTCOME_SETTLEMENT_SUPPORT.summary,
      },
    };
  });
}

/** Find one market by id, or throw a GdexValidationError naming what exists. */
export function findOutcomeMarket(markets: OutcomeMarket[], outcomeId: string | number): OutcomeMarket {
  const id = parseOutcomeId(outcomeId);
  const m = markets.find((x) => x.outcomeId === id);
  if (!m) {
    throw new GdexValidationError(
      `Unknown outcomeId ${id}: not in the live Hyperliquid outcomeMeta (${markets.length} markets listed). Call hl_outcomes to discover ids.`,
      'outcomeId',
    );
  }
  return m;
}

/** Non-negative integer outcome id (backend normalizeOutcomeId, hyperLiquidOutcomes.ts:53-59). */
export function parseOutcomeId(outcomeId: string | number | undefined): number {
  const s = String(outcomeId ?? '').trim();
  if (!/^\d+$/.test(s)) throw new GdexValidationError(`outcomeId must be a non-negative integer, got "${outcomeId}"`, 'outcomeId');
  return Number(s);
}

/** Side selector: exactly one of coin / sideIndex / sideLabel. */
export interface OutcomeSideSelector {
  coin?: string;
  sideIndex?: number;
  sideLabel?: string;
}

/**
 * Resolve the side an order targets. The first side is NOT assumed to be "Yes":
 * labels come from Hyperliquid's sideSpecs (e.g. a match market's sides are the
 * two team names).
 */
export function resolveOutcomeSide(market: OutcomeMarket, sel: OutcomeSideSelector): OutcomeSide {
  const given = [sel.coin !== undefined && sel.coin !== '', sel.sideIndex !== undefined, sel.sideLabel !== undefined && sel.sideLabel !== ''];
  if (given.filter(Boolean).length !== 1) {
    throw new GdexValidationError('Pick the side with exactly one of coin, sideIndex or sideLabel', 'coin');
  }
  const labels = market.sides.map((s) => `${s.coin}="${s.label}"`).join(', ');
  let side: OutcomeSide | undefined;
  if (given[0]) {
    if (!/^#\d+$/.test(String(sel.coin))) {
      throw new GdexValidationError(`Outcome coin must look like "#<assetId>", got "${sel.coin}". Sides: ${labels}`, 'coin');
    }
    side = market.sides.find((s) => s.coin === sel.coin);
    if (!side) {
      throw new GdexValidationError(
        `Coin ${sel.coin} does not belong to outcome ${market.outcomeId}. Its sides are ${labels}`,
        'coin',
      );
    }
  } else if (given[1]) {
    side = market.sides[Number(sel.sideIndex)];
    if (!side || !Number.isInteger(sel.sideIndex)) {
      throw new GdexValidationError(`sideIndex ${sel.sideIndex} is out of range. Sides: ${labels}`, 'sideIndex');
    }
  } else {
    const want = String(sel.sideLabel).trim().toLowerCase();
    const matches = market.sides.filter((s) => s.label.toLowerCase() === want);
    if (matches.length !== 1) {
      throw new GdexValidationError(`sideLabel "${sel.sideLabel}" ${matches.length ? 'is ambiguous' : 'matches no side'}. Sides: ${labels}`, 'sideLabel');
    }
    side = matches[0];
  }
  return side;
}

// ── Order validation ─────────────────────────────────────────────────────────

/** Whole-contract size as a canonical integer string. */
export function parseOutcomeSize(size: string | number | undefined, field = 'size'): number {
  const s = String(size ?? '').trim();
  if (!/^\d+$/.test(s) || Number(s) < OUTCOME_ORDER_RULES.minSize) {
    throw new GdexValidationError(
      `${field} must be a positive whole number of contracts (outcomes trade whole contracts), got "${size}"`,
      field,
    );
  }
  const n = Number(s);
  if (!Number.isSafeInteger(n)) throw new GdexValidationError(`${field} is too large`, field);
  return n;
}

/** Probability price with at most 5 decimals inside [0.00001, 0.99999]. */
export function parseOutcomePrice(price: string | number | undefined, field = 'price'): number {
  const s = String(price ?? '').trim();
  if (!/^(0(\.\d+)?|\.\d+)$/.test(s)) {
    throw new GdexValidationError(`${field} must be a decimal probability like "0.42", got "${price}"`, field);
  }
  const decimals = s.includes('.') ? s.split('.')[1].length : 0;
  if (decimals > OUTCOME_ORDER_RULES.priceDecimals) {
    throw new GdexValidationError(
      `${field} "${s}" has ${decimals} decimals; the tick is ${OUTCOME_ORDER_RULES.priceTick} (max 5 decimals)`,
      field,
    );
  }
  const n = Number(s);
  if (n < OUTCOME_ORDER_RULES.priceMin || n > OUTCOME_ORDER_RULES.priceMax) {
    throw new GdexValidationError(
      `${field} ${s} is outside [${OUTCOME_ORDER_RULES.priceMin}, ${OUTCOME_ORDER_RULES.priceMax}]`,
      field,
    );
  }
  return n;
}

export interface OutcomeOrderInput extends OutcomeSideSelector {
  isBuy: boolean;
  /** Limit price; omit (or "0") for market orders. */
  price?: string | number;
  size: string | number;
  isMarket?: boolean;
  reduceOnly?: boolean;
}

export interface ValidatedOutcomeOrder {
  outcomeId: number;
  side: OutcomeSide;
  isBuy: boolean;
  isMarket: boolean;
  /** Canonical strings sent to the backend. */
  price: string;
  size: string;
  /** size × price (limit) or size × mid × (1 ± 5%) (market estimate). */
  notional: number;
  notionalIsEstimate: boolean;
  quoteToken: string;
  warnings: string[];
}

/** Context that sharpens validation when the caller has the account state. */
export interface OutcomeOrderContext {
  /** Side tokens the wallet can sell (total − hold). */
  availableSize?: number;
}

function assertTradable(market: OutcomeMarket, action: string): void {
  if (market.state === 'settled' || market.state === 'expired') {
    throw new GdexValidationError(
      `Outcome ${market.outcomeId} is ${market.state}; ${action} is refused. ${market.settlement.summary}`,
      'outcomeId',
    );
  }
}

/** Validate an open/sell order against a discovered market. */
export function validateOutcomeOrder(
  market: OutcomeMarket,
  input: OutcomeOrderInput,
  ctx: OutcomeOrderContext = {},
): ValidatedOutcomeOrder {
  if (typeof input.isBuy !== 'boolean') throw new GdexValidationError('isBuy must be true (buy side tokens) or false (sell held tokens)', 'isBuy');
  assertTradable(market, 'placing orders');
  const side = resolveOutcomeSide(market, input);
  const size = parseOutcomeSize(input.size);
  const isMarket = input.isMarket === true;
  const warnings: string[] = [];
  if (input.reduceOnly) {
    warnings.push('reduceOnly is ignored by the GDEX backend for outcome orders (it always sends r:false); a sell can only sell tokens you hold.');
  }

  let price: number;
  let priceStr: string;
  let notionalIsEstimate = false;
  if (isMarket) {
    if (input.price !== undefined && input.price !== '' && Number(input.price) !== 0) {
      throw new GdexValidationError('Market orders take the live book price; omit price or pass "0"', 'price');
    }
    if (side.price === null) {
      throw new GdexValidationError(`Side ${side.coin} ("${side.label}") has no book/mid price; use a limit order`, 'isMarket');
    }
    const slip = OUTCOME_ORDER_RULES.marketSlippagePct / 100;
    price = input.isBuy ? Math.min(side.price * (1 + slip), OUTCOME_ORDER_RULES.priceMax) : Math.max(side.price * (1 - slip), OUTCOME_ORDER_RULES.priceMin);
    priceStr = '0';
    notionalIsEstimate = true;
  } else {
    if (market.state === 'pre_launch') warnings.push('No side of this market has a mid price yet; a limit order may rest without fills.');
    price = parseOutcomePrice(input.price);
    priceStr = String(input.price).trim();
  }

  const notional = size * price;
  const sellingAll = !input.isBuy && ctx.availableSize !== undefined && size >= Math.floor(ctx.availableSize);
  if (!input.isBuy && ctx.availableSize !== undefined) {
    if (ctx.availableSize <= 0) throw new GdexValidationError(`No sellable ${side.label} tokens (${side.coin}) in this wallet`, 'size');
    if (size > ctx.availableSize) {
      throw new GdexValidationError(`Sell size ${size} exceeds available ${side.label} tokens (${ctx.availableSize})`, 'size');
    }
  }
  if (notional < OUTCOME_ORDER_RULES.minOrderNotional && !sellingAll) {
    const need = Math.ceil(OUTCOME_ORDER_RULES.minOrderNotional / price);
    throw new GdexValidationError(
      `Order notional ${notional.toFixed(4)} ${market.quoteToken} is below the ${OUTCOME_ORDER_RULES.minOrderNotional} ${market.quoteToken} minimum ` +
        `(size × price${notionalIsEstimate ? ', estimated from the mid' : ''}). At this price use size >= ${need}` +
        (input.isBuy ? '.' : ', or sell the whole position (pass the account context / use hl_close_outcome_order).'),
      'size',
    );
  }
  return {
    outcomeId: market.outcomeId,
    side,
    isBuy: input.isBuy,
    isMarket,
    price: priceStr,
    size: String(size),
    notional,
    notionalIsEstimate,
    quoteToken: market.quoteToken,
    warnings,
  };
}

export interface OutcomeCloseInput extends OutcomeSideSelector {
  /** Limit price; omit (or "0") when isMarket. */
  price?: string | number;
  /** Contracts to sell; omit for the full available position. */
  size?: string | number;
  isMarket?: boolean;
}

export interface ValidatedOutcomeClose {
  outcomeId: number;
  side: OutcomeSide;
  isMarket: boolean;
  price: string;
  /** Contracts requested; "" means the backend sells everything available. */
  size: string;
  full: boolean;
  warnings: string[];
}

/**
 * Validate a close (sell of held side tokens). With `availableSize`, enforces the
 * gdex.pro partial-close rules (HyperliquidOutcomeDetail.tsx:356-373): the closed part
 * and the remainder must each be worth at least the minimum, else close everything.
 */
export function validateOutcomeClose(
  market: OutcomeMarket,
  input: OutcomeCloseInput,
  ctx: OutcomeOrderContext = {},
): ValidatedOutcomeClose {
  if (market.state === 'settled') {
    throw new GdexValidationError(`Outcome ${market.outcomeId} is settled; there is no book to sell into. ${market.settlement.summary}`, 'outcomeId');
  }
  const side = resolveOutcomeSide(market, input);
  const isMarket = input.isMarket === true;
  const warnings: string[] = [];
  if (market.state === 'expired') warnings.push('Market is past its deadline; the close may fail if Hyperliquid has halted the book.');
  let priceNum: number;
  let priceStr: string;
  if (isMarket) {
    if (input.price !== undefined && input.price !== '' && Number(input.price) !== 0) {
      throw new GdexValidationError('Market closes take the live book price; omit price or pass "0"', 'price');
    }
    if (side.price === null) throw new GdexValidationError(`Side ${side.coin} has no book/mid price; close with a limit price`, 'isMarket');
    priceNum = side.price;
    priceStr = '0';
  } else {
    priceNum = parseOutcomePrice(input.price);
    priceStr = String(input.price).trim();
  }
  const sizeGiven = input.size !== undefined && input.size !== '' && String(input.size) !== '0';
  const size = sizeGiven ? parseOutcomeSize(input.size) : null;
  if (ctx.availableSize !== undefined) {
    const avail = Math.floor(ctx.availableSize);
    if (avail <= 0) throw new GdexValidationError(`No ${side.label} position (${side.coin}) to close`, 'coin');
    if (size !== null && size > avail) {
      throw new GdexValidationError(`Close size ${size} exceeds the available position (${avail})`, 'size');
    }
    if (size !== null && size < avail) {
      const min = OUTCOME_ORDER_RULES.minOrderNotional;
      const mark = side.price ?? priceNum;
      if (size * priceNum < min) {
        throw new GdexValidationError(`Partial close value ${(size * priceNum).toFixed(4)} is below ${min} ${market.quoteToken}; close more or the full position`, 'size');
      }
      if ((avail - size) * mark < min) {
        throw new GdexValidationError(`The remaining position would be worth less than ${min} ${market.quoteToken}; close the full position instead`, 'size');
      }
    }
  } else if (size !== null) {
    warnings.push('Partial-close minimums were not checked (no account context); the backend caps the size to what you hold.');
  }
  return {
    outcomeId: market.outcomeId,
    side,
    isMarket,
    price: priceStr,
    size: size === null ? '' : String(size),
    full: size === null || (ctx.availableSize !== undefined && size >= Math.floor(ctx.availableSize)),
    warnings,
  };
}

// ── Account / order-result normalisation ─────────────────────────────────────

export interface OutcomePosition {
  outcomeId: number;
  coin: string;
  balanceCoin: string;
  sideIndex: number | null;
  sideLabel: string | null;
  /** Total side tokens held. */
  size: number;
  /** Tokens locked by resting sells. */
  hold: number;
  /** size − hold: what a new sell / close can use. */
  available: number;
  entryNotional: number | null;
  avgEntryPrice: number | null;
  markPrice: number | null;
  value: number | null;
  unrealizedPnl: number | null;
}

export interface OutcomeOpenOrder {
  coin: string;
  sideLabel: string | null;
  orderId: number;
  isBuy: boolean;
  price: number;
  /** Remaining size. */
  size: number;
  originalSize: number;
  filledSize: number;
  status: 'resting' | 'partially_filled';
  orderType: string | null;
  tif: string | null;
  timestamp: number;
}

export interface OutcomeFill {
  coin: string;
  sideLabel: string | null;
  orderId: number;
  isBuy: boolean;
  price: number;
  size: number;
  fee: number;
  feeToken: string | null;
  closedPnl: number;
  time: number;
  hash: string | null;
}

export interface OutcomeHistoricalOrder {
  coin: string;
  orderId: number;
  isBuy: boolean;
  price: number;
  originalSize: number;
  remainingSize: number;
  /** Hyperliquid processing status (open, filled, canceled, minTradeNtlRejected, …). */
  status: string;
  statusTimestamp: number;
}

export interface OutcomeAccountState {
  outcomeId: number;
  market: OutcomeMarket | null;
  positions: OutcomePosition[];
  openOrders: OutcomeOpenOrder[];
  fills: OutcomeFill[];
  historicalOrders: OutcomeHistoricalOrder[];
  source: 'GET /v1/hl/outcome_account (Hyperliquid spotClearinghouseState, frontendOpenOrders, userFills, historicalOrders)';
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Normalise `GET /v1/hl/outcome_account` (backend getOutcomeAccount,
 * hyperLiquidOutcomes.ts:503-538). Positions are spot balances keyed `+<assetId>`;
 * orders/fills carry the `#<assetId>` coin.
 */
export function normalizeOutcomeAccount(payload: unknown, market?: OutcomeMarket | null): OutcomeAccountState {
  const env = payload as { data?: Record<string, unknown> } & Record<string, unknown>;
  const d = ((env && typeof env === 'object' && 'data' in env ? env.data : env) ?? {}) as Record<string, unknown>;
  const coins = (d.coins as Array<{ coin: string; balanceCoin: string; sideIndex: number; sideName: string }> | undefined) ?? [];
  const sideByCoin = new Map<string, { sideIndex: number; label: string; price: number | null; coin: string }>();
  for (const c of coins) sideByCoin.set(c.coin, { sideIndex: c.sideIndex, label: c.sideName, price: null, coin: c.coin });
  for (const s of market?.sides ?? []) sideByCoin.set(s.coin, { sideIndex: s.sideIndex, label: s.label, price: s.price, coin: s.coin });
  const coinOfBalance = (b: string): string => (b.startsWith('+') ? `#${b.slice(1)}` : b);

  const positions: OutcomePosition[] = ((d.positions as Array<Record<string, unknown>>) ?? []).map((b) => {
    const balanceCoin = String(b.coin);
    const coin = coinOfBalance(balanceCoin);
    const side = sideByCoin.get(coin);
    const size = num(b.total);
    const hold = num(b.hold);
    const entryNotional = b.entryNtl !== undefined ? num(b.entryNtl) : null;
    const mark = side?.price ?? null;
    return {
      outcomeId: num(d.outcomeId),
      coin,
      balanceCoin,
      sideIndex: side?.sideIndex ?? null,
      sideLabel: side?.label ?? null,
      size,
      hold,
      available: Math.max(size - hold, 0),
      entryNotional,
      avgEntryPrice: entryNotional !== null && size > 0 ? entryNotional / size : null,
      markPrice: mark,
      value: mark !== null ? mark * size : null,
      unrealizedPnl: mark !== null && entryNotional !== null ? mark * size - entryNotional : null,
    };
  });

  const openOrders: OutcomeOpenOrder[] = ((d.openOrders as Array<Record<string, unknown>>) ?? []).map((o) => {
    const size = num(o.sz);
    const orig = o.origSz !== undefined ? num(o.origSz) : size;
    return {
      coin: String(o.coin),
      sideLabel: sideByCoin.get(String(o.coin))?.label ?? null,
      orderId: num(o.oid),
      isBuy: o.side === 'B',
      price: num(o.limitPx),
      size,
      originalSize: orig,
      filledSize: Math.max(orig - size, 0),
      status: orig > size ? 'partially_filled' : 'resting',
      orderType: (o.orderType as string) ?? null,
      tif: (o.tif as string) ?? null,
      timestamp: num(o.timestamp),
    };
  });

  const fills: OutcomeFill[] = ((d.fills as Array<Record<string, unknown>>) ?? []).map((f) => ({
    coin: String(f.coin),
    sideLabel: sideByCoin.get(String(f.coin))?.label ?? null,
    orderId: num(f.oid),
    isBuy: f.side === 'B',
    price: num(f.px),
    size: num(f.sz),
    fee: num(f.fee),
    feeToken: (f.feeToken as string) ?? null,
    closedPnl: num(f.closedPnl),
    time: num(f.time),
    hash: (f.hash as string) ?? null,
  }));

  const historicalOrders: OutcomeHistoricalOrder[] = ((d.historicalOrders as Array<Record<string, unknown>>) ?? []).map((h) => {
    const o = (h.order as Record<string, unknown>) ?? {};
    return {
      coin: String(o.coin),
      orderId: num(o.oid),
      isBuy: o.side === 'B',
      price: num(o.limitPx),
      originalSize: num(o.origSz),
      remainingSize: num(o.sz),
      status: String(h.status),
      statusTimestamp: num(h.statusTimestamp),
    };
  });

  return {
    outcomeId: num(d.outcomeId),
    market: market ?? null,
    positions,
    openOrders,
    fills,
    historicalOrders,
    source: 'GET /v1/hl/outcome_account (Hyperliquid spotClearinghouseState, frontendOpenOrders, userFills, historicalOrders)',
  };
}

export interface OutcomeOrderResult {
  isSuccess: boolean;
  /**
   * `resting` (on the book, cancel with orderId), `filled` (fully filled at submit),
   * `canceled` (cancel accepted), `rejected` (exchange/backend error), `unknown` (unrecognised reply).
   */
  status: 'resting' | 'filled' | 'canceled' | 'rejected' | 'unknown';
  orderId: number | null;
  filledSize: number | null;
  avgPrice: number | null;
  error: string | null;
  /** What the SDK sent, after validation (absent for pre-built computedData). */
  request?: Record<string, unknown>;
  warnings: string[];
  /** Backend reply as received. */
  raw: unknown;
  next: string;
}

/**
 * Normalise a create/cancel/close reply. The backend returns
 * `{ isSuccess, data: <Hyperliquid exchange response> }` (ServiceHyperLiquid.ts:1893-1900),
 * whose `response.data.statuses[0]` is `{resting:{oid}}`, `{filled:{totalSz,avgPx,oid}}`,
 * `{error}` or `"success"` (cancel).
 */
export function normalizeOutcomeOrderResult(
  raw: unknown,
  kind: 'create' | 'cancel' | 'close',
  extra: { request?: Record<string, unknown>; warnings?: string[] } = {},
): OutcomeOrderResult {
  const r = (raw ?? {}) as { isSuccess?: boolean; data?: unknown; error?: unknown };
  const statuses = (r.data as { response?: { data?: { statuses?: unknown[] } } } | undefined)?.response?.data?.statuses;
  const st = Array.isArray(statuses) ? statuses[0] : undefined;
  const base = { request: extra.request, warnings: extra.warnings ?? [], raw };
  if (r.isSuccess === false || (st && typeof st === 'object' && 'error' in (st as object))) {
    const error = String((st as { error?: unknown })?.error ?? r.error ?? 'rejected');
    return { ...base, isSuccess: false, status: 'rejected', orderId: null, filledSize: null, avgPrice: null, error, next: 'Nothing rests on the book. Fix the cause and submit again.' };
  }
  if (st && typeof st === 'object' && 'resting' in (st as object)) {
    const oid = num((st as { resting: { oid: unknown } }).resting.oid);
    return { ...base, isSuccess: true, status: 'resting', orderId: oid, filledSize: 0, avgPrice: null, error: null, next: `Order ${oid} is resting. Poll hl_outcome_account (openOrders / fills) to track fills; cancel with hl_cancel_outcome_order orderId=${oid}.` };
  }
  if (st && typeof st === 'object' && 'filled' in (st as object)) {
    const f = (st as { filled: { oid: unknown; totalSz: unknown; avgPx: unknown } }).filled;
    return { ...base, isSuccess: true, status: 'filled', orderId: num(f.oid), filledSize: num(f.totalSz), avgPrice: num(f.avgPx), error: null, next: kind === 'create' ? 'Filled. The side tokens are in the managed wallet\'s HL spot balance; check hl_outcome_account positions.' : 'Filled. Reconcile with hl_outcome_account.' };
  }
  if (kind === 'cancel' && (st === 'success' || r.isSuccess === true)) {
    return { ...base, isSuccess: true, status: 'canceled', orderId: null, filledSize: null, avgPrice: null, error: null, next: 'Cancel accepted. Confirm via hl_outcome_account (the order leaves openOrders; any partial fill stays in fills/positions).' };
  }
  return { ...base, isSuccess: r.isSuccess === true, status: 'unknown', orderId: null, filledSize: null, avgPrice: null, error: null, next: 'Unrecognised reply: check hl_outcome_account before acting again.' };
}
