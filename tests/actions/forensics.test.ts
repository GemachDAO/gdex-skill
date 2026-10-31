/**
 * Tests for the wallet-forensics decomposition pipeline.
 *
 * These exercise the PURE helpers (`decompose`, `buildTrades`, `scoreWallet`,
 * `clonabilityStats`, `aggregateFeatures`) with synthetic fills — no network,
 * no SDK. They assert the ported decompose.py behavior and thresholds:
 *   - a clean 2-win/2-loss wallet yields win_rate 0.5, payoff ~2, MIXED;
 *   - the MM/clonability filter drops a maker-heavy wallet;
 *   - aggregate features fire at HIGH with >=3 sharing wallets and stay EMPTY
 *     (THIN-FEED path) with <3 survivors.
 */
import {
  buildTrades,
  clonabilityStats,
  isLiquidityProvider,
  scoreWallet,
  decompose,
} from '../../src/actions/forensics';

interface SynthFill {
  coin: string;
  px: string;
  sz: string;
  side: string;
  time: number;
  startPosition: string;
  dir: string;
  closedPnl: string;
  crossed: boolean;
}

const HOUR = 3_600_000;

/** One flat->flat round trip: open at t, close at t+dt with a given pnl. */
function roundTrip(coin: string, tOpen: number, holdH: number, pnl: number, long = true): SynthFill[] {
  const openSide = long ? 'B' : 'A';
  const closeSide = long ? 'A' : 'B';
  const openDir = long ? 'Open Long' : 'Open Short';
  const closeDir = long ? 'Close Long' : 'Close Short';
  return [
    { coin, px: '2000', sz: '1', side: openSide, time: tOpen, startPosition: '0', dir: openDir, closedPnl: '0', crossed: true },
    {
      coin,
      px: '2000',
      sz: '1',
      side: closeSide,
      time: tOpen + holdH * HOUR,
      startPosition: long ? '1' : '-1',
      dir: closeDir,
      closedPnl: String(pnl),
      crossed: true,
    },
  ];
}

/** A directional wallet with two 4-h-hold wins and two 2-h-hold losses. */
function twoWinTwoLossFills(coin = 'BTC', base = 0): SynthFill[] {
  return [
    ...roundTrip(coin, base + 0 * HOUR, 4, 200),
    ...roundTrip(coin, base + 10 * HOUR, 4, 200),
    ...roundTrip(coin, base + 20 * HOUR, 2, -100),
    ...roundTrip(coin, base + 30 * HOUR, 2, -100),
  ];
}

describe('forensics: round-trip reconstruction + scorecard', () => {
  it('scores a clean 2-win/2-loss wallet as win_rate 0.5, payoff ~2, MIXED', () => {
    const fills = twoWinTwoLossFills();
    const { trades, method } = buildTrades(fills);
    expect(method).toBe('flat_to_flat');
    expect(trades).toHaveLength(4);

    const stats = clonabilityStats(fills);
    const card = scoreWallet('0xwinner', trades, stats, method);

    expect(card.n_trades).toBe(4);
    expect(card.win_rate).toBe(0.5);
    expect(card.payoff).toBeCloseTo(2.0, 5);
    expect(card.machine_type).toBe('MIXED');
    // Winners held 4h, losers 2h.
    expect(card.median_hold_win_h).toBe(4);
    expect(card.median_hold_loss_h).toBe(2);
    expect(card.caveats).toEqual([]);
  });

  it('falls back to mini_trade (UNKNOWN) when never flat->flat', () => {
    // A single reducing fill on a position that opened before the window.
    const fills: SynthFill[] = [
      { coin: 'ETH', px: '50', sz: '2', side: 'A', time: 0, startPosition: '5', dir: 'Close Long', closedPnl: '80', crossed: true },
    ];
    const { trades, method } = buildTrades(fills);
    expect(method).toBe('mini_trade');
    const card = scoreWallet('0xtrunc', trades, clonabilityStats(fills), method);
    expect(card.machine_type).toBe('UNKNOWN');
    expect(card.caveats.length).toBe(1);
  });
});

describe('forensics: MM/clonability filter', () => {
  it('drops a maker-heavy wallet', () => {
    // 10 fills, all resting (crossed:false) -> maker_fraction 1.0 > 0.8.
    const makerFills: SynthFill[] = Array.from({ length: 10 }, (_, i) => ({
      coin: 'BTC',
      px: '100',
      sz: '5',
      side: i % 2 === 0 ? 'B' : 'A',
      time: i * HOUR,
      startPosition: '0',
      dir: 'Open Long',
      closedPnl: '0',
      crossed: false,
    }));
    const stats = clonabilityStats(makerFills);
    expect(stats.maker_fraction).toBe(1.0);
    expect(isLiquidityProvider(stats)).toBe(true);
  });

  it('drops a high-frequency wallet (>60 fills/hour)', () => {
    const hftFills: SynthFill[] = Array.from({ length: 200 }, (_, i) => ({
      coin: 'BTC',
      px: '100',
      sz: '20',
      side: 'B',
      time: i * 1000,
      startPosition: '0',
      dir: 'Open Long',
      closedPnl: '0',
      crossed: true,
    }));
    const stats = clonabilityStats(hftFills);
    expect(stats.fills_per_hour).toBeGreaterThan(60);
    expect(isLiquidityProvider(stats)).toBe(true);
  });

  it('keeps a low-frequency directional taker', () => {
    const stats = clonabilityStats(twoWinTwoLossFills());
    expect(isLiquidityProvider(stats)).toBe(false);
  });
});

describe('forensics: aggregate features + THIN-FEED gate', () => {
  const counts = { board_n: 50, survivors_after_cheap: 20 };

  it('fires coin_concentration at HIGH when >=3 wallets share a coin', () => {
    const records = [0, 1, 2, 3].map((i) => ({
      address: `0xw${i}`,
      fills: twoWinTwoLossFills('BTC', i * 100 * HOUR),
    }));
    const intel = decompose(records, counts);
    expect(intel.universe.survivors_n).toBe(4);

    const coin = intel.aggregate_features.find((f) => f.id === 'coin_concentration');
    expect(coin).toBeDefined();
    expect(coin!.confidence).toBe('HIGH');
    expect(coin!.support_wallets).toBeGreaterThanOrEqual(3);
    expect(intel.desk_text).toContain('REVERSE-ENGINEERING DESK: 4');
    expect(intel.desk_text).not.toContain('THIN FEED');
  });

  it('stays EMPTY and emits the THIN-FEED banner with <3 survivors', () => {
    const records = [0, 1].map((i) => ({
      address: `0xw${i}`,
      fills: twoWinTwoLossFills('BTC', i * 100 * HOUR),
    }));
    const intel = decompose(records, counts);
    expect(intel.universe.survivors_n).toBe(2);
    expect(intel.aggregate_features).toEqual([]);
    expect(intel.desk_text).toContain('THIN FEED');
  });

  it('counts MM/empty drops in filtered_counts', () => {
    const records = [
      { address: '0xgood', fills: twoWinTwoLossFills('BTC', 0) },
      { address: '0xempty', fills: [] as SynthFill[] },
    ];
    const intel = decompose(records, counts);
    expect(intel.universe.survivors_n).toBe(1);
    expect(intel.universe.filtered_counts.dropped_mm_or_empty).toBe(1);
    expect(intel.universe.board_n).toBe(50);
  });
});
