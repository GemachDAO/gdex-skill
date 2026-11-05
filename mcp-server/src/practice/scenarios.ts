/**
 * Practice scenarios packaged with the skill. Every tape is a curated SYNTHETIC fixture:
 * it is not a historical price path and never contains anyone's fills. A challenge made
 * from a real close only picks the matching family (e.g. short, target vs stop).
 *
 * Tapes are frozen literals (prices to 0.1). The long fixture is the short one reflected
 * around its entry and rescaled, computed exactly at load so both share one geometry.
 */
import * as D from './decimal.js';

export const SCENARIO_SCHEMA = 'gdex.practice.scenario/1';
export const RULES_VERSION = 'practice-rules/1';
export const COST_MODEL_VERSION = 'hl-taker-cost/1';

export interface Bar { o: string; h: string; l: string; c: string }

export interface Scenario {
  schema: typeof SCENARIO_SCHEMA;
  id: string;
  family: 'short-target-vs-stop' | 'long-target-vs-stop';
  title: string;
  instrument: { label: string; venueModel: 'hyperliquid-perp'; barInterval: '1h' };
  source: { kind: 'synthetic_fixture'; label: string };
  side: 'long' | 'short';
  account: { equityUsd: string; leverage: number };
  rules: {
    version: typeof RULES_VERSION;
    riskLimitPct: string;
    stopPct: { min: string; max: string };
    targetPct: { min: string; max: string };
  };
  costModel: {
    version: typeof COST_MODEL_VERSION;
    feeBpsPerSide: string;
    slippageBpsPerSide: string;
    fundingIncluded: false;
    note: string;
  };
  /** The fixed plan every challenger is compared against. */
  baseline: { targetPct: string; stopPct: string };
  /** Visible before the decision. */
  setup: Bar[];
  /** Hidden until a decision is submitted. tape[0].o is the entry price. */
  tape: Bar[];
}

const b = (o: string, h: string, l: string, c: string): Bar => ({ o, h, l, c });

// Short fade of a rally. Entry 2422.9. Tape cases (relative to entry):
//   t1/t2 squeeze to +0.96% / +1.22% (tight stops die), t7 one wide bar +1.94% / −2.93%
//   (same-bar ambiguity for stop ≤1.9% & target ≤2.9%), t9 low −3.50% (baseline target),
//   t11 gaps open to +2.56% (gap through stops between ~1.95% and 2.56%), then drifts
//   between +1.9% and +3.6% to the end (wide plans time out).
const ETH_SETUP: Bar[] = [
  b('2388.0', '2394.1', '2383.2', '2391.5'), b('2391.5', '2398.7', '2386.0', '2396.2'),
  b('2396.2', '2401.9', '2390.4', '2393.8'), b('2393.8', '2404.6', '2392.1', '2402.7'),
  b('2402.7', '2409.3', '2398.5', '2406.1'), b('2406.1', '2408.8', '2399.0', '2401.4'),
  b('2401.4', '2411.2', '2400.3', '2409.9'), b('2409.9', '2416.5', '2405.7', '2414.0'),
  b('2414.0', '2419.8', '2410.2', '2412.6'), b('2412.6', '2421.3', '2409.4', '2418.7'),
  b('2418.7', '2426.0', '2415.1', '2420.2'), b('2420.2', '2425.4', '2416.8', '2422.9'),
];
const ETH_TAPE: Bar[] = [
  b('2422.9', '2431.0', '2415.0', '2428.0'), //  t0 entry bar
  b('2428.0', '2446.0', '2424.0', '2441.0'), //  t1 +0.96%
  b('2441.0', '2452.5', '2433.0', '2436.0'), //  t2 +1.22%
  b('2436.0', '2440.0', '2410.0', '2413.0'), //  t3
  b('2413.0', '2418.0', '2395.0', '2399.0'), //  t4
  b('2399.0', '2404.0', '2380.0', '2384.0'), //  t5 −1.77%
  b('2384.0', '2390.0', '2371.0', '2376.0'), //  t6 −2.14%
  b('2376.0', '2470.0', '2352.0', '2362.0'), //  t7 wide: +1.94% / −2.93%
  b('2362.0', '2371.0', '2355.0', '2360.0'), //  t8
  b('2360.0', '2362.0', '2338.0', '2344.0'), //  t9 −3.50%
  b('2344.0', '2350.0', '2330.0', '2347.0'), // t10 −3.83%
  b('2485.0', '2492.0', '2478.0', '2488.0'), // t11 gap up to +2.56%
  b('2488.0', '2496.0', '2481.0', '2490.0'),
  b('2490.0', '2503.0', '2484.0', '2497.0'),
  b('2497.0', '2510.0', '2489.0', '2493.0'), // t14 +3.59%
  b('2493.0', '2499.0', '2480.0', '2484.0'),
  b('2484.0', '2491.0', '2475.0', '2479.0'),
  b('2479.0', '2486.0', '2470.0', '2481.0'),
  b('2481.0', '2492.0', '2477.0', '2489.0'),
  b('2489.0', '2495.0', '2483.0', '2486.0'),
  b('2486.0', '2493.0', '2479.0', '2482.0'),
  b('2482.0', '2490.0', '2476.0', '2487.0'),
  b('2487.0', '2494.0', '2481.0', '2485.0'),
  b('2485.0', '2491.0', '2478.0', '2483.0'), // t23 last close
];

/** Reflect around the entry and rescale: p' = E' · (2 − p/E), rounded to 0.1. */
function mirror(bars: Bar[], entry: string, newEntry: string): Bar[] {
  const E = D.dec(entry); const E2 = D.dec(newEntry);
  const m = (p: string) => D.fmt(D.mul(E2, D.sub(D.dec(2), D.div(D.dec(p), E))), 1);
  return bars.map((x) => ({ o: m(x.o), h: m(x.l), l: m(x.h), c: m(x.c) }));
}

const COMMON = {
  schema: SCENARIO_SCHEMA,
  source: { kind: 'synthetic_fixture' as const, label: 'Practice fixture: curated synthetic tape, not a historical price path' },
  account: { equityUsd: '1000', leverage: 3 },
  rules: { version: RULES_VERSION, riskLimitPct: '8', stopPct: { min: '0.3', max: '10' }, targetPct: { min: '0.3', max: '20' } },
  costModel: {
    version: COST_MODEL_VERSION, feeBpsPerSide: '9.5', slippageBpsPerSide: '2', fundingIncluded: false as const,
    note: 'Fee assumption: Hyperliquid base taker 4.5 bps + GDEX builder fee 5 bps per side on notional. Slippage 2 bps against you on every fill. Funding is not modeled.',
  },
  baseline: { targetPct: '3.0', stopPct: '2.0' },
};

export const SCENARIOS: readonly Scenario[] = Object.freeze([
  {
    ...COMMON, id: 'eth-short-target-vs-stop-01', family: 'short-target-vs-stop', side: 'short',
    title: 'ETH short after a slow rally: pick a target and a stop',
    instrument: { label: 'ETH-PERP (practice)', venueModel: 'hyperliquid-perp', barInterval: '1h' },
    setup: ETH_SETUP, tape: ETH_TAPE,
  },
  {
    ...COMMON, id: 'btc-long-target-vs-stop-01', family: 'long-target-vs-stop', side: 'long',
    title: 'BTC long after a slow pullback: pick a target and a stop',
    instrument: { label: 'BTC-PERP (practice)', venueModel: 'hyperliquid-perp', barInterval: '1h' },
    setup: mirror(ETH_SETUP, '2422.9', '76490.0'), tape: mirror(ETH_TAPE, '2422.9', '76490.0'),
  },
] as Scenario[]);

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

export function scenarioForFamily(family: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.family === family);
}
