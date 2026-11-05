/**
 * Deterministic practice runner. Pure: no network, no clock, no randomness, no access to
 * any trading tool. Identical scenario + decision + rules version → identical result.
 *
 * Rules (practice-rules/1, cost model hl-taker-cost/1), documented in
 * skills/gdex-trade-replay/SCORING.md:
 *   - Reference price E = tape[0].o. Target and stop prices are set from E.
 *   - Entry fills at E with slippage against the trader. Size = equity × leverage / entry fill.
 *   - Each bar, in order: (1) from the second bar on, an open beyond the stop or target exits
 *     at the open (gap); (2) if the bar's range touches both stop and target, the order is
 *     unknowable from bars: the STOP is taken first and the result is flagged ambiguous;
 *     (3) otherwise whichever level was touched exits at that level.
 *   - Every exit fills with slippage against the trader. No exit by the last bar = time exit
 *     at the last close.
 *   - Fees: feeBpsPerSide on entry and exit notional. Funding is not modeled.
 *   - Drawdown: worst adverse price while open, as loss on equity incl. entry fee. On the exit
 *     bar a stop caps it at the stop level; otherwise the whole exit bar counts (conservative).
 *   - Breaches: planned loss at the stop above the risk limit, and realized loss above it.
 *   - Plans are compared side by side; nothing is ranked by P&L alone.
 */
import * as D from './decimal.js';
import { RULES_VERSION, type Bar, type Scenario } from './scenarios.js';

export interface Decision { targetPct: string; stopPct: string }

export type ExitReason = 'target' | 'stop' | 'gap_target' | 'gap_stop' | 'stop_ambiguous_same_bar' | 'time_exit';

export interface PlanResult {
  plan: Decision;
  exit: { reason: ExitReason; bar: number; price: string; fillPrice: string };
  ambiguous: boolean;
  entryFillPrice: string;
  targetPrice: string;
  stopPrice: string;
  grossPnlUsd: string;
  feesUsd: string;
  netPnlUsd: string;
  netPct: string;
  maxDrawdownUsd: string;
  maxDrawdownPct: string;
  plannedMaxLossUsd: string;
  breaches: string[];
}

const PCT_RE = /^\d{1,2}(\.\d{1,2})?$/;

export class DecisionError extends Error {
  constructor(message: string, readonly field: string) { super(message); this.name = 'DecisionError'; }
}

/** Validate a decision against the scenario's bounds before anything is scored. */
export function validateDecision(s: Scenario, d: unknown): Decision {
  if (!d || typeof d !== 'object') throw new DecisionError('Decision must be { targetPct, stopPct }', 'decision');
  const keys = Object.keys(d as object).sort().join(',');
  if (keys !== 'stopPct,targetPct') throw new DecisionError('Decision takes exactly targetPct and stopPct', 'decision');
  const out: Record<string, string> = {};
  for (const f of ['targetPct', 'stopPct'] as const) {
    const v = (d as Record<string, unknown>)[f];
    const str = typeof v === 'number' ? String(v) : v;
    if (typeof str !== 'string' || !PCT_RE.test(str)) throw new DecisionError(`${f} must be a percent like "2.5" (max 2 decimals)`, f);
    const bound = s.rules[f];
    const x = D.dec(str);
    if (x < D.dec(bound.min) || x > D.dec(bound.max)) throw new DecisionError(`${f} must be between ${bound.min}% and ${bound.max}%`, f);
    out[f] = str;
  }
  return { targetPct: out.targetPct, stopPct: out.stopPct };
}

const HUNDRED = D.dec(100);
const pct = (s: string) => D.div(D.dec(s), HUNDRED);

export function scorePlan(s: Scenario, plan: Decision): PlanResult {
  const short = s.side === 'short';
  const E = D.dec(s.tape[0].o);
  const slip = D.bpsOf(s.costModel.slippageBpsPerSide);
  const fee = D.bpsOf(s.costModel.feeBpsPerSide);
  const equity = D.dec(s.account.equityUsd);
  const notional = D.mul(equity, D.dec(s.account.leverage));
  const one = D.dec(1);
  // Adverse fill: a short sells lower/buys higher, a long buys higher/sells lower.
  const entryFill = D.mul(E, short ? D.sub(one, slip) : D.add(one, slip));
  const exitFillOf = (px: D.Dec) => D.mul(px, short ? D.add(one, slip) : D.sub(one, slip));
  const size = D.div(notional, entryFill);
  const targetPx = D.mul(E, short ? D.sub(one, pct(plan.targetPct)) : D.add(one, pct(plan.targetPct)));
  const stopPx = D.mul(E, short ? D.add(one, pct(plan.stopPct)) : D.sub(one, pct(plan.stopPct)));
  const pnlAt = (fill: D.Dec) => D.mul(size, short ? D.sub(entryFill, fill) : D.sub(fill, entryFill));
  const beyondStop = (p: D.Dec) => (short ? p >= stopPx : p <= stopPx);
  const beyondTarget = (p: D.Dec) => (short ? p <= targetPx : p >= targetPx);
  const adverse = (bar: Bar) => D.dec(short ? bar.h : bar.l);
  const favorable = (bar: Bar) => D.dec(short ? bar.l : bar.h);
  const worse = (a: D.Dec, c: D.Dec) => (short ? D.max(a, c) : D.min(a, c));

  let worst = E;
  let exit: { reason: ExitReason; bar: number; price: D.Dec } | null = null;
  for (let i = 0; i < s.tape.length && !exit; i++) {
    const bar = s.tape[i];
    const o = D.dec(bar.o);
    if (i > 0 && beyondStop(o)) { exit = { reason: 'gap_stop', bar: i, price: o }; worst = worse(worst, o); break; }
    if (i > 0 && beyondTarget(o)) { exit = { reason: 'gap_target', bar: i, price: o }; break; }
    const hitStop = beyondStop(adverse(bar));
    const hitTarget = beyondTarget(favorable(bar));
    if (hitStop) {
      exit = { reason: hitTarget ? 'stop_ambiguous_same_bar' : 'stop', bar: i, price: stopPx };
      worst = worse(worst, stopPx);
    } else {
      worst = worse(worst, adverse(bar));
      if (hitTarget) exit = { reason: 'target', bar: i, price: targetPx };
    }
  }
  if (!exit) exit = { reason: 'time_exit', bar: s.tape.length - 1, price: D.dec(s.tape[s.tape.length - 1].c) };

  const exitFill = exitFillOf(exit.price);
  const gross = pnlAt(exitFill);
  const entryFee = D.mul(fee, D.mul(size, entryFill));
  const fees = D.add(entryFee, D.mul(fee, D.mul(size, exitFill)));
  const net = D.sub(gross, fees);
  const ddUsd = D.max(D.ZERO, D.add(D.neg(pnlAt(worst)), entryFee));
  const stopFill = exitFillOf(stopPx);
  const plannedLoss = D.add(D.neg(pnlAt(stopFill)), D.add(entryFee, D.mul(fee, D.mul(size, stopFill))));
  const limit = D.mul(equity, pct(s.rules.riskLimitPct));
  const breaches: string[] = [];
  if (plannedLoss > limit) breaches.push(`planned loss at the stop (${D.fmt(plannedLoss)} USD) exceeds the ${s.rules.riskLimitPct}% risk limit (${D.fmt(limit)} USD)`);
  if (D.neg(net) > limit) breaches.push(`realized loss (${D.fmt(D.neg(net))} USD) exceeded the ${s.rules.riskLimitPct}% risk limit`);

  return {
    plan,
    exit: { reason: exit.reason, bar: exit.bar, price: D.fmt(exit.price, 4), fillPrice: D.fmt(exitFill, 4) },
    ambiguous: exit.reason === 'stop_ambiguous_same_bar',
    entryFillPrice: D.fmt(entryFill, 4), targetPrice: D.fmt(targetPx, 4), stopPrice: D.fmt(stopPx, 4),
    grossPnlUsd: D.fmt(gross), feesUsd: D.fmt(fees), netPnlUsd: D.fmt(net),
    netPct: D.fmt(D.mul(D.div(net, equity), HUNDRED)),
    maxDrawdownUsd: D.fmt(ddUsd), maxDrawdownPct: D.fmt(D.mul(D.div(ddUsd, equity), HUNDRED)),
    plannedMaxLossUsd: D.fmt(plannedLoss),
    breaches,
  };
}

/** What a player sees before deciding: setup bars and rules, never the tape. */
export function preDecisionView(s: Scenario) {
  return {
    mode: 'practice',
    scenarioId: s.id,
    title: s.title,
    instrument: s.instrument,
    source: s.source,
    side: s.side,
    account: { ...s.account, note: `Practice equity; position size = equity × ${s.account.leverage}x leverage` },
    rules: s.rules,
    costModel: s.costModel,
    baseline: s.baseline,
    setupBars: s.setup,
    referencePrice: s.setup[s.setup.length - 1].c,
    task: `Pick one targetPct and one stopPct for this ${s.side} (percent from the reference price; entry is the next bar's open). Stay inside the ${s.rules.riskLimitPct}% risk limit. The rest of the tape is revealed only after you submit.`,
    hiddenBars: s.tape.length,
  };
}

const REASON_TEXT: Record<ExitReason, string> = {
  target: 'target hit', stop: 'stop hit', gap_target: 'gapped through the target (filled at the open)',
  gap_stop: 'gapped through the stop (filled at the open, worse than the stop)',
  stop_ambiguous_same_bar: 'stop and target in the same bar: order unknowable, stop taken first (conservative rule)',
  time_exit: 'neither level hit: closed at the last bar',
};

export interface Debrief {
  mode: 'practice';
  scenarioId: string;
  rulesVersion: string;
  costModel: Scenario['costModel'];
  plans: Array<{ who: string } & PlanResult>;
  tapeRevealed: Bar[];
  text: string;
  resultMessage: string;
}

export function runChallenge(s: Scenario, decision: unknown, extra: Array<{ who: string; plan: Decision }> = []): Debrief {
  const mine = validateDecision(s, decision);
  const entries = [{ who: 'Your plan', plan: mine }, { who: 'Baseline', plan: s.baseline }, ...extra];
  const plans = entries.map((e) => ({ who: e.who, ...scorePlan(s, e.plan) }));
  const line = (p: (typeof plans)[number]) =>
    `${p.who} (target ${p.plan.targetPct}% / stop ${p.plan.stopPct}%): bar ${p.exit.bar}, ${REASON_TEXT[p.exit.reason]}. ` +
    `Net ${p.netPnlUsd} USD (${p.netPct}%) after ${p.feesUsd} fees; max drawdown ${p.maxDrawdownUsd} USD (${p.maxDrawdownPct}%)` +
    (p.breaches.length ? `; BREACH: ${p.breaches.join('; ')}` : '; no risk breach');
  const text = [
    `GDEX Agent Challenge · Practice only · ${s.instrument.label}`,
    `${s.source.label}. Rules ${RULES_VERSION}, costs ${s.costModel.version}: ${s.costModel.note}`,
    ...plans.map(line),
    'Compare drawdown and breaches as well as net: a plan is not better just because it made more on one tape.',
  ].join('\n');
  const me = plans[0];
  const resultMessage = `GDEX Agent Challenge result · ${s.id} · practice\nMy plan: target ${me.plan.targetPct}% / stop ${me.plan.stopPct}% → ${REASON_TEXT[me.exit.reason]}, net ${me.netPnlUsd} USD, max drawdown ${me.maxDrawdownPct}%, ${me.breaches.length ? `${me.breaches.length} breach(es)` : 'no breaches'}. Simulated, ${RULES_VERSION}.`;
  return { mode: 'practice', scenarioId: s.id, rulesVersion: RULES_VERSION, costModel: s.costModel, plans, tapeRevealed: s.tape, text, resultMessage };
}
