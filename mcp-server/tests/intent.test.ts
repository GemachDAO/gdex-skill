/**
 * Intent layer: preview terms, authority (user approval vs delegated policy),
 * revalidation, the operation journal and reconciliation. SDK and market data are stubs.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'gdex-intent-'));
process.env.GDEX_HOME = home;

const intent = await import('../src/intent.js');
const { GdexSubmissionUnknownError } = await import('@gemachdao/gdex-skill');

const REF = 'acct_0123456789ab';
const TOKEN = '0x940181a94A35A4569E4529A3CDfB74e38FD98631';

async function seedAccount() {
  await fs.mkdir(path.join(home, 'accounts'), { recursive: true });
  await fs.writeFile(path.join(home, 'accounts', `${REF}.json`), JSON.stringify({
    version: 1, accountRef: REF, walletAddress: '0xA3288e03983A7C260419e348E897dd2533a31F9E',
    controlPrivateKey: '0x' + '11'.repeat(32), sessionPrivateKey: '0x' + '22'.repeat(32), sessionKey: '0x02' + '33'.repeat(32),
    apiKey: 'k', source: 'key_file', createdAt: 0, sessionAt: 0, managed: { evm: '0xmanaged', solana: 'Sol' },
  }));
}

let clock = 1_800_000_000_000;
let quoteOut = '1276000000000000000';
const sdk: any = {
  getUsdcTradeQuote: jest.fn(async (p: any) => ({ amountOutRaw: p.side === 'sell' ? '980000' : quoteOut, tokenDecimals: 18, source: 'kyberswap', quotedAt: clock, feeIncluded: true })),
  getTokenDetails: jest.fn(async () => ({ decimals: 18 })),
  buyWithUsdc: jest.fn(async () => ({ status: 'pending', requestId: 'req-1' })),
  sellToUsdc: jest.fn(async () => ({ status: 'success', requestId: 'req-2', hash: '0xsell' })),
  hlCreateOrder: jest.fn(async () => ({ isSuccess: true, orderId: '9' })),
  resolvePerpClose: jest.fn(async () => ({ coin: 'BTC', dex: '', positionSide: 'short', closeSide: 'buy', isLong: true, positionSize: '0.002', size: '0.002' })),
  closePerpPosition: jest.fn(async () => ({ coin: 'BTC', size: '0.002', order: { isSuccess: true } })),
  getUsdcPendingTrades: jest.fn(async () => ({ pending: [{ requestId: 'req-found', tokenAddress: TOKEN, side: 'buy' }] })),
  watchUsdcTrade: jest.fn(async () => ({ outcome: 'success', hash: '0xbuy', steps: [] })),
  getUsdcBalances: jest.fn(async () => ({ totalUsdc: '10', chains: [] })),
  getHlClearinghouseStateAll: jest.fn(async () => { throw new Error('503'); }),
  getHlOpenOrdersAllForCopy: jest.fn(async () => []),
  getHlClearinghouseState: jest.fn(async () => ({ state: { assetPositions: [] } })),
};
const hlInfo = jest.fn(async (body: any) => [
  { universe: [{ name: body.dex ? `${body.dex}:TSLA` : 'BTC', szDecimals: body.dex ? 3 : 5, maxLeverage: body.dex ? 10 : 40 }] },
  [{ markPx: body.dex ? '400' : '100000' }],
]);
const deps = { sdk: () => sdk, hlInfo, now: () => clock };

const buy = (over: Record<string, unknown> = {}) => intent.previewTrade(deps, REF, { kind: 'spot', chain: 'base', tokenAddress: TOKEN, side: 'buy', amount: '5', ...over } as any);

beforeEach(async () => {
  jest.clearAllMocks();
  quoteOut = '1276000000000000000';
  for (const d of ['previews', 'operations', 'policies']) await fs.rm(path.join(home, d), { recursive: true, force: true });
  await seedAccount();
});

describe('preview', () => {
  it('spot buy: exact raw amounts, slippage floor, signed funding cap, 60s expiry', async () => {
    const p = await buy();
    expect(p.terms).toMatchObject({ chainId: 8453, spendRaw: '5000000', expectedOutRaw: '1276000000000000000', minOutRaw: '1263240000000000000', maxSourceSpendRaw: '9600000', autoFunding: true });
    expect(p.expiresAt - p.createdAt).toBe(60_000);
    expect(p.warnings.join(' ')).toMatch(/never more than 9.6 USDC/);
  });

  it('rejects chains without USDC and malformed amounts before quoting', async () => {
    await expect(buy({ chain: 4663 })).rejects.toThrow(/No USDC/);
    await expect(buy({ amount: '1abc' })).rejects.toThrow();
    expect(sdk.getUsdcTradeQuote).not.toHaveBeenCalled();
  });

  it('perp open: refuses ambiguous $ amounts, sizes down to szDecimals, enforces max leverage and $11 minimum', async () => {
    await expect(intent.previewTrade(deps, REF, { kind: 'perp_open', coin: 'BTC', side: 'long', leverage: 2 } as any)).rejects.toThrow(/exactly one of notionalUsd/);
    const p = await intent.previewTrade(deps, REF, { kind: 'perp_open', coin: 'BTC', side: 'long', notionalUsd: '100', leverage: 2 });
    expect(p.terms).toMatchObject({ size: '0.00100', isLong: true, marginMode: 'cross', leverage: 2, marginUsd: '50.00' });
    await expect(intent.previewTrade(deps, REF, { kind: 'perp_open', coin: 'BTC', side: 'long', notionalUsd: '100', leverage: 41 })).rejects.toThrow(/at most 40x/);
    await expect(intent.previewTrade(deps, REF, { kind: 'perp_open', coin: 'BTC', side: 'long', notionalUsd: '5', leverage: 2 })).rejects.toThrow(/at least \$11/);
    const b = await intent.previewTrade(deps, REF, { kind: 'perp_open', coin: 'xyz:TSLA', side: 'short', marginUsd: '20', leverage: 3 });
    expect(b.terms).toMatchObject({ coin: 'xyz:TSLA', dex: 'xyz', size: '0.150', isLong: false, marginMode: 'isolated' });
  });

  it('perp close reads the live position on the managed wallet', async () => {
    const p = await intent.previewTrade(deps, REF, { kind: 'perp_close', coin: 'BTC' });
    expect(sdk.resolvePerpClose.mock.calls[0][0]).toMatchObject({ coin: 'BTC', positionAddress: '0xmanaged' });
    expect(p.summary).toMatch(/Close 0.002 of short BTC .*market buy/);
  });
});

describe('authority and execution', () => {
  it('denies without user approval or policy, and never submits', async () => {
    const p = await buy();
    const r = await intent.executeTrade(deps, p.previewId, false);
    expect(r.status).toBe('denied');
    expect(sdk.buyWithUsdc).not.toHaveBeenCalled();
  });

  it('executes an approved preview with exactly the previewed terms and journals before submit', async () => {
    const p = await buy();
    const r: any = await intent.executeTrade(deps, p.previewId, true);
    expect(r.status).toBe('submitted');
    expect(sdk.buyWithUsdc.mock.calls[0][0]).toMatchObject({ chainId: 8453, usdcAmountRaw: '5000000', minTokenOutRaw: '1263240000000000000', autoBridge: true, maxSourceSpendRaw: '9600000' });
    expect(r.operation.history.map((h: any) => h.state)).toEqual(['submitting', 'accepted']);
    expect(r.operation.requestId).toBe('req-1');
    await expect(intent.executeTrade(deps, p.previewId, true)).rejects.toThrow(/already executed/);
    expect(sdk.buyWithUsdc).toHaveBeenCalledTimes(1);
  });

  it('returns a revised preview when the price moved below the approved minimum', async () => {
    const p = await buy();
    quoteOut = '1000000000000000000';
    const r: any = await intent.executeTrade(deps, p.previewId, true);
    expect(r.status).toBe('revised');
    expect(r.preview.previewId).not.toBe(p.previewId);
    expect(sdk.buyWithUsdc).not.toHaveBeenCalled();
  });

  it('returns a revised preview when expired', async () => {
    const p = await buy();
    clock += 61_000;
    const r: any = await intent.executeTrade(deps, p.previewId, true);
    expect(r.status).toBe('revised');
    expect(sdk.buyWithUsdc).not.toHaveBeenCalled();
  });

  it('rejects a tampered preview file', async () => {
    const p = await buy();
    const f = path.join(home, 'previews', `${p.previewId}.json`);
    const j = JSON.parse(await fs.readFile(f, 'utf8'));
    j.terms.minOutRaw = '1';
    await fs.writeFile(f, JSON.stringify(j));
    await expect(intent.executeTrade(deps, p.previewId, true)).rejects.toThrow(/modified/);
  });

  it('delegated policy: allows within limits, denies over trade size, daily cap (counting pending) and bridging', async () => {
    await fs.mkdir(path.join(home, 'policies'), { recursive: true });
    const write = (pol: object) => fs.writeFile(path.join(home, 'policies', `${REF}.json`), JSON.stringify({ expiresAt: new Date(clock + 3_600_000).toISOString(), ...pol }));
    await write({ maxTradeUsd: 10, maxDailyUsd: 8 });
    expect((await intent.executeTrade(deps, (await buy()).previewId, false)).status).toBe('submitted');
    const second: any = await intent.executeTrade(deps, (await buy()).previewId, false);
    expect(second.status).toBe('denied');
    expect(second.reasons.join()).toMatch(/Daily total \$10.00/);
    await write({ maxTradeUsd: 4 });
    expect(((await intent.executeTrade(deps, (await buy()).previewId, false)) as any).reasons.join()).toMatch(/exceeds policy maxTradeUsd/);
    await write({ maxTradeUsd: 10, allowBridging: false });
    expect(((await intent.executeTrade(deps, (await buy()).previewId, false)) as any).reasons.join()).toMatch(/forbids bridging/);
    await write({ maxTradeUsd: 10, expiresAt: new Date(clock - 1).toISOString() });
    expect(((await intent.executeTrade(deps, (await buy()).previewId, false)) as any).reasons.join()).toMatch(/expired/);
  });

  it('an ambiguous submit becomes submission_unknown and reconciliation finds it without resending', async () => {
    sdk.buyWithUsdc.mockRejectedValueOnce(new GdexSubmissionUnknownError('outcome unknown (503)', 'POST', '/usdc/trade/purchase_v2', 503));
    const p = await buy();
    const r: any = await intent.executeTrade(deps, p.previewId, true);
    expect(r.operation.state).toBe('submission_unknown');
    const op = await intent.reconcileOperation(deps, r.operation.opId, 1000);
    expect(op.state).toBe('filled');
    expect(op.requestId).toBe('req-found');
    expect(op.hash).toBe('0xbuy');
    expect(sdk.buyWithUsdc).toHaveBeenCalledTimes(1);
  });

  it('perp open executes with the market margin mode and previewed size and leverage', async () => {
    const p = await intent.previewTrade(deps, REF, { kind: 'perp_open', coin: 'BTC', side: 'short', notionalUsd: '100', leverage: 3 });
    await intent.executeTrade(deps, p.previewId, true);
    expect(sdk.hlCreateOrder.mock.calls[0][0]).toMatchObject({ coin: 'BTC', isLong: false, size: '0.00100', price: '100000', isMarket: true, marginMode: 'cross', leverage: 3, reduceOnly: false });
  });

  it('perp operations resolve to filled from the live position change (open, then close)', async () => {
    let szi = '0';
    sdk.getHlClearinghouseState.mockImplementation(async () => ({ state: { assetPositions: szi === '0' ? [] : [{ position: { coin: 'BTC', szi, leverage: { type: 'cross', value: 2 } } }] } }));
    const open: any = await intent.executeTrade(deps, (await intent.previewTrade(deps, REF, { kind: 'perp_open', coin: 'BTC', side: 'long', notionalUsd: '100', leverage: 2 })).previewId, true);
    expect(open.operation.state).toBe('accepted');
    expect(open.operation.detail.preSzi).toBe('0');
    expect((await intent.reconcileOperation(deps, open.operation.opId, 1)).state).toBe('accepted');
    szi = '0.001';
    const filled = await intent.reconcileOperation(deps, open.operation.opId, 1);
    expect(filled.state).toBe('filled');
    expect((filled.detail as any).effective).toEqual({ marginMode: 'cross', leverage: 2 });
    sdk.resolvePerpClose.mockResolvedValueOnce({ coin: 'BTC', dex: '', positionSide: 'long', closeSide: 'sell', isLong: false, positionSize: '0.001', size: '0.001' });
    const close: any = await intent.executeTrade(deps, (await intent.previewTrade(deps, REF, { kind: 'perp_close', coin: 'BTC' })).previewId, true);
    expect(close.operation.detail.preSzi).toBe('0.001');
    szi = '0';
    expect((await intent.reconcileOperation(deps, close.operation.opId, 1)).state).toBe('filled');
  });

  it('a rejected perp order is failed, not pending', async () => {
    sdk.hlCreateOrder.mockResolvedValueOnce({ isSuccess: false, message: 'Insufficient margin' });
    const r: any = await intent.executeTrade(deps, (await intent.previewTrade(deps, REF, { kind: 'perp_open', coin: 'BTC', side: 'long', notionalUsd: '100', leverage: 2 })).previewId, true);
    expect(r.operation.state).toBe('failed');
  });
});

describe('positions', () => {
  it('marks a failed read unavailable instead of empty', async () => {
    const r: any = await intent.positions(deps, REF);
    expect(r.usdcWallet.status).toBe('ok');
    expect(r.perps).toMatchObject({ status: 'unavailable', error: '503' });
  });
});
