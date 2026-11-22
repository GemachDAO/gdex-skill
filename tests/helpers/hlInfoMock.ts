/**
 * Test double for the HyperLiquid info API (`src/utils/hlInfo`).
 *
 * Usage:
 *   jest.mock('../../src/utils/hlInfo');
 *   let hlInfo: HlInfoMock;
 *   beforeEach(() => { hlInfo = installHlInfoMock(); });
 */
import { hlInfoRequest } from '../../src/utils/hlInfo';

type Body = { type: string } & Record<string, unknown>;

const EMPTY_STATE = {
  marginSummary: { accountValue: '0', totalNtlPos: '0', totalRawUsd: '0', totalMarginUsed: '0' },
  assetPositions: [],
};

export interface HlInfoMock {
  /** Every request body sent, in order. */
  calls: Body[];
  setState(state: unknown): void;
  setSpot(state: unknown): void;
  setOpenOrders(orders: unknown): void;
  setAllMids(mids: unknown): void;
  setFills(fills: unknown): void;
  /** Set a market's markPx (and optionally a different midPx). `dex:ASSET` goes to that dex's universe. */
  setMark(coin: string, markPx: string, midPx?: string): void;
  /** Make every request of this type reject. */
  fail(type: string, error?: Error): void;
}

export function installHlInfoMock(): HlInfoMock {
  let state: unknown = EMPTY_STATE;
  let spot: unknown = { balances: [] };
  let openOrders: unknown = [];
  let allMids: unknown = {};
  let fills: unknown = [];
  const universes: Record<string, Array<{ name: string; markPx: string; midPx: string }>> = {};
  const failures = new Map<string, Error>();
  const calls: Body[] = [];

  (hlInfoRequest as jest.Mock).mockImplementation(async (body: Body) => {
    calls.push(body);
    const failure = failures.get(body.type);
    if (failure) throw failure;
    switch (body.type) {
      case 'clearinghouseState': return state;
      case 'spotClearinghouseState': return spot;
      case 'openOrders': return openOrders;
      case 'allMids': return allMids;
      case 'userFills': return fills;
      case 'metaAndAssetCtxs': {
        const rows = universes[String(body.dex ?? '')] ?? [];
        return [
          { universe: rows.map((r) => ({ name: r.name, szDecimals: 2 })) },
          rows.map((r) => ({ markPx: r.markPx, midPx: r.midPx })),
        ];
      }
      default: throw new Error(`unexpected HL info request: ${body.type}`);
    }
  });

  return {
    calls,
    setState: (v) => { state = v; },
    setSpot: (v) => { spot = v; },
    setOpenOrders: (v) => { openOrders = v; },
    setAllMids: (v) => { allMids = v; },
    setFills: (v) => { fills = v; },
    setMark: (coin, markPx, midPx = markPx) => {
      const dex = coin.includes(':') ? coin.split(':')[0] : '';
      (universes[dex] ??= []).push({ name: coin, markPx, midPx });
    },
    fail: (type, error = new Error(`HyperLiquid info request "${type}" failed`)) => { failures.set(type, error); },
  };
}
