/**
 * Private trade replay for Hyperliquid perps, built only from authoritative records:
 *
 *   - Hyperliquid `userFillsByTime`   fills: price, size, closedPnl, fee (incl. builder fee), oid
 *   - Hyperliquid `historicalOrders`  order type and final status (TP/SL, sibling-cancel)
 *   - Hyperliquid `userFunding`       funding paid/received while the position was open
 *   - Hyperliquid `clearinghouseState` / `frontendOpenOrders`, read fresh, for "flat" and
 *     "no leftover orders" claims
 *   - the local operation journal and stored previews: what the agent submitted and the
 *     terms it saw. Missing records stay missing: nothing is inferred from text or images.
 *
 * Replay is read-only. Nothing here can place, cancel or change an order.
 */
import * as D from './decimal.js';

export const REPLAY_VERSION = 1;
export const REPLAY_VENUE = 'hyperliquid-perps';
/** How far back fills are read by default. HL caps a response at 2000 fills. */
export const DEFAULT_LOOKBACK_DAYS = 30;

// ── Record shapes (subset of Hyperliquid's info API) ───────────────────────

export interface HlFill {
  coin: string; px: string; sz: string; side: 'B' | 'A'; time: number;
  startPosition: string; dir: string; closedPnl: string; oid: number; tid: number;
  fee: string; builderFee?: string; feeToken: string; crossed?: boolean; liquidation?: unknown;
}
export interface HlHistoricalOrder {
  order: { coin: string; side: 'B' | 'A'; oid: number; timestamp: number; orderType: string; isTrigger: boolean; triggerPx: string; reduceOnly: boolean; origSz: string; limitPx: string };
  status: string;
  statusTimestamp: number;
}
export interface HlFunding { time: number; delta: { type: string; coin: string; usdc: string; szi?: string; fundingRate?: string } }
export interface HlOpenOrder { coin: string; oid: number }

/** A fresh read is either a value with its time, or explicitly unavailable. */
export type Fresh<T> = { status: 'ok'; asOf: number; data: T } | { status: 'unavailable'; error: string };

export interface JournalEntry {
  opId: string; kind: string; state: string; createdAt: number; updatedAt: number;
  /** Terms the agent previewed (from the stored preview), when still on disk. */
  terms?: Record<string, unknown>;
  summary?: string;
}

export interface ReplayRecords {
  account: { accountRef: string; hlAddress: string };
  window: { startTime: number; endTime: number };
  fills: HlFill[];
  orders: Fresh<HlHistoricalOrder[]>;
  funding: Fresh<HlFunding[]>;
  /** Fresh position size per coin, keyed by full coin name ("ETH", "xyz:TSLA"). */
  positionNow: (coin: string) => Fresh<string>;
  openOrdersNow: (coin: string) => Fresh<HlOpenOrder[]>;
  journal: JournalEntry[];
}

// ── Output ─────────────────────────────────────────────────────────────────

export type CloseState =
  /** Fills take the position from 0 back to 0, history complete, fresh read succeeded. */
  | 'full_close'
  /** Fills say flat, but the fresh read failed: flatness not re-confirmed. */
  | 'full_close_unconfirmed'
  /** Some of the position was closed; the rest is still open. */
  | 'partial_close'
  /** Opened, nothing closed yet. */
  | 'open'
  /** The opening fills are older than the lookback window: entry and P&L are incomplete. */
  | 'incomplete_history'
  /** Flipped direction inside one fill, or another shape this release does not replay. */
  | 'unsupported';

export type CloseReason = 'take_profit' | 'stop_loss' | 'liquidation' | 'manual_or_agent_close' | 'mixed' | 'unknown';

export interface ReplayEvent {
  at: number;
  kind: 'submitted' | 'order_placed' | 'fill' | 'linked_order_final' | 'funding_total' | 'fresh_read';
  text: string;
  source: string;
}

export interface CloseSummary {
  closeId: string;
  coin: string;
  side: 'long' | 'short';
  state: CloseState;
  exportable: boolean;
  openedAt: number;
  lastFillAt: number;
}

export interface Replay extends CloseSummary {
  version: number;
  venue: string;
  private: true;
  entry: { avgPx: string; size: string; fills: number } | null;
  exit: { avgPx: string; size: string; fills: number } | null;
  remainingSize: string;
  closeReason: CloseReason;
  money: {
    quoteToken: string | 'mixed';
    grossRealizedPnl: string;
    fees: { open: string; close: string; total: string; builderFeeIncluded: string };
    funding: string | 'unknown';
    netRealizedPnl: string | 'unknown';
    note: string;
  };
  linkedOrders: Array<{ type: string; triggerPx: string; finalStatus: string; confirmedNow: 'not_open' | 'still_open' | 'unknown' }>;
  positionNow: 'flat' | 'open' | 'unknown';
  leftoverOrdersNow: number | 'unknown';
  agentRecord: { submitted: Array<{ opId: string; kind: string; state: string; at: number; summary?: string; terms?: Record<string, unknown> }>; note: string };
  timeline: ReplayEvent[];
  unknowns: string[];
  /** Scenario family a practice challenge can be drawn from (full_close only). */
  practiceFamily: string | null;
  /** Rounded relative plan from linked TP/SL, offered (never sent by default) to a challenge. */
  relativePlan: { targetPct: string | null; stopPct: string | null } | null;
}

// ── Lifecycle segmentation ─────────────────────────────────────────────────

interface Segment { coin: string; fills: HlFill[]; startPos: D.Dec; endPos: D.Dec; flipped: boolean }

const signedSize = (f: HlFill): D.Dec => (f.side === 'B' ? D.dec(f.sz) : D.neg(D.dec(f.sz)));
const isOpening = (f: HlFill) => /^Open /.test(f.dir);
const isClosing = (f: HlFill) => /^Close /.test(f.dir) || f.liquidation !== undefined;

/** Split each coin's fills into position lifecycles (0 → … → 0). */
export function segmentFills(fills: HlFill[]): Segment[] {
  const sorted = [...fills].sort((a, b) => a.time - b.time || a.tid - b.tid);
  const open = new Map<string, Segment>();
  const done: Segment[] = [];
  for (const f of sorted) {
    const start = D.dec(f.startPosition);
    const after = D.add(start, signedSize(f));
    let seg = open.get(f.coin);
    if (!seg) {
      seg = { coin: f.coin, fills: [], startPos: start, endPos: start, flipped: false };
      open.set(f.coin, seg);
    }
    seg.fills.push(f);
    seg.endPos = after;
    if (start !== 0n && after !== 0n && (start > 0n) !== (after > 0n)) seg.flipped = true;
    if (after === 0n || seg.flipped) {
      done.push(seg);
      open.delete(f.coin);
    }
  }
  return [...done, ...open.values()].sort((a, b) => lastAt(b) - lastAt(a));
}

const lastAt = (s: Segment) => s.fills[s.fills.length - 1].time;
const firstAt = (s: Segment) => s.fills[0].time;
const closeIdOf = (s: Segment) => `${s.coin.replace(/[^A-Za-z0-9]/g, '_')}-${s.fills[0].tid}`;

function sideOf(s: Segment): 'long' | 'short' {
  const opener = s.fills.find(isOpening);
  if (opener) return /Long/.test(opener.dir) ? 'long' : 'short';
  return s.startPos > 0n ? 'long' : 'short';
}

function stateOf(s: Segment, positionNow: Fresh<string>, laterSegmentExists: boolean): CloseState {
  if (s.flipped) return 'unsupported';
  if (s.startPos !== 0n) return 'incomplete_history';
  const closed = s.fills.some(isClosing);
  if (s.endPos !== 0n) return closed ? 'partial_close' : 'open';
  if (positionNow.status !== 'ok') return 'full_close_unconfirmed';
  // A later position in the same market makes "flat now" irrelevant to this close; fills
  // alone prove the close, and the fresh read still succeeded.
  if (laterSegmentExists) return 'full_close';
  return D.dec(positionNow.data) === 0n ? 'full_close' : 'full_close_unconfirmed';
}

export function summarizeCloses(rec: ReplayRecords): CloseSummary[] {
  const segs = segmentFills(rec.fills);
  return segs.map((s) => {
    const later = segs.some((o) => o.coin === s.coin && firstAt(o) > lastAt(s));
    const state = stateOf(s, rec.positionNow(s.coin), later);
    return { closeId: closeIdOf(s), coin: s.coin, side: sideOf(s), state, exportable: state === 'full_close', openedAt: firstAt(s), lastFillAt: lastAt(s) };
  });
}

// ── Building one replay ────────────────────────────────────────────────────

function avg(fills: HlFill[]): { avgPx: string; size: string; fills: number } | null {
  if (!fills.length) return null;
  let size = D.ZERO; let notional = D.ZERO;
  for (const f of fills) { const sz = D.dec(f.sz); size = D.add(size, sz); notional = D.add(notional, D.mul(sz, D.dec(f.px))); }
  return { avgPx: D.exact(D.div(notional, size)), size: D.exact(size), fills: fills.length };
}

function latestByOid(orders: HlHistoricalOrder[]): Map<number, HlHistoricalOrder> {
  const m = new Map<number, HlHistoricalOrder>();
  for (const o of orders) {
    const prev = m.get(o.order.oid);
    if (!prev || o.statusTimestamp >= prev.statusTimestamp) m.set(o.order.oid, o);
  }
  return m;
}

function reasonOf(fills: HlFill[], byOid: Map<number, HlHistoricalOrder> | null): CloseReason {
  const reasons = new Set<CloseReason>();
  for (const f of fills) {
    if (f.liquidation !== undefined) { reasons.add('liquidation'); continue; }
    const t = byOid?.get(f.oid)?.order.orderType;
    if (!t) reasons.add('unknown');
    else if (/^Take Profit/.test(t)) reasons.add('take_profit');
    else if (/^Stop/.test(t)) reasons.add('stop_loss');
    else if (t === 'Market' || t === 'Limit') reasons.add('manual_or_agent_close');
    else reasons.add('unknown');
  }
  if (reasons.size === 1) return [...reasons][0];
  return reasons.size ? 'mixed' : 'unknown';
}

const finalStatus = (raw: string): string =>
  raw === 'filled' || raw === 'triggered' ? 'filled'
    : raw === 'open' ? 'open'
      : /canceled$/i.test(raw) ? `canceled (${raw})`
        : raw;

function pctFrom(entry: D.Dec, px: D.Dec): string {
  // Relative distance from entry, rounded to 0.1%.
  return D.fmt(D.mul(D.div(D.abs(D.sub(px, entry)), entry), D.dec(100)), 1);
}

export function buildReplay(rec: ReplayRecords, closeId: string): Replay {
  const segs = segmentFills(rec.fills);
  const seg = segs.find((s) => closeIdOf(s) === closeId);
  if (!seg) throw new Error(`No trade ${closeId} in the last fills for this account`);
  const later = segs.some((o) => o.coin === seg.coin && firstAt(o) > lastAt(seg));
  const posNow = rec.positionNow(seg.coin);
  const ordersNow = rec.openOrdersNow(seg.coin);
  const state = stateOf(seg, posNow, later);
  const side = sideOf(seg);
  const opens = seg.fills.filter(isOpening);
  const closes = seg.fills.filter((f) => !isOpening(f));
  const unknowns: string[] = [];
  const timeline: ReplayEvent[] = [];

  // Money: closedPnl is price P&L only; fee already includes the builder fee.
  const tokens = new Set(seg.fills.map((f) => f.feeToken));
  const quoteToken = tokens.size === 1 ? [...tokens][0] : 'mixed';
  const sum = (fs: HlFill[], k: 'fee' | 'closedPnl' | 'builderFee') => fs.reduce((t, f) => D.add(t, D.dec(f[k] ?? '0')), D.ZERO);
  const gross = sum(seg.fills, 'closedPnl');
  const feeOpen = sum(opens, 'fee'); const feeClose = sum(closes, 'fee');
  const feeTotal = D.add(feeOpen, feeClose);
  let funding: D.Dec | 'unknown' = 'unknown';
  if (rec.funding.status === 'ok') {
    const until = seg.endPos === 0n ? lastAt(seg) : rec.window.endTime;
    const rows = rec.funding.data.filter((r) => r.delta.type === 'funding' && (r.delta.coin === seg.coin || r.delta.coin === seg.coin.replace(/^[^:]*:/, '')) && r.time > firstAt(seg) && r.time <= until);
    funding = rows.reduce((t, r) => D.add(t, D.dec(r.delta.usdc)), D.ZERO);
    timeline.push({ at: until, kind: 'funding_total', text: `Funding while open: ${D.fmt(funding, 4)} ${quoteToken} over ${rows.length} payment(s) (negative = paid)`, source: 'hyperliquid.userFunding' });
  } else unknowns.push(`Funding unknown: ${rec.funding.error}`);
  if (quoteToken === 'mixed') unknowns.push('Fees were charged in more than one token; net P&L is not combined.');
  if (state === 'incomplete_history') unknowns.push('The opening fills are older than the lookback window: entry, fees and P&L cover only the fills shown.');
  const net = funding === 'unknown' || quoteToken === 'mixed' || seg.endPos !== 0n || state === 'incomplete_history'
    ? 'unknown' : D.exact(D.add(D.sub(gross, feeTotal), funding));
  if (seg.endPos !== 0n && state !== 'unsupported') unknowns.push('Position is not fully closed: only the realized part is shown; net P&L is not final.');

  // Orders: reason for the close and linked TP/SL outcomes.
  const byOid = rec.orders.status === 'ok' ? latestByOid(rec.orders.data) : null;
  if (!byOid) unknowns.push(`Order history unavailable (${(rec.orders as { error: string }).error}): close reason and linked orders unknown.`);
  const closeReason = closes.length ? reasonOf(closes, byOid) : 'unknown';
  if (closes.length && closeReason === 'unknown') unknowns.push('Why the position closed is not in the order history.');
  const openNowOids = ordersNow.status === 'ok' ? new Set(ordersNow.data.map((o) => o.oid)) : null;
  const linkedOrders: Replay['linkedOrders'] = [];
  let tpPx: D.Dec | null = null; let slPx: D.Dec | null = null;
  if (byOid) {
    const from = firstAt(seg) - 2000; const until = seg.endPos === 0n ? lastAt(seg) : rec.window.endTime;
    for (const o of byOid.values()) {
      const od = o.order;
      if (od.coin !== seg.coin || !od.isTrigger || !od.reduceOnly || od.timestamp < from || od.timestamp > until) continue;
      const fs = finalStatus(o.status);
      const confirmedNow = openNowOids ? (openNowOids.has(od.oid) ? 'still_open' : 'not_open') : 'unknown';
      linkedOrders.push({ type: od.orderType, triggerPx: od.triggerPx, finalStatus: fs, confirmedNow });
      if (/^Take Profit/.test(od.orderType)) tpPx = D.dec(od.triggerPx);
      if (/^Stop/.test(od.orderType)) slPx = D.dec(od.triggerPx);
      timeline.push({ at: od.timestamp, kind: 'order_placed', text: `${od.orderType} placed, trigger ${od.triggerPx}`, source: 'hyperliquid.historicalOrders' });
      timeline.push({ at: o.statusTimestamp, kind: 'linked_order_final', text: `${od.orderType} @ ${od.triggerPx}: ${fs}${confirmedNow === 'not_open' ? '; not among open orders on a fresh read' : confirmedNow === 'still_open' ? '; STILL OPEN on a fresh read' : '; not re-confirmed (open orders unavailable)'}`, source: 'hyperliquid.historicalOrders + frontendOpenOrders' });
    }
  }
  for (const f of seg.fills) {
    const t = byOid?.get(f.oid)?.order.orderType;
    timeline.push({ at: f.time, kind: 'fill', text: `${f.dir} ${f.sz} ${f.coin} @ ${f.px}${t ? ` (${t})` : ''}; fee ${f.fee} ${f.feeToken}${f.builderFee ? ` incl. builder ${f.builderFee}` : ''}${f.closedPnl !== '0.0' && f.closedPnl !== '0' ? `; closedPnl ${f.closedPnl}` : ''}`, source: 'hyperliquid.userFillsByTime' });
  }

  // What the agent submitted, from the local journal (this machine only).
  const submitted = rec.journal
    .filter((j) => (j.kind === 'perp_open' || j.kind === 'perp_close') && String(j.terms?.coin ?? '').toUpperCase() === seg.coin.toUpperCase() && j.createdAt >= firstAt(seg) - 10 * 60_000 && j.createdAt <= lastAt(seg))
    .map((j) => ({ opId: j.opId, kind: j.kind, state: j.state, at: j.createdAt, summary: j.summary, terms: j.terms }));
  for (const s of submitted) timeline.push({ at: s.at, kind: 'submitted', text: `Agent submitted ${s.kind}${s.summary ? `: ${s.summary}` : ''} (journal state ${s.state})`, source: 'local.operationJournal' });
  const agentNote = submitted.length
    ? 'Submitted terms come from this machine\'s operation journal. The agent\'s reasons are not recorded, so none are given.'
    : 'No operation on this machine matches this trade (placed elsewhere, or the journal was cleared). What the agent knew at the time is not recorded.';

  let positionNow: Replay['positionNow'] = 'unknown';
  if (posNow.status === 'ok') {
    positionNow = D.dec(posNow.data) === 0n ? 'flat' : 'open';
    timeline.push({ at: posNow.asOf, kind: 'fresh_read', text: `Fresh read: ${seg.coin} position ${positionNow === 'flat' ? 'flat' : `open (${posNow.data})`}`, source: 'hyperliquid.clearinghouseState' });
  } else unknowns.push(`Current position not confirmed: ${posNow.error}`);
  const leftover = ordersNow.status === 'ok' ? ordersNow.data.length : 'unknown';
  if (ordersNow.status === 'ok') timeline.push({ at: ordersNow.asOf, kind: 'fresh_read', text: `Fresh read: ${ordersNow.data.length} open order(s) on ${seg.coin}`, source: 'hyperliquid.frontendOpenOrders' });
  else unknowns.push(`Open orders not confirmed: ${ordersNow.error}`);

  timeline.sort((a, b) => a.at - b.at);
  const entryAvg = avg(opens);
  const exportable = state === 'full_close';
  let relativePlan: Replay['relativePlan'] = null;
  if (exportable && entryAvg) {
    const e = D.dec(entryAvg.avgPx);
    relativePlan = { targetPct: tpPx !== null ? pctFrom(e, tpPx) : null, stopPct: slPx !== null ? pctFrom(e, slPx) : null };
  }
  return {
    version: REPLAY_VERSION, venue: REPLAY_VENUE, private: true,
    closeId, coin: seg.coin, side, state, exportable, openedAt: firstAt(seg), lastFillAt: lastAt(seg),
    entry: entryAvg, exit: avg(closes), remainingSize: D.exact(D.abs(seg.endPos)), closeReason,
    money: {
      quoteToken, grossRealizedPnl: D.exact(gross),
      fees: { open: D.exact(feeOpen), close: D.exact(feeClose), total: D.exact(feeTotal), builderFeeIncluded: D.exact(sum(seg.fills, 'builderFee')) },
      funding: funding === 'unknown' ? 'unknown' : D.exact(funding), netRealizedPnl: net,
      note: 'net = closedPnl − fees + funding. Hyperliquid\'s fee already includes the GDEX builder fee (shown separately, not added again).',
    },
    linkedOrders, positionNow, leftoverOrdersNow: leftover,
    agentRecord: { submitted, note: agentNote },
    timeline, unknowns,
    practiceFamily: exportable ? `${side}-target-vs-stop` : null,
    relativePlan,
  };
}

/** Short text a host shows as-is. Gains and losses use the same wording. */
export function replayHeadline(r: Replay): string {
  const label: Record<CloseState, string> = {
    full_close: 'Closed', full_close_unconfirmed: 'Closed per fills (flat not re-confirmed)', partial_close: 'Partially closed',
    open: 'Open, nothing closed yet', incomplete_history: 'Close with incomplete history', unsupported: 'Not supported by replay',
  };
  const why: Record<CloseReason, string> = {
    take_profit: 'Take-profit filled.', stop_loss: 'Stop-loss filled.', liquidation: 'Liquidated.',
    manual_or_agent_close: 'Closed by a market/limit order.', mixed: 'Closed by more than one order type.', unknown: 'Close reason not recorded.',
  };
  const lines = [`${r.coin} ${r.side} replay · Private · ${label[r.state]}`];
  if (r.exit) lines.push(why[r.closeReason]);
  lines.push(r.positionNow === 'flat' ? 'Position is flat (fresh read).' : r.positionNow === 'open' ? 'A position is open in this market now (fresh read).' : 'Current position not confirmed.');
  for (const l of r.linkedOrders) {
    if (l.finalStatus.startsWith('canceled') && l.confirmedNow === 'not_open') lines.push(`Linked ${l.type.toLowerCase()} is confirmed canceled.`);
    else if (l.confirmedNow === 'still_open') {
      lines.push(r.positionNow === 'open' && r.remainingSize !== '0'
        ? `Linked ${l.type.toLowerCase()} @ ${l.triggerPx} is open and still protects the position.`
        : `Linked ${l.type.toLowerCase()} is STILL OPEN with no position to protect.`);
    }
  }
  if (r.money.netRealizedPnl !== 'unknown') lines.push(`Net realized: ${D.fmt(D.dec(r.money.netRealizedPnl), 2)} ${r.money.quoteToken} (fees ${D.fmt(D.dec(r.money.fees.total), 2)}, funding ${r.money.funding === 'unknown' ? 'unknown' : D.fmt(D.dec(r.money.funding), 2)}).`);
  const next = [r.exit ? '"Explain the exit"' : '"Explain this position"'];
  if (r.exportable) next.push('"Practice a different stop"', '"Make an agent challenge"');
  lines.push(`Next: ${next.join(' · ')}`);
  return lines.join('\n');
}
