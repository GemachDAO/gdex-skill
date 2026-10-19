/**
 * HIP-4 outcome markets: discovery → side → validation → order → account → exit.
 *
 * Fixtures:
 *   - tests/fixtures/hlOutcomes.live.json — trimmed live `GET /v1/hl/outcomes`
 *     (Hyperliquid outcomeMeta + allMids) captured 2026-10-19.
 *   - Account payload shaped from backend getOutcomeAccount
 *     (src/services/perp/hyperLiquidOutcomes.ts:503-538) and the
 *     @nktkas/hyperliquid spotClearinghouseState / FrontendOpenOrder / Fill /
 *     historicalOrders types.
 */
import { AbiCoder } from 'ethers';
import { GdexApiClient } from '../../src/client';
import {
  createHlOutcomeOrder,
  cancelHlOutcomeOrder,
  closeHlOutcomeOrder,
  getHlOutcomeMarkets,
  getHlOutcomeAccountState,
  checkHlOutcomeCollateral,
  resolveOutcomeWriteMode,
} from '../../src/actions/hlOutcomes';
import {
  normalizeOutcomeMarkets,
  normalizeOutcomeAccount,
  normalizeOutcomeOrderResult,
  validateOutcomeOrder,
  validateOutcomeClose,
  resolveOutcomeSide,
  findOutcomeMarket,
  OutcomeMarket,
} from '../../src/actions/hlOutcomeMarkets';
import { GdexValidationError } from '../../src/utils/errors';
import { decryptGdexComputedData, generateGdexSessionKeyPair } from '../../src/utils/gdexManagedCrypto';
import { readFileSync } from 'fs';
import { join } from 'path';

const liveFixture: any = JSON.parse(readFileSync(join(__dirname, '../fixtures/hlOutcomes.live.json'), 'utf8'));

jest.mock('../../src/client');
const MockedClient = GdexApiClient as jest.MockedClass<typeof GdexApiClient>;

const NOW = Date.UTC(2026, 9, 19, 20, 0); // fixture capture time
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const markets = (): OutcomeMarket[] => normalizeOutcomeMarkets(clone(liveFixture), { now: NOW });
const byId = (id: number): OutcomeMarket => findOutcomeMarket(markets(), id);

const apiKey = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54'; // gitleaks:allow (test fixture, not a real key)
const pair = generateGdexSessionKeyPair();
const creds = { apiKey, walletAddress: '0xC0Ntr01', sessionPrivateKey: pair.sessionPrivateKey };
const MANAGED = '0x1111111111111111111111111111111111111111';
const abi = AbiCoder.defaultAbiCoder();

function decodeBody(body: unknown, types: string[]): unknown[] {
  const { data } = JSON.parse(decryptGdexComputedData((body as { computedData: string }).computedData, apiKey)) as { data: string };
  return Array.from(abi.decode(types, '0x' + data));
}

/** Backend getOutcomeAccount reply for outcome 14315 (ETH above 2430.5). */
const accountFixture = {
  isSuccess: true,
  data: {
    outcomeId: 14315,
    coins: [
      { outcomeId: 14315, coin: '#143150', assetId: 143150, exchangeAssetId: 100143150, balanceCoin: '+143150', sizeDecimals: 0, sideName: 'Yes', sideIndex: 0 },
      { outcomeId: 14315, coin: '#143151', assetId: 143151, exchangeAssetId: 100143151, balanceCoin: '+143151', sizeDecimals: 0, sideName: 'No', sideIndex: 1 },
    ],
    positions: [{ coin: '+143151', token: 143151, total: '120.0', hold: '20.0', entryNtl: '96.0' }],
    openOrders: [
      { coin: '#143150', side: 'B', limitPx: '0.1', sz: '80.0', oid: 4242, timestamp: 1792440000000, origSz: '120.0', triggerCondition: 'N/A', isTrigger: false, triggerPx: '0.0', children: [], isPositionTpsl: false, reduceOnly: false, orderType: 'Limit', tif: 'Gtc', cloid: null },
    ],
    fills: [
      { coin: '#143150', px: '0.1', sz: '40.0', side: 'B', time: 1792440001000, startPosition: '0.0', dir: 'Buy', closedPnl: '0.0', hash: '0xabc', oid: 4242, crossed: false, fee: '0.0', tid: 1, feeToken: 'USDC', twapId: null },
    ],
    historicalOrders: [
      { order: { coin: '#143151', side: 'A', limitPx: '0.9', sz: '0.0', oid: 4100, timestamp: 1792430000000, origSz: '10.0' }, status: 'minTradeNtlRejected', statusTimestamp: 1792430000001 },
    ],
  },
};

const resting = { isSuccess: true, data: { status: 'ok', response: { type: 'order', data: { statuses: [{ resting: { oid: 4242 } }] } } } };
const filled = { isSuccess: true, data: { status: 'ok', response: { type: 'order', data: { statuses: [{ filled: { totalSz: '100.0', avgPx: '0.13', oid: 4243 } }] } } } };
const cancelled = { isSuccess: true, data: { status: 'ok', response: { type: 'cancel', data: { statuses: ['success'] } } } };

describe('normalizeOutcomeMarkets (live fixture)', () => {
  it('normalises a recurring price-binary market with real side coins, quote token and rules', () => {
    const m = byId(14315);
    expect(m.kind).toBe('hyperliquid_hip4_outcome');
    expect(m.title).toBe('ETH above 2,430.5 at 2026-10-20 06:00 UTC?');
    expect(m.quoteToken).toBe('USDC');
    expect(m.state).toBe('active');
    expect(m.tradable).toBe(true);
    expect(m.expiry).toBe('2026-10-20T06:00:00.000Z');
    expect(m.sides.map((s) => [s.label, s.coin, s.balanceCoin, s.exchangeAssetId, s.price])).toEqual([
      ['Yes', '#143150', '+143150', 100143150, 0.131825],
      ['No', '#143151', '+143151', 100143151, 0.868175],
    ]);
    expect(m.rules).toMatchObject({ priceMin: 0.00001, priceMax: 0.99999, priceTick: '0.00001', sizeDecimals: 0, minOrderNotional: 11, minOrderNotionalCurrency: 'USDC', reduceOnlyHonoured: false });
    expect(m.settlement.claimViaGdex).toBe(false);
  });

  it('fills template side labels instead of assuming side 0 is "Yes"', () => {
    const m = byId(14437); // LoL match: sides are the two teams
    expect(m.sides.map((s) => s.rawName)).toEqual(['template:{shortNameA}', 'template:{shortNameB}']);
    expect(m.sides.map((s) => s.label)).toEqual(['LOS', 'T1']);
    expect(m.title).toBe('LOS vs T1 (LoL: Worlds Swiss Stage)');
    expect(m.settlement.resolutionSource).toBe('gol.gg');
    expect(byId(13103).sides.map((s) => s.label)).toEqual(['Yes', 'No']); // "template:Yes"
  });

  it('links question legs, titles buckets and flags the fallback leg', () => {
    expect(byId(14183).title).toBe('Bournemouth AFC vs AC Milan (UEFA Europa League): Bournemouth AFC');
    expect(byId(14184).title).toBe('Bournemouth AFC vs AC Milan (UEFA Europa League): draw');
    const fb = byId(14182);
    expect(fb.isFallback).toBe(true);
    expect(fb.questionId).toBe(480);
    expect(byId(14320).title).toBe('BTC between 81,064 and 84,373 at 2026-10-20 06:00 UTC?');
  });

  it('derives expired / settled / pre_launch and says what settlement support exists', () => {
    const later = normalizeOutcomeMarkets(clone(liveFixture), { now: Date.UTC(2026, 9, 21) });
    const expired = findOutcomeMarket(later, 14315);
    expect(expired.state).toBe('expired');
    expect(expired.tradable).toBe(false);
    expect(expired.settlement.summary).toMatch(/no claim or redeem endpoint/);

    const fx = clone(liveFixture);
    fx.data.meta.questions[0].settledNamedOutcomes = [14183];
    delete (fx.data.mids as Record<string, string>)['#131030'];
    delete (fx.data.mids as Record<string, string>)['#131031'];
    const ms = normalizeOutcomeMarkets(fx, { now: NOW });
    expect(findOutcomeMarket(ms, 14183).state).toBe('settled');
    expect(findOutcomeMarket(ms, 14183).settlement.summary).toMatch(/^Resolved on Hyperliquid/);
    expect(findOutcomeMarket(ms, 13103).state).toBe('pre_launch');
    expect(findOutcomeMarket(ms, 13103).sides[0].price).toBeNull();
  });

  it('uses sideSpecs[].token when Hyperliquid provides it', () => {
    const fx = clone(liveFixture) as { data: { meta: { outcomes: Array<{ outcome: number; sideSpecs: Array<{ name: string; token?: number }> }> } } };
    fx.data.meta.outcomes.find((o) => o.outcome === 14315)!.sideSpecs[1].token = 100999991;
    const m = findOutcomeMarket(normalizeOutcomeMarkets(fx, { now: NOW }), 14315);
    expect(m.sides[1].coin).toBe('#999991');
  });

  it('rejects unknown ids with the discovery hint', () => {
    expect(() => findOutcomeMarket(markets(), 1)).toThrow(/Unknown outcomeId 1/);
    expect(() => findOutcomeMarket(markets(), 'abc')).toThrow(GdexValidationError);
  });
});

describe('side selection and order validation', () => {
  const m = byId(14315);

  it('resolves exactly one of coin / sideIndex / sideLabel', () => {
    expect(resolveOutcomeSide(m, { sideLabel: 'no' }).coin).toBe('#143151');
    expect(resolveOutcomeSide(m, { sideIndex: 0 }).label).toBe('Yes');
    expect(() => resolveOutcomeSide(m, {})).toThrow(/exactly one/);
    expect(() => resolveOutcomeSide(m, { coin: '#143150', sideIndex: 0 })).toThrow(/exactly one/);
    expect(() => resolveOutcomeSide(m, { coin: '#144370' })).toThrow(/does not belong to outcome 14315/);
    expect(() => resolveOutcomeSide(m, { coin: '143150' })).toThrow(/#<assetId>/);
  });

  it('accepts a valid limit buy and returns canonical strings', () => {
    const v = validateOutcomeOrder(m, { coin: '#143150', isBuy: true, price: '0.12', size: '100' });
    expect(v).toMatchObject({ price: '0.12', size: '100', isMarket: false, quoteToken: 'USDC' });
    expect(v.notional).toBeCloseTo(12);
  });

  it.each([
    ['1.5', /whole number/],
    ['0', /whole number/],
    ['-3', /whole number/],
    ['1e3', /whole number/],
    ['', /whole number/],
  ])('rejects size %p', (size, re) => {
    expect(() => validateOutcomeOrder(m, { coin: '#143150', isBuy: true, price: '0.5', size })).toThrow(re);
  });

  it.each([
    ['1', /decimal probability|outside/],
    ['0', /outside/],
    ['0.000001', /decimals/],
    ['0.123456', /decimals/],
    ['abc', /decimal probability/],
    [undefined, /decimal probability/],
  ])('rejects limit price %p', (price, re) => {
    expect(() => validateOutcomeOrder(m, { coin: '#143150', isBuy: true, price: price as string, size: '1000' })).toThrow(re);
  });

  it('enforces the 11-quote minimum notional (gdex.pro rule)', () => {
    expect(() => validateOutcomeOrder(m, { coin: '#143150', isBuy: true, price: '0.1', size: '100' })).toThrow(/below the 11 USDC minimum.*size >= 110/);
    expect(validateOutcomeOrder(m, { coin: '#143150', isBuy: true, price: '0.1', size: '110' }).notional).toBeCloseTo(11);
  });

  it('exempts a full-position sell from the minimum and blocks oversells', () => {
    expect(() => validateOutcomeOrder(m, { coin: '#143151', isBuy: false, price: '0.5', size: '10' })).toThrow(/minimum/);
    expect(validateOutcomeOrder(m, { coin: '#143151', isBuy: false, price: '0.5', size: '10' }, { availableSize: 10 }).size).toBe('10');
    expect(() => validateOutcomeOrder(m, { coin: '#143151', isBuy: false, price: '0.5', size: '30' }, { availableSize: 25 })).toThrow(/exceeds available/);
    expect(() => validateOutcomeOrder(m, { coin: '#143151', isBuy: false, price: '0.5', size: '30' }, { availableSize: 0 })).toThrow(/No sellable/);
  });

  it('market orders: price must be omitted, minimum estimated from the mid', () => {
    expect(() => validateOutcomeOrder(m, { coin: '#143150', isBuy: true, isMarket: true, price: '0.2', size: '100' })).toThrow(/omit price/);
    const v = validateOutcomeOrder(m, { coin: '#143150', isBuy: true, isMarket: true, size: '100' });
    expect(v.price).toBe('0');
    expect(v.notionalIsEstimate).toBe(true);
    expect(v.notional).toBeCloseTo(100 * 0.131825 * 1.05);
  });

  it('refuses orders on expired or settled markets and warns that reduceOnly is ignored', () => {
    const expired = findOutcomeMarket(normalizeOutcomeMarkets(clone(liveFixture), { now: Date.UTC(2026, 9, 21) }), 14315);
    expect(() => validateOutcomeOrder(expired, { coin: '#143150', isBuy: true, price: '0.5', size: '100' })).toThrow(/expired/);
    const v = validateOutcomeOrder(m, { coin: '#143151', isBuy: false, price: '0.9', size: '20', reduceOnly: true });
    expect(v.warnings.join(' ')).toMatch(/reduceOnly is ignored/);
  });

  it('close: full by default, partial-exit minimums with account context', () => {
    expect(validateOutcomeClose(m, { coin: '#143151', price: '0.86' })).toMatchObject({ size: '', full: true });
    expect(() => validateOutcomeClose(m, { coin: '#143151', price: '0.86', size: '5' }, { availableSize: 100 })).toThrow(/Partial close value/);
    expect(() => validateOutcomeClose(m, { coin: '#143151', price: '0.86', size: '95' }, { availableSize: 100 })).toThrow(/remaining position/);
    expect(validateOutcomeClose(m, { coin: '#143151', price: '0.86', size: '50' }, { availableSize: 100 }).full).toBe(false);
    expect(() => validateOutcomeClose(m, { coin: '#143151', price: '0.86' }, { availableSize: 0 })).toThrow(/No No position/);
    expect(() => validateOutcomeClose(m, { coin: '#143151', isMarket: true, price: '0.5' })).toThrow(/omit price/);
  });
});

describe('normalizeOutcomeAccount / normalizeOutcomeOrderResult', () => {
  it('maps balances, resting/partial orders, fills and history to stable shapes', () => {
    const s = normalizeOutcomeAccount(accountFixture, byId(14315));
    expect(s.positions).toEqual([
      expect.objectContaining({ coin: '#143151', balanceCoin: '+143151', sideLabel: 'No', size: 120, hold: 20, available: 100, entryNotional: 96, avgEntryPrice: 0.8, markPrice: 0.868175 }),
    ]);
    expect(s.positions[0].unrealizedPnl).toBeCloseTo(120 * 0.868175 - 96);
    expect(s.openOrders[0]).toMatchObject({ coin: '#143150', sideLabel: 'Yes', orderId: 4242, isBuy: true, price: 0.1, size: 80, originalSize: 120, filledSize: 40, status: 'partially_filled', tif: 'Gtc' });
    expect(s.fills[0]).toMatchObject({ orderId: 4242, isBuy: true, price: 0.1, size: 40, feeToken: 'USDC' });
    expect(s.historicalOrders[0]).toMatchObject({ orderId: 4100, isBuy: false, status: 'minTradeNtlRejected' });
  });

  it('labels sides from the backend coins list when no market is passed', () => {
    expect(normalizeOutcomeAccount(accountFixture).positions[0]).toMatchObject({ sideLabel: 'No', markPrice: null, value: null });
  });

  it('classifies exchange replies', () => {
    expect(normalizeOutcomeOrderResult(resting, 'create')).toMatchObject({ status: 'resting', orderId: 4242, isSuccess: true });
    expect(normalizeOutcomeOrderResult(filled, 'create')).toMatchObject({ status: 'filled', orderId: 4243, filledSize: 100, avgPrice: 0.13 });
    expect(normalizeOutcomeOrderResult(cancelled, 'cancel')).toMatchObject({ status: 'canceled', isSuccess: true });
    const err = { isSuccess: true, data: { status: 'ok', response: { type: 'order', data: { statuses: [{ error: 'Order must have minimum value of 10 USDC.' }] } } } };
    expect(normalizeOutcomeOrderResult(err, 'create')).toMatchObject({ status: 'rejected', isSuccess: false, error: 'Order must have minimum value of 10 USDC.' });
    expect(normalizeOutcomeOrderResult({ isSuccess: false, error: 'Outcome coin does not belong to outcomeId' }, 'create')).toMatchObject({ status: 'rejected' });
  });
});

describe('outcome actions (mocked client)', () => {
  let client: jest.Mocked<GdexApiClient>;

  beforeEach(() => {
    client = new MockedClient() as jest.Mocked<GdexApiClient>;
    client.get = jest.fn().mockImplementation(async (path: string) =>
      path === '/v1/hl/outcome_account' ? clone(accountFixture) : clone(liveFixture),
    );
    client.post = jest.fn().mockResolvedValue(resting);
  });

  it('getHlOutcomeMarkets filters by state/query and reports totals', async () => {
    const r = await getHlOutcomeMarkets(client, { state: 'active', query: 'ETH', now: NOW });
    expect(r.total).toBe(11);
    expect(r.markets.map((x) => x.outcomeId)).toEqual([14315]);
    expect(client.get).toHaveBeenCalledWith('/v1/hl/outcomes');
  });

  it('getHlOutcomeMarkets withVolume never blocks discovery when the feed is down', async () => {
    const t0 = Date.now();
    const r = await getHlOutcomeMarkets(client, { query: 'ETH', withVolume: true, volumeTimeoutMs: 300, volumeWsUrl: 'ws://127.0.0.1:1', now: NOW });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.markets[0].volume24h).toMatchObject({ volume: null, coverage: 'unavailable', missingCoins: ['#143150', '#143151'] });
    expect(r.volumeCoverage).toBe('unavailable');
  });

  it('create: validates, encodes the canonical order and returns resting state', async () => {
    const r = await createHlOutcomeOrder(client, { ...creds, outcomeId: 14315, sideLabel: 'Yes', isBuy: true, price: '0.1', size: '110' });
    expect(r).toMatchObject({ status: 'resting', orderId: 4242, request: { coin: '#143150', sideLabel: 'Yes', price: '0.1', size: '110' } });
    const [path, body] = client.post.mock.calls[0];
    expect(path).toBe('/v1/hl/outcome/create_order');
    expect(Object.keys(body as object)).toEqual(['computedData']);
    const d = decodeBody(body, ['string', 'string', 'bool', 'string', 'string', 'bool', 'bool', 'string']);
    expect(d.slice(0, 7)).toEqual(['14315', '#143150', true, '0.1', '110', false, false]);
  });

  it('create: rejects bad input before signing or posting', async () => {
    await expect(createHlOutcomeOrder(client, { ...creds, outcomeId: 14315, coin: '#144370', isBuy: true, price: '0.5', size: '100' })).rejects.toThrow(/does not belong/);
    await expect(createHlOutcomeOrder(client, { ...creds, outcomeId: 14315, coin: '#143150', isBuy: true, price: '0.1', size: '100' })).rejects.toThrow(/minimum/);
    await expect(createHlOutcomeOrder(client, { ...creds, outcomeId: 99, coin: '#990', isBuy: true, price: '0.5', size: '100' })).rejects.toThrow(/Unknown outcomeId/);
    expect(client.post).not.toHaveBeenCalled();
  });

  it('create: sell with managedAddress uses the real position (full-position exemption)', async () => {
    // 100 available No tokens at 0.05 = 5 USDC < 11, allowed only because it is the whole position.
    await createHlOutcomeOrder(client, { ...creds, outcomeId: 14315, coin: '#143151', isBuy: false, price: '0.05', size: '100', managedAddress: MANAGED });
    expect(client.get).toHaveBeenCalledWith('/v1/hl/outcome_account', { address: MANAGED, outcomeId: '14315' });
    expect(client.post).toHaveBeenCalledTimes(1);
  });

  it('rejects computedData mixed with structured fields, and missing fields', async () => {
    await expect(createHlOutcomeOrder(client, { computedData: 'abc', outcomeId: 14315 } as never)).rejects.toThrow(/either computedData alone/);
    await expect(cancelHlOutcomeOrder(client, { ...creds, outcomeId: 14315, coin: '#143150' } as never)).rejects.toThrow(/Missing orderId/);
    expect(() => resolveOutcomeWriteMode({ isBuy: false }, ['isBuy'])).not.toThrow();
    expect(resolveOutcomeWriteMode({ computedData: 'x' }, ['apiKey'])).toBe('prebuilt');
    expect(client.post).not.toHaveBeenCalled();
  });

  it('pre-built computedData is posted alone and the reply normalised', async () => {
    const r = await createHlOutcomeOrder(client, { computedData: 'deadbeef' });
    expect(client.post).toHaveBeenCalledWith('/v1/hl/outcome/create_order', { computedData: 'deadbeef' });
    expect(r.status).toBe('resting');
    expect(r.warnings[0]).toMatch(/did not validate/);
  });

  it('cancel: numeric oid and a coin of this market', async () => {
    client.post.mockResolvedValue(cancelled);
    await expect(cancelHlOutcomeOrder(client, { ...creds, outcomeId: 14315, coin: '#143150', orderId: 'abc' })).rejects.toThrow(/numeric Hyperliquid oid/);
    const r = await cancelHlOutcomeOrder(client, { ...creds, outcomeId: 14315, coin: '#143150', orderId: '4242' });
    expect(r.status).toBe('canceled');
    expect(decodeBody(client.post.mock.calls[0][1], ['string', 'string', 'string', 'string']).slice(1)).toEqual(['14315', '#143150', '4242']);
  });

  it('close: full exit sends an empty size, partial checks the position', async () => {
    client.post.mockResolvedValue(filled);
    const r = await closeHlOutcomeOrder(client, { ...creds, outcomeId: 14315, sideLabel: 'No', price: '0.86' });
    expect(r).toMatchObject({ status: 'filled', request: { size: 'all', full: true } });
    expect(decodeBody(client.post.mock.calls[0][1], ['string', 'string', 'string', 'string', 'bool', 'string']).slice(0, 5)).toEqual(['14315', '#143151', '0.86', '', false]);
    await expect(closeHlOutcomeOrder(client, { ...creds, outcomeId: 14315, sideLabel: 'No', price: '0.86', size: '95', managedAddress: MANAGED })).rejects.toThrow(/remaining position/);
  });

  it('getHlOutcomeAccountState joins the account with the live market', async () => {
    const s = await getHlOutcomeAccountState(client, { userAddress: MANAGED, outcomeId: 14315 });
    expect(s.market?.title).toMatch(/^ETH above/);
    expect(s.positions[0].markPrice).toBe(0.868175);
  });

  it('checkHlOutcomeCollateral reads HL spot available = total - hold', async () => {
    const info = jest.fn().mockResolvedValue({ balances: [{ coin: 'USDC', token: 0, total: '20.5', hold: '10.0', entryNtl: '0.0' }] });
    const c = await checkHlOutcomeCollateral({ managedAddress: MANAGED, quoteToken: 'USDC', size: '110', price: '0.1' }, info);
    expect(info).toHaveBeenCalledWith({ type: 'spotClearinghouseState', user: MANAGED });
    expect(c).toMatchObject({ available: 10.5, required: 11, sufficient: false });
  });
});
