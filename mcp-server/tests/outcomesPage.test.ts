import { describe, it, expect } from '@jest/globals';
import { pageOutcomeMarkets } from '../src/tools/v110.js';

const market = (id: number, vol?: number, expiryMs = id) => ({
  outcomeId: id, title: `M${id}`, state: 'active', expiry: null, expiryMs, quoteToken: 'USDC',
  sides: [{ label: 'Yes', price: 0.4, coin: `#${id}0`, assetId: id * 10, balanceCoin: '+x' }],
  rules: { priceMin: 0.00001 }, params: { a: 1 },
  ...(vol === undefined ? {} : { volume24h: { volume: vol, coverage: 'complete', asOf: 1, source: 'ws' } }),
});

describe('hl_outcomes paging', () => {
  const all = { markets: Array.from({ length: 50 }, (_, i) => market(i, i % 5 === 0 ? undefined : i * 10)), source: 'x' };

  it('defaults to 20 compact rows with a nextOffset', () => {
    const r: any = pageOutcomeMarkets(all, {});
    expect(r).toMatchObject({ total: 50, offset: 0, returned: 20, nextOffset: 20, source: 'x' });
    expect(Object.keys(r.markets[0]).sort()).toEqual(['expiry', 'outcomeId', 'quoteToken', 'sides', 'state', 'title']);
    expect(r.markets[0].sides[0]).toEqual({ label: 'Yes', price: 0.4, coin: '#00' });
  });

  it('sorts by volume with unmeasured markets last and says so', () => {
    const r: any = pageOutcomeMarkets(all, { sortBy: 'volume', limit: 3 });
    expect(r.markets.map((m: any) => m.outcomeId)).toEqual([49, 48, 47]);
    expect(r.note).toMatch(/10 markets had no volume reading/);
  });

  it('paginates and returns full records with detail', () => {
    const r: any = pageOutcomeMarkets(all, { offset: 40, limit: 20, detail: true });
    expect(r).toMatchObject({ returned: 10, nextOffset: null });
    expect(r.markets[0].rules).toBeDefined();
  });
});
