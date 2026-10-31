/**
 * Wallet forensics — reverse-engineer skill-proven HyperLiquid wallets into
 * size-invariant, clonable patterns. READ-ONLY: reads the month PnL leaderboard,
 * per-wallet fills and clearinghouse state through the existing SDK reads, and
 * decomposes them into a {@link WinnerIntel} artifact. Nothing here trades,
 * settles, or moves funds.
 *
 * This is a faithful TypeScript port of the reference `winners.js` puller and
 * `decompose.py` analysis; thresholds and artifact field names match exactly.
 */
import { GdexApiClient } from '../client';
import { getHlTopTradersByPnl, getHlClearinghouseStateAll } from './hlCopyTrade';
import { getHlTradeHistory } from './perpTrade';
import {
  AggregateFeature,
  ReverseEngineerParams,
  SkillComponents,
  WinnerIntel,
  WinnerScorecard,
} from '../types';

const DEFAULT_MAX = 12;
const PULL_PACE_MS = 400;
const AV_MIN = 50_000;
const AV_MAX = 50_000_000;
const TURNOVER_MAX = 20;
const ALLTIME_SENTINEL = -500;

const MAX_FILLS_PER_HOUR = 60.0;
const MIN_MEDIAN_NOTIONAL = 1000.0;
const MAX_MAKER_FRACTION = 0.8;

const FLAT_EPS_FRAC = 0.02;
const MS_PER_HOUR = 3_600_000.0;

const MIN_PREVALENCE = 0.4;
const MIN_SUPPORT = 3;

/** A raw HL fill (numeric fields arrive as strings). */
interface Fill {
  coin?: string;
  px?: string | number;
  sz?: string | number;
  side?: string;
  time?: string | number;
  startPosition?: string | number;
  dir?: string;
  closedPnl?: string | number;
  crossed?: boolean;
}

/** A reconstructed flat->flat (or mini) round trip. */
interface Trade {
  coin: string;
  pnl: number;
  hold_ms: number | null;
  entry_dir: string;
  add_notionals: number[];
}

/** Per-wallet clonability signals over the fill window. */
interface ClonabilityStats {
  fills_per_hour: number;
  median_fill_notional: number;
  maker_fraction: number;
  window_hours: number;
}

/** A month-board leaderboard entry (curated watchlist entries carry a flag). */
interface BoardEntry {
  ethAddress: string;
  accountValue: string | null;
  windowPerformances: Array<[string, Record<string, unknown>]>;
  watchlist?: boolean;
}

/** A pulled per-wallet raw record. */
interface WalletRecord {
  address: string;
  fills: Fill[];
}

/** Coerce an SDK string/number field to float, tolerating null/blank. */
function num(value: unknown, fallback = 0.0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Median of a numeric list (0 when empty). */
function median(values: number[]): number {
  if (values.length === 0) return 0.0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Arithmetic mean (0 when empty). */
function mean(values: number[]): number {
  if (values.length === 0) return 0.0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

/** Round to `digits` decimals, JS-safe. */
function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Return the `{pnl,roi,vlm}` perf dict for one leaderboard window. */
function windowPerf(entry: BoardEntry, window: string): Record<string, unknown> {
  for (const pair of entry.windowPerformances || []) {
    if (Array.isArray(pair) && pair[0] === window) return (pair[1] as Record<string, unknown>) || {};
  }
  return {};
}

/** Absolute USD notional of a fill (|px·sz|). */
function fillNotional(fill: Fill): number {
  return Math.abs(num(fill.px) * num(fill.sz));
}

/** Compute the F3 MM/clonability signals over a wallet's fill window. */
export function clonabilityStats(fills: Fill[]): ClonabilityStats {
  if (fills.length === 0) {
    return { fills_per_hour: 0.0, median_fill_notional: 0.0, maker_fraction: 0.0, window_hours: 0.0 };
  }
  const times = fills.map((f) => num(f.time));
  const spanMs = Math.max(...times) - Math.min(...times);
  const windowHours = spanMs > 0 ? spanMs / MS_PER_HOUR : 0.0;
  const fillsPerHour = windowHours > 0 ? fills.length / windowHours : fills.length;
  const notionals = fills.map(fillNotional);
  const makerFraction = fills.filter((f) => f.crossed === false).length / fills.length;
  return {
    fills_per_hour: fillsPerHour,
    median_fill_notional: median(notionals),
    maker_fraction: makerFraction,
    window_hours: windowHours,
  };
}

/** Return True if the F3 filter marks this wallet as an uncopyable MM. */
export function isLiquidityProvider(stats: ClonabilityStats): boolean {
  return (
    stats.fills_per_hour > MAX_FILLS_PER_HOUR ||
    stats.median_fill_notional < MIN_MEDIAN_NOTIONAL ||
    stats.maker_fraction > MAX_MAKER_FRACTION
  );
}

/** Return fills sorted time-ascending (stable on ties). */
function sortedFills(fills: Fill[]): Fill[] {
  return fills
    .map((f, i) => ({ f, i }))
    .sort((a, b) => num(a.f.time) - num(b.f.time) || a.i - b.i)
    .map((x) => x.f);
}

/** Return True if the fill increases the position (same side as entry). */
function isAdd(fill: Fill, entrySide: string): boolean {
  return (fill.dir || '').startsWith('Open') && fill.side === entrySide;
}

/** Reconstruct flat->flat round trips for one coin. */
export function reconstructFlatToFlat(coinFills: Fill[]): Trade[] {
  const trades: Trade[] = [];
  let openTime: number | null = null;
  let entryDir = '';
  let entrySide = '';
  let pnlAcc = 0.0;
  let addSizes: number[] = [];
  let peakAbs = 0.0;
  let net: number | null = null;
  for (const fill of coinFills) {
    const start = num(fill.startPosition);
    const signed = num(fill.sz) * (fill.side === 'B' ? 1.0 : -1.0);
    net = net === null ? start + signed : net + signed;
    if (openTime === null && Math.abs(start) <= FLAT_EPS_FRAC * Math.max(Math.abs(signed), 1e-9)) {
      openTime = num(fill.time);
      entryDir = fill.dir || '';
      entrySide = fill.side || '';
      pnlAcc = 0.0;
      addSizes = [];
      peakAbs = Math.abs(net);
    }
    if (openTime === null) continue;
    peakAbs = Math.max(peakAbs, Math.abs(net));
    pnlAcc += num(fill.closedPnl);
    if (isAdd(fill, entrySide)) addSizes.push(Math.abs(fillNotional(fill)));
    if (Math.abs(net) <= FLAT_EPS_FRAC * Math.max(peakAbs, 1e-9)) {
      trades.push({
        coin: fill.coin ?? '?',
        pnl: pnlAcc,
        hold_ms: num(fill.time) - openTime,
        entry_dir: entryDir,
        add_notionals: addSizes,
      });
      openTime = null;
    }
  }
  return trades;
}

/** Fallback: treat each realized-PnL fill as a mini round trip. */
export function reconstructMiniTrades(coinFills: Fill[]): Trade[] {
  const trades: Trade[] = [];
  for (const fill of coinFills) {
    const pnl = num(fill.closedPnl);
    if (pnl !== 0.0) {
      trades.push({
        coin: fill.coin ?? '?',
        pnl,
        hold_ms: null,
        entry_dir: fill.dir || '',
        add_notionals: [],
      });
    }
  }
  return trades;
}

/** Reconstruct trades for a wallet, choosing flat->flat or the fallback. */
export function buildTrades(fills: Fill[]): { trades: Trade[]; method: 'flat_to_flat' | 'mini_trade' } {
  const byCoin = new Map<string, Fill[]>();
  for (const fill of sortedFills(fills)) {
    const key = fill.coin ?? '?';
    const bucket = byCoin.get(key);
    if (bucket) bucket.push(fill);
    else byCoin.set(key, [fill]);
  }
  const flatTrades: Trade[] = [];
  for (const coinFills of byCoin.values()) flatTrades.push(...reconstructFlatToFlat(coinFills));
  if (flatTrades.length > 0) return { trades: flatTrades, method: 'flat_to_flat' };
  const mini: Trade[] = [];
  for (const coinFills of byCoin.values()) mini.push(...reconstructMiniTrades(coinFills));
  return { trades: mini, method: 'mini_trade' };
}

/** Payoff ratio = mean win / |mean loss| (0 if undefined). */
function payoffRatio(wins: number[], losses: number[]): number {
  if (wins.length === 0 || losses.length === 0) return 0.0;
  const meanLoss = Math.abs(mean(losses));
  return meanLoss > 0 ? mean(wins) / meanLoss : 0.0;
}

/** Classify the wallet's edge shape (TREND/MEANREV/MIXED). */
function machineType(winRate: number, payoff: number): 'TREND' | 'MEANREV' | 'MIXED' {
  if (winRate < 0.45 && payoff > 2.0) return 'TREND';
  if (winRate > 0.6 && payoff < 1.0) return 'MEANREV';
  return 'MIXED';
}

/** Avg add-size while losing / while winning (>1.5 adds to losers). */
function martingaleRatio(trades: Trade[]): number {
  const losingAdds = trades.filter((t) => t.pnl < 0).flatMap((t) => t.add_notionals);
  const winningAdds = trades.filter((t) => t.pnl > 0).flatMap((t) => t.add_notionals);
  if (losingAdds.length === 0 || winningAdds.length === 0) return 0.0;
  const winMean = mean(winningAdds);
  return winMean > 0 ? mean(losingAdds) / winMean : 0.0;
}

/** Share of total winnings from the top-5 wins (>0.6 hints at luck). */
function top5WinShare(wins: number[]): number {
  const total = wins.reduce((acc, v) => acc + v, 0);
  if (total <= 0) return 0.0;
  const sorted = [...wins].sort((a, b) => b - a).slice(0, 5);
  return sorted.reduce((acc, v) => acc + v, 0) / total;
}

/** Notional-fraction weight per coin (proxied by |pnl| exposure). */
function coinWeights(trades: Trade[]): Record<string, number> {
  const raw = new Map<string, number>();
  for (const trade of trades) raw.set(trade.coin, (raw.get(trade.coin) ?? 0) + Math.abs(trade.pnl));
  let total = 0;
  for (const v of raw.values()) total += v;
  if (total <= 0) {
    const counts = new Map<string, number>();
    for (const t of trades) counts.set(t.coin, (counts.get(t.coin) ?? 0) + 1);
    const n = trades.length;
    if (n === 0) return {};
    const out: Record<string, number> = {};
    for (const [c, k] of counts) out[c] = k / n;
    return out;
  }
  const out: Record<string, number> = {};
  for (const [c, v] of raw) out[c] = v / total;
  return out;
}

/** Median hold time (hours) of winners or losers with known holds. */
function medianHoldHours(trades: Trade[], winning: boolean): number | null {
  const holds = trades
    .filter((t) => t.hold_ms !== null && t.pnl > 0 === winning)
    .map((t) => (t.hold_ms as number) / MS_PER_HOUR);
  return holds.length > 0 ? median(holds) : null;
}

/** Break the skill score into named 0..1 components. */
function skillComponents(
  winRate: number,
  payoff: number,
  top5: number,
  martingale: number,
  nTrades: number,
): SkillComponents {
  const edge = payoff > 0 ? (winRate * payoff) / (winRate * payoff + (1 - winRate)) : 0.0;
  const clamp = (v: number): number => Math.max(0.0, Math.min(1.0, v));
  return {
    edge: clamp(edge),
    payoff: clamp(payoff / 3.0),
    not_luck: clamp(1.0 - top5),
    not_martingale: clamp(1.0 - Math.max(0.0, martingale - 1.0)),
    sample: clamp(Math.log10(nTrades + 1) / 2.0),
  };
}

/** Weighted 0-100 skill score from its components. */
function skillScore(components: SkillComponents): number {
  const weights: Record<keyof SkillComponents, number> = {
    edge: 0.35,
    payoff: 0.2,
    not_luck: 0.2,
    not_martingale: 0.15,
    sample: 0.1,
  };
  let sum = 0;
  for (const key of Object.keys(weights) as Array<keyof SkillComponents>) {
    sum += components[key] * weights[key];
  }
  return round(100.0 * sum, 1);
}

/** Round an optional float to `digits` dp, preserving null. */
function roundOpt(value: number | null, digits: number): number | null {
  return value !== null ? round(value, digits) : null;
}

/** Return honesty caveats for a scorecard given its reconstruction method. */
function scorecardCaveats(method: string): string[] {
  if (method === 'mini_trade') {
    return [
      'Fill window is a truncated slice of continuous positions (never flat->flat); ' +
        'win_rate/payoff/hold are derived from per-fill realized-PnL signs, not true ' +
        'round trips, and can be badly distorted (e.g. a single scaled-out winner reads ' +
        'as many wins). Treat machine_type and hold fields as unavailable.',
    ];
  }
  return [];
}

/** Build the full per-wallet scorecard. */
export function scoreWallet(
  address: string,
  trades: Trade[],
  stats: ClonabilityStats,
  method: 'flat_to_flat' | 'mini_trade',
): WinnerScorecard {
  const pnls = trades.map((t) => t.pnl);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const n = pnls.length;
  const winRate = n ? wins.length / n : 0.0;
  const payoff = payoffRatio(wins, losses);
  const expectancy = pnls.length ? mean(pnls) : 0.0;
  const kelly = payoff > 0 ? winRate - (1 - winRate) / payoff : 0.0;
  const top5 = top5WinShare(wins);
  const martingale = martingaleRatio(trades);
  const components = skillComponents(winRate, payoff, top5, martingale, n);
  const weights: Record<string, number> = {};
  for (const [c, w] of Object.entries(coinWeights(trades))) weights[c] = round(w, 3);
  const roundedComponents = {} as SkillComponents;
  for (const key of Object.keys(components) as Array<keyof SkillComponents>) {
    roundedComponents[key] = round(components[key], 3);
  }
  return {
    address,
    n_trades: n,
    win_rate: round(winRate, 3),
    payoff: round(payoff, 3),
    expectancy: round(expectancy, 4),
    kelly_frac: round(kelly, 3),
    machine_type: method === 'mini_trade' ? 'UNKNOWN' : machineType(winRate, payoff),
    martingale_ratio: round(martingale, 3),
    top5_win_share: round(top5, 3),
    median_hold_win_h: roundOpt(medianHoldHours(trades, true), 2),
    median_hold_loss_h: roundOpt(medianHoldHours(trades, false), 2),
    coin_weights: weights,
    luck_flag: top5 > 0.6,
    window_hours: round(stats.window_hours, 1),
    method,
    skill_score: skillScore(components),
    skill_components: roundedComponents,
    caveats: scorecardCaveats(method),
  };
}

/** Map an entry `dir` string to long/short/null. */
function entryDirection(entryDir: string): 'long' | 'short' | null {
  const lowered = entryDir.toLowerCase();
  if (lowered.includes('long') && !lowered.includes('short')) return 'long';
  if (lowered.includes('short') && !lowered.includes('long')) return 'short';
  if (entryDir.includes('>')) return entryDir.trim().endsWith('Short') ? 'short' : 'long';
  return null;
}

/** Assemble one aggregate feature with a confidence tier. */
function makeFeature(
  fid: string,
  desc: string,
  prevalence: number,
  support: number,
  magnitude: Record<string, unknown>,
  caveats: string,
): AggregateFeature {
  let confidence: 'HIGH' | 'MED' | 'LOW';
  if (prevalence >= MIN_PREVALENCE && support >= MIN_SUPPORT) confidence = 'HIGH';
  else if (support >= 2) confidence = 'MED';
  else confidence = 'LOW';
  return { id: fid, description: desc, prevalence: round(prevalence, 3), support_wallets: support, magnitude, confidence, caveats };
}

/** Aggregate long/short entry bias across survivors. */
function directionFeature(perWalletTrades: Map<string, Trade[]>, nSurv: number): AggregateFeature | null {
  let longBiased = 0;
  const fractions: number[] = [];
  for (const trades of perWalletTrades.values()) {
    const dirs = trades.map((t) => entryDirection(t.entry_dir)).filter((d): d is 'long' | 'short' => d !== null);
    if (dirs.length === 0) continue;
    const longFrac = dirs.filter((d) => d === 'long').length / dirs.length;
    fractions.push(longFrac);
    if (longFrac > 0.55) longBiased += 1;
  }
  if (fractions.length === 0) return null;
  return makeFeature(
    'direction_bias',
    'Fraction of survivors that are net-long at entry (>55% long).',
    longBiased / nSurv,
    longBiased,
    { mean_long_fraction: round(mean(fractions), 3), long_biased_wallets: longBiased },
    'Directional bias in a bull month is not a persistent edge; walk-forward must confirm.',
  );
}

/** Coins traded by >=40% of survivors. */
function coinFeature(scorecards: WinnerScorecard[], nSurv: number): AggregateFeature | null {
  const counts = new Map<string, number>();
  for (const card of scorecards) {
    for (const coin of Object.keys(card.coin_weights)) counts.set(coin, (counts.get(coin) ?? 0) + 1);
  }
  const common = new Map<string, number>();
  for (const [c, k] of counts) {
    if (k / nSurv >= MIN_PREVALENCE && k >= MIN_SUPPORT) common.set(c, k);
  }
  if (common.size === 0) return null;
  let top = '';
  let topK = -1;
  for (const [c, k] of common) {
    if (k > topK) {
      topK = k;
      top = c;
    }
  }
  const sortedCoins = [...common.entries()].sort((a, b) => b[1] - a[1]);
  const coins: Record<string, number> = {};
  for (const [c, k] of sortedCoins) coins[c] = k;
  return makeFeature(
    'coin_concentration',
    'Coins that >=40% of surviving winners trade.',
    common.get(top)! / nSurv,
    common.get(top)!,
    { coins },
    'Popular coins reflect liquidity, not necessarily edge.',
  );
}

/** Return the 3-hour UTC block with the most entries (wrapping midnight). */
function peakBlock(pooled: Map<number, number>): number[] {
  let bestStart = 0;
  let best = -1;
  for (let start = 0; start < 24; start += 1) {
    let windowSum = 0;
    for (let k = 0; k < 3; k += 1) windowSum += pooled.get((start + k) % 24) ?? 0;
    if (windowSum > best) {
      best = windowSum;
      bestStart = start;
    }
  }
  return [0, 1, 2].map((k) => (bestStart + k) % 24);
}

/** UTC entry-hour concentration across survivors. */
function hourFeature(records: WalletRecord[], survivors: Set<string>, nSurv: number): AggregateFeature | null {
  const perWalletPeak = new Map<number, number>();
  const pooled = new Map<number, number>();
  for (const record of records) {
    if (!survivors.has(record.address)) continue;
    const hours = record.fills
      .filter((f) => String(f.dir ?? '').startsWith('Open'))
      .map((f) => Math.floor(num(f.time) / MS_PER_HOUR) % 24);
    if (hours.length === 0) continue;
    const local = new Map<number, number>();
    for (const h of hours) {
      local.set(h, (local.get(h) ?? 0) + 1);
      pooled.set(h, (pooled.get(h) ?? 0) + 1);
    }
    let peakHour = 0;
    let peakCount = -1;
    for (const [h, c] of local) {
      if (c > peakCount) {
        peakCount = c;
        peakHour = h;
      }
    }
    perWalletPeak.set(peakHour, (perWalletPeak.get(peakHour) ?? 0) + 1);
  }
  if (pooled.size === 0) return null;
  let total = 0;
  for (const v of pooled.values()) total += v;
  const block = peakBlock(pooled);
  const blockShare = block.reduce((acc, h) => acc + (pooled.get(h % 24) ?? 0), 0) / total;
  const support = block.reduce((acc, h) => acc + (perWalletPeak.get(h) ?? 0), 0);
  return makeFeature(
    'hour_of_day_concentration',
    'UTC entry-hour block (3h) where winners most often open.',
    support / nSurv,
    support,
    { peak_block_utc: block, block_share: round(blockShare, 3), uniform_share: round(3 / 24, 3) },
    "Entry timing may track a coin's liquidity session, not a tradable clock edge.",
  );
}

/** Do winners systematically hold winners longer than losers? */
function holdAsymmetryFeature(scorecards: WinnerScorecard[], nSurv: number): AggregateFeature | null {
  const ratios: number[] = [];
  let holdsLonger = 0;
  let comparable = 0;
  for (const card of scorecards) {
    const winH = card.median_hold_win_h;
    const lossH = card.median_hold_loss_h;
    if (winH === null || lossH === null || lossH <= 0) continue;
    comparable += 1;
    ratios.push(winH / lossH);
    if (winH > lossH) holdsLonger += 1;
  }
  if (comparable === 0) return null;
  return makeFeature(
    'hold_time_asymmetry',
    'Winners hold winning trades longer than losing trades (disposition-inverse).',
    holdsLonger / nSurv,
    holdsLonger,
    {
      wallets_hold_winners_longer: holdsLonger,
      comparable_wallets: comparable,
      median_hold_ratio_win_over_loss: round(median(ratios), 2),
    },
    'Only computable on flat->flat wallets; truncated (mini-trade) wallets lack holds.',
  );
}

/** Enforce the >=40%-of-survivors AND >=3-wallet reporting gate. */
function passesGate(feature: AggregateFeature | null): feature is AggregateFeature {
  return feature !== null && feature.prevalence >= MIN_PREVALENCE && feature.support_wallets >= MIN_SUPPORT;
}

/** Assemble every supported aggregate feature (only those passing the gate). */
export function aggregateFeatures(
  scorecards: WinnerScorecard[],
  perWalletTrades: Map<string, Trade[]>,
  records: WalletRecord[],
  survivors: Set<string>,
): AggregateFeature[] {
  const nSurv = survivors.size;
  const candidates = [
    directionFeature(perWalletTrades, nSurv),
    coinFeature(scorecards, nSurv),
    hourFeature(records, survivors, nSurv),
    holdAsymmetryFeature(scorecards, nSurv),
  ];
  return candidates.filter(passesGate);
}

/** Count machine types across scorecards, most-common first. */
function machineMix(scorecards: WinnerScorecard[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const card of scorecards) counts.set(card.machine_type, (counts.get(card.machine_type) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/** Turn the strongest features into short numbered phrases (up to four). */
function topPatterns(byId: Map<string, AggregateFeature>): string[] {
  const out: string[] = [];
  const direction = byId.get('direction_bias');
  if (direction) {
    out.push(`lean ${Math.trunc((direction.magnitude.mean_long_fraction as number) * 100)}% long at entry.`);
  }
  if (byId.get('hold_time_asymmetry')) out.push('cut losers fast, let winners run.');
  const coins = byId.get('coin_concentration');
  if (coins) {
    const list = Object.keys(coins.magnitude.coins as Record<string, number>).slice(0, 3);
    out.push(`concentrate in ${list.join('/')}.`);
  }
  const hour = byId.get('hour_of_day_concentration');
  if (hour) {
    const blk = hour.magnitude.peak_block_utc as number[];
    const start = String(blk[0]).padStart(2, '0');
    const end = String((blk[blk.length - 1] + 1) % 24).padStart(2, '0');
    out.push(`cluster entries around ${start}:00-${end}:00 UTC.`);
  }
  return out.slice(0, 4);
}

/** One reverse-engineering directive contrasting winners with the book. */
function contrastLine(scorecards: WinnerScorecard[], byId: Map<string, AggregateFeature>): string {
  const reliable = scorecards.filter((c) => c.method === 'flat_to_flat');
  const payoffs = reliable.filter((c) => c.payoff > 0).map((c) => c.payoff);
  if (byId.get('hold_time_asymmetry')) {
    return 'asymmetric exits, not entry accuracy — encode a let-winners-run exit rule.';
  }
  if (payoffs.length > 0) {
    return `payoff ~${round(median(payoffs), 2)} vs your 0.83 — widen your winners' R-multiple.`;
  }
  if (byId.size === 0) return 'nothing trustworthy yet — no reverse-engineerable edge in this pull.';
  return 'coin focus and entry timing above; treat as a lead, not a proven edge.';
}

/** Render the compact (<1500 char) Scientist-facing brief. */
export function renderDeskText(scorecards: WinnerScorecard[], features: AggregateFeature[]): string {
  const n = scorecards.length;
  const byId = new Map<string, AggregateFeature>(features.map((f) => [f.id, f]));
  const lines = [`REVERSE-ENGINEERING DESK: ${n} skill-proven clonable wallet(s).`];
  if (n < MIN_SUPPORT) {
    lines.push(
      'THIN FEED this cycle: too few clonable survivors to form trustworthy ' +
        'aggregate patterns (need >=3) — the board was dominated by uncopyable ' +
        'market-makers. Do NOT over-fit to the wallet(s) below; wait for a richer pull.',
    );
  }
  const top = topPatterns(byId);
  if (top.length > 0) lines.push('What they do: ' + top.join(' '));
  lines.push('Machine mix: ' + machineMix(scorecards).map(([k, v]) => `${k} ${v}`).join(', ') + '.');
  const hold = byId.get('hold_time_asymmetry');
  if (hold) {
    const m = hold.magnitude;
    lines.push(
      `Exit fingerprint: winners held ~${m.median_hold_ratio_win_over_loss as number}x longer than losers` +
        ` (${m.wallets_hold_winners_longer as number}/${m.comparable_wallets as number} wallets).`,
    );
  }
  const coins = byId.get('coin_concentration');
  if (coins) {
    const watch = Object.keys(coins.magnitude.coins as Record<string, number>).slice(0, 5).join(', ');
    lines.push(`Watchlist coins: ${watch}.`);
  }
  lines.push('Contrast with your book (win 0.236, payoff 0.83): they win by ' + contrastLine(scorecards, byId));
  return lines.join(' ').slice(0, 1499);
}

/** Apply the cheap board pre-filters and return ordered survivor entries. */
export function preFilter(month: BoardEntry[]): { survivors: BoardEntry[]; counts: Record<string, number> } {
  const counts: Record<string, number> = {
    board_n: month.length,
    dropped_sentinel: 0,
    dropped_turnover: 0,
    dropped_av: 0,
  };
  const survivors: BoardEntry[] = [];
  for (const entry of month) {
    if (num(windowPerf(entry, 'allTime').pnl) === ALLTIME_SENTINEL) {
      counts.dropped_sentinel += 1;
      continue;
    }
    const accountValue = num(entry.accountValue);
    if (!(accountValue >= AV_MIN && accountValue <= AV_MAX)) {
      counts.dropped_av += 1;
      continue;
    }
    const vlm = num(windowPerf(entry, 'month').vlm);
    if (vlm > 0 && vlm / accountValue > TURNOVER_MAX) {
      counts.dropped_turnover += 1;
      continue;
    }
    survivors.push(entry);
  }
  counts.survivors_after_cheap = survivors.length;
  return { survivors, counts };
}

/** Pause between per-wallet reads so HL's /info endpoint does not rate-limit (429) the burst. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Normalize a candidate watchlist address (lowercased) or null. */
function normalizeWatchAddr(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^0x[0-9a-fA-F]{40}$/.test(value) ? value.toLowerCase() : null;
}

/** Build the ordered, deduped pull universe: watchlist first, then survivors. */
function buildUniverse(survivors: BoardEntry[], watchlist: string[], counts: Record<string, number>): BoardEntry[] {
  const cleaned = watchlist.map(normalizeWatchAddr).filter((a): a is string => a !== null);
  counts.watchlist_n = cleaned.length;
  const seen = new Set<string>();
  const universe: BoardEntry[] = [];
  for (const addr of cleaned) {
    if (seen.has(addr)) continue;
    seen.add(addr);
    universe.push({ ethAddress: addr, accountValue: null, windowPerformances: [], watchlist: true });
  }
  for (const entry of survivors) {
    const addr = String(entry.ethAddress || '').toLowerCase();
    if (seen.has(addr)) continue;
    seen.add(addr);
    universe.push(entry);
  }
  return universe;
}

/** Extract the month board list from the top-traders-by-pnl response. */
function extractMonthBoard(board: unknown): BoardEntry[] {
  if (!board || typeof board !== 'object') return [];
  const traders = (board as { topTraders?: unknown }).topTraders;
  if (!traders || typeof traders !== 'object' || Array.isArray(traders)) return [];
  const month = (traders as { month?: unknown }).month;
  return Array.isArray(month) ? (month as BoardEntry[]) : [];
}

/** Coerce a trade-history response into a fills array. */
function extractFills(history: unknown): Fill[] {
  if (Array.isArray(history)) return history as Fill[];
  if (history && typeof history === 'object') {
    const obj = history as { fills?: unknown; data?: unknown };
    if (Array.isArray(obj.fills)) return obj.fills as Fill[];
    if (Array.isArray(obj.data)) return obj.data as Fill[];
  }
  return [];
}

/**
 * Pull fills for one wallet, isolating failures.
 *
 * One bad wallet must never abort the run, so the SDK reads are wrapped and any
 * error yields an empty fill list rather than throwing. The clearinghouse read
 * is best-effort (its margin summary is not required by the analysis).
 *
 * @param client - authenticated read client.
 * @param entry - the leaderboard entry for this wallet.
 * @returns the combined raw record.
 */
async function pullWallet(client: GdexApiClient, entry: BoardEntry): Promise<WalletRecord> {
  const address = entry.ethAddress;
  let fills: Fill[] = [];
  try {
    fills = extractFills(await getHlTradeHistory(address));
  } catch {
    fills = [];
  }
  try {
    await getHlClearinghouseStateAll(client, address);
  } catch {
    // Best-effort: margin summary is not required by the decomposition.
  }
  return { address, fills };
}

/**
 * Reverse-engineer skill-proven HyperLiquid wallets into forensic patterns.
 *
 * Pulls the month PnL leaderboard (plus any curated watchlist), reads per-wallet
 * fills, filters uncopyable market-makers, reconstructs round trips, scores each
 * survivor, and reports prevalence-gated aggregate edges as a {@link WinnerIntel}
 * artifact. READ-ONLY — never trades, settles, or moves funds.
 *
 * @param client - authenticated GDEX API client (shared-key login is enough).
 * @param params - optional `watchlist` of wallet addresses and `max` pull cap.
 * @returns the winner-intel artifact.
 */
export async function reverseEngineerWinners(
  client: GdexApiClient,
  params: ReverseEngineerParams = {},
): Promise<WinnerIntel> {
  const max = Math.max(1, Math.trunc(params.max ?? DEFAULT_MAX));
  let board: unknown;
  try {
    board = await getHlTopTradersByPnl(client);
  } catch {
    board = null;
  }
  const month = extractMonthBoard(board);
  const { survivors, counts } = preFilter(month);
  const universe = buildUniverse(survivors, params.watchlist ?? [], counts);
  const picked = universe.slice(0, max);
  counts.pulled_n = picked.length;

  const records: WalletRecord[] = [];
  let first = true;
  for (const entry of picked) {
    if (!first) await sleep(PULL_PACE_MS);
    first = false;
    records.push(await pullWallet(client, entry));
  }

  return decompose(records, counts);
}

/** Run the decomposition pipeline over pulled records into a WinnerIntel. */
export function decompose(records: WalletRecord[], counts: Record<string, number>): WinnerIntel {
  const boardN = counts.board_n ?? records.length;
  let droppedMm = 0;
  const scorecards: WinnerScorecard[] = [];
  const perWalletTrades = new Map<string, Trade[]>();
  const survivors = new Set<string>();
  for (const record of records) {
    const fills = record.fills ?? [];
    const stats = clonabilityStats(fills);
    if (fills.length === 0 || isLiquidityProvider(stats)) {
      droppedMm += 1;
      continue;
    }
    const { trades, method } = buildTrades(fills);
    if (trades.length === 0) {
      droppedMm += 1;
      continue;
    }
    survivors.add(record.address);
    perWalletTrades.set(record.address, trades);
    scorecards.push(scoreWallet(record.address, trades, stats, method));
  }
  scorecards.sort((a, b) => b.skill_score - a.skill_score);
  const features = aggregateFeatures(scorecards, perWalletTrades, records, survivors);
  return {
    generated_at: new Date().toISOString(),
    universe: {
      board_n: boardN,
      cheap_survivors_n: counts.survivors_after_cheap ?? records.length,
      pulled_n: records.length,
      survivors_n: scorecards.length,
      filtered_counts: { ...counts, dropped_mm_or_empty: droppedMm },
    },
    scorecards,
    aggregate_features: features,
    desk_text: renderDeskText(scorecards, features),
  };
}
