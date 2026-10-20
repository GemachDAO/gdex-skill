/**
 * Flow of funds: readiness from live balances, total-budget buys, adding money
 * (credit only from the wallet balance), withdrawals and sell half/all.
 * SDK and Hyperliquid reads are stubs.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'gdex-funds-'));
process.env.GDEX_HOME = home;

const intent = await import('../src/intent.js');
const funds = await import('../src/funds.js');

const REF = 'acct_0123456789ab';
const AERO = '0x940181a94A35A4569E4529A3CDfB74e38FD98631';
const EVM = '0x0405d2c012467cdf41b12010e15fa752e59fb40b';
const DEST = '0x1111111111111111111111111111111111111111';

async function seedAccount() {
  await fs.mkdir(path.join(home, 'accounts'), { recursive: true });
  await fs.writeFile(path.join(home, 'accounts', `${REF}.json`), JSON.stringify({
    version: 1, accountRef: REF, walletAddress: '0xA3288e03983A7C260419e348E897dd2533a31F9E',
    controlPrivateKey: '0x' + '11'.repeat(32), sessionPrivateKey: '0x' + '22'.repeat(32), sessionKey: '0x02' + '33'.repeat(32),
    apiKey: 'k', source: 'key_file', createdAt: 0, sessionAt: 0, managed: { evm: EVM, solana: '2f73mEr8eZyL7qcjQxiXhSzZsW5oJN7swcFE2XxYiVun' },
  }));
}

const row = (chainId: number, usdc: string, native = '0.001', dec = 6) => ({
  chainId, usdc, usdcRaw: String(BigInt(Math.round(Number(usdc) * 1e6)) * 10n ** BigInt(dec - 6)), usdcUsd: usdc, native, nativeSymbol: 'ETH', nativeUsd: native === '0' ? '0' : '2.5',
});

let clock = 1_800_000_000_000;
let chains: any[] = [];
let hlSpot: any = { balances: [{ coin: 'USDC', total: '0.0', hold: '0.0' }] };
let hlPerp: any = { marginSummary: { totalMarginUsed: '0.0', totalNtlPos: '0.0' }, assetPositions: [] };
const sdk: any = {
  getUsdcBalances: jest.fn(async () => ({ totalUsdc: '0', chains })),
  getUsdcTradeQuote: jest.fn(async () => ({ amountOutRaw: '1000000000000000000', tokenDecimals: 18, source: 'kyberswap', quotedAt: clock, feeIncluded: true })),
  estimateUsdcBridge: jest.fn(async (p: any) => ({ fromAmountRaw: String(BigInt(p.amountRaw) + 1_500_000n) })),
  transferToken: jest.fn(async () => ({ isSuccess: true, hash: '0xwithdraw' })),
  transferNative: jest.fn(async () => ({ isSuccess: true, hash: '0xnative' })),
  perpWithdraw: jest.fn(async () => ({ isSuccess: true })),
  getBalances: jest.fn(async () => [{ tokenAddress: AERO, rawBalance: '3000000000000000001', decimals: 18 }]),
  getHlClearinghouseStateAll: jest.fn(async () => ({})),
  getHlOpenOrdersAllForCopy: jest.fn(async () => []),
};
const hlInfo = jest.fn(async (body: any) => {
  if (body.type === 'spotClearinghouseState') return hlSpot;
  if (body.type === 'clearinghouseState') return hlPerp;
  throw new Error('unexpected');
});
const deps = { sdk: () => sdk, hlInfo, now: () => clock, sleep: async () => { clock += 10_000; } };

beforeEach(async () => {
  jest.clearAllMocks();
  chains = [row(8453, '0', '0.001'), row(42161, '10')];
  hlSpot = { balances: [{ coin: 'USDC', total: '0.0', hold: '0.0' }] };
  hlPerp = { marginSummary: { totalMarginUsed: '0.0', totalNtlPos: '0.0' }, assetPositions: [] };
  for (const d of ['previews', 'operations', 'policies']) await fs.rm(path.join(home, d), { recursive: true, force: true });
  await seedAccount();
});

const account = async () => (await import('../src/credentials.js')).loadAccount(REF);

describe('readiness', () => {
  it('a connected account with no money is unfunded, not ready', async () => {
    chains = [row(8453, '0', '0'), row(42161, '0', '0')];
    const s = await funds.fundsSummary(deps as any, await account(), []);
    expect(funds.readinessOf(s as any, [])).toMatchObject({ state: 'unfunded', next: expect.stringMatching(/gdex_add_funds/) });
  });

  it('failed balance reads are unreachable, never zero or ready', async () => {
    sdk.getUsdcBalances.mockRejectedValueOnce(new Error('503'));
    hlInfo.mockRejectedValue(new Error('timeout'));
    const s = await funds.fundsSummary(deps as any, await account(), []);
    expect((s as any).cash.status).toBe('unavailable');
    expect(funds.readinessOf(s as any, []).state).toBe('unreachable');
    hlInfo.mockReset();
    hlInfo.mockImplementation(async (body: any) => (body.type === 'spotClearinghouseState' ? hlSpot : hlPerp));
  });

  it('summarizes cash, Hyperliquid free USDC (minus hold and margin), positions and withdrawable', async () => {
    hlSpot = { balances: [{ coin: 'USDC', total: '218.45', hold: '10' }, { coin: '+1440', total: '25', hold: '0' }] };
    hlPerp = { marginSummary: { totalMarginUsed: '8.45', totalNtlPos: '16.9' }, assetPositions: [{}] };
    const s: any = await funds.fundsSummary(deps as any, await account(), []);
    expect(s.cash).toMatchObject({ status: 'ok', usdcTotal: '10.00' });
    expect(s.hyperliquid).toMatchObject({ usdc: '218.45', freeUsdcEstimate: '200.00', perpPositions: 1 });
    expect(s.inPositions).toMatchObject({ perpMarginUsd: '8.45', outcomeContracts: 1 });
    expect(funds.readinessOf(s, []).state).toBe('funded');
  });
});

describe('total budget', () => {
  const buy = (over: Record<string, unknown> = {}) => intent.previewTrade(deps as any, REF, { kind: 'spot', chain: 'base', tokenAddress: AERO, side: 'buy', amount: '20', ...over } as any);

  it('default "trade" budget shows the full signed cap as the total maximum debit ($20 -> 27.6)', async () => {
    const p = await buy();
    expect(p.terms).toMatchObject({ spendRaw: '20000000', maxSourceSpendUsdc: '27.6', totalMaxSpendUsdc: '27.6', budget: 'trade' });
    expect(p.summary).toMatch(/Total maximum debit: 27.6 USDC/);
  });

  it('"total" never signs more than the budget: routing cost comes out of the trade', async () => {
    clock += 31_000;
    const p = await buy({ budget: 'total' });
    expect(sdk.estimateUsdcBridge).toHaveBeenCalledWith(expect.objectContaining({ fromChainId: 42161, toChainId: 8453, amountRaw: '20000000' }));
    expect(p.terms).toMatchObject({ spendRaw: '18500000', maxSourceSpendRaw: '20000000', totalMaxSpendUsdc: '20' });
    expect(p.summary).toMatch(/Total maximum spend: 20 USDC/);
  });

  it('prices a gas top-up only when the destination has no gas', async () => {
    clock += 31_000;
    await buy({ budget: 'total' });
    expect(sdk.estimateUsdcBridge).toHaveBeenLastCalledWith(expect.objectContaining({ toChainId: 8453, gasTopUp: false }));
    clock += 31_000;
    chains = [row(8453, '0', '0'), row(42161, '30')];
    await buy({ budget: 'total' });
    expect(sdk.estimateUsdcBridge).toHaveBeenLastCalledWith(expect.objectContaining({ toChainId: 8453, gasTopUp: true }));
  });

  it('"total" uses the USDC already on the chain when routing a small shortfall costs more than it adds', async () => {
    clock += 31_000;
    chains = [row(8453, '19', '0.001'), row(42161, '10')];
    const p = await buy({ budget: 'total' });
    // shortfall 1 USDC, quote charges 1.5 to route it: 20 - 1.5 = 18.5 < 19 local
    expect(p.terms).toMatchObject({ spendRaw: '19000000', maxSourceSpendRaw: '20000000' });
    expect(p.warnings.join(' ')).toMatch(/already on this chain/);
    expect(p.warnings.join(' ')).not.toMatch(/will bridge/);
  });

  it('"total" with enough USDC and gas on the chain needs no routing', async () => {
    chains = [row(8453, '25', '0.001'), row(42161, '10')];
    const p = await buy({ budget: 'total' });
    expect(sdk.estimateUsdcBridge).not.toHaveBeenCalled();
    expect(p.terms).toMatchObject({ spendRaw: '20000000', maxSourceSpendRaw: '20000000' });
  });

  it('reuses a fresh bridge quote and retries once when Relay rate-limits back-to-back quotes', async () => {
    clock += 31_000;
    await buy({ budget: 'total' });
    await buy({ budget: 'total' });
    expect(sdk.estimateUsdcBridge).toHaveBeenCalledTimes(1);
    clock += 31_000;
    sdk.estimateUsdcBridge.mockRejectedValueOnce(new Error('Bridge quote unavailable (code RELAY_QUOTE_FAILED)'));
    const p = await buy({ budget: 'total' });
    expect(sdk.estimateUsdcBridge).toHaveBeenCalledTimes(3);
    expect(p.terms).toMatchObject({ spendRaw: '18500000' });
  });

  it('explains the shortfall when routing would eat the whole budget, and refuses when balances are unknown', async () => {
    clock += 31_000;
    sdk.estimateUsdcBridge.mockResolvedValueOnce({ fromAmountRaw: '45000000' });
    await expect(buy({ budget: 'total' })).rejects.toThrow(/does not cover routing/);
    sdk.getUsdcBalances.mockRejectedValueOnce(new Error('503'));
    await expect(buy({ budget: 'total' })).rejects.toThrow(/cannot be guaranteed/);
  });
});

describe('add money', () => {
  it('apple_pay: binds the GDEX wallet and USDC network, records a baseline, and resumes instead of a second payment', async () => {
    const r: any = await intent.addFunds(deps as any, REF, { method: 'apple_pay', chain: 'base', amountUsd: '50' });
    expect(r.destination).toMatchObject({ network: 'Base', asset: 'USDC', address: EVM, tokenAddress: funds.USDC_TOKENS[8453].address });
    expect(r.checkout.url).toContain(`walletAddress=${EVM}`);
    expect(r.checkout.steps.join(' ')).toMatch(/Apple Pay/);
    expect(r.operation).toMatchObject({ kind: 'funding', state: 'awaiting_user', detail: { baselineRaw: '0', chainId: 8453 } });
    const again: any = await intent.addFunds(deps as any, REF, { method: 'card' });
    expect(again).toMatchObject({ resumed: true, operation: { opId: r.operation.opId } });
    const second: any = await intent.addFunds(deps as any, REF, { method: 'crypto', newPayment: true });
    expect(second.operation.opId).not.toBe(r.operation.opId);
  });

  it('reports credited only once USDC is in the wallet; a timeout stays pending', async () => {
    const r: any = await intent.addFunds(deps as any, REF, { method: 'apple_pay' });
    let op = await intent.reconcileOperation(deps as any, r.operation.opId, 20_000);
    expect(op.state).toBe('awaiting_user');
    chains = [row(8453, '48.5', '0.001'), row(42161, '10')];
    op = await intent.reconcileOperation(deps as any, r.operation.opId, 20_000);
    expect(op).toMatchObject({ state: 'credited', detail: expect.objectContaining({ creditedRaw: '48500000' }) });
  });

  it('money leaving the wallet while waiting does not hide or shrink the arrival', async () => {
    chains = [row(8453, '5', '0.001'), row(42161, '10')];
    const r: any = await intent.addFunds(deps as any, REF, { method: 'crypto', chain: 'base' });
    chains = [row(8453, '4', '0.001'), row(42161, '10')]; // a 1 USDC withdrawal from the same wallet
    let op = await intent.reconcileOperation(deps as any, r.operation.opId, 10_000);
    expect(op).toMatchObject({ state: 'awaiting_user', detail: expect.objectContaining({ baselineRaw: '4000000' }) });
    chains = [row(8453, '24', '0.001'), row(42161, '10')];
    op = await intent.reconcileOperation(deps as any, r.operation.opId, 10_000);
    expect(op).toMatchObject({ state: 'credited', detail: expect.objectContaining({ creditedRaw: '20000000' }) });
  });

  it('expires after 48h without credit and says a late delivery still lands', async () => {
    chains = [...chains, row(622112261, '0', '0')];
    const r: any = await intent.addFunds(deps as any, REF, { method: 'crypto', chain: 'solana' });
    expect(r.destination.address).toBe('2f73mEr8eZyL7qcjQxiXhSzZsW5oJN7swcFE2XxYiVun');
    clock += 49 * 3600_000;
    const op = await intent.reconcileOperation(deps as any, r.operation.opId, 0);
    expect(op.state).toBe('expired');
    expect(op.history.at(-1)?.note).toMatch(/late delivery/);
  });

  it('refuses to start when the balance cannot be read (no baseline, no way to confirm credit)', async () => {
    sdk.getUsdcBalances.mockRejectedValueOnce(new Error('503'));
    await expect(intent.addFunds(deps as any, REF, { method: 'apple_pay' })).rejects.toThrow(/cannot be read/);
  });
});

describe('withdraw', () => {
  const withdraw = (over: Record<string, unknown> = {}) => intent.previewTrade(deps as any, REF, { kind: 'withdraw', from: 'wallet', chain: 'arbitrum', amount: '4', recipient: DEST, ...over } as any);

  it('previews destination, network and exact raw amount; validates the recipient and balance', async () => {
    const p = await withdraw();
    expect(p.terms).toMatchObject({ chainId: 42161, network: 'Arbitrum', amountRaw: '4000000', recipient: DEST, fromAddress: EVM });
    await expect(withdraw({ recipient: undefined })).rejects.toThrow(/never guess/);
    await expect(withdraw({ recipient: '0x123' })).rejects.toThrow(/not a valid EVM address/);
    await expect(withdraw({ amount: '11' })).rejects.toThrow(/Only 10 USDC/);
    expect((await withdraw({ amount: 'all' })).terms).toMatchObject({ amountRaw: '10000000' });
  });

  it('refuses a token transfer with no gas on the chain', async () => {
    chains = [row(42161, '10', '0')];
    await expect(withdraw()).rejects.toThrow(/No ETH for gas/);
  });

  it('a delegated policy never authorizes a withdrawal; user approval sends exactly the previewed transfer', async () => {
    await fs.mkdir(path.join(home, 'policies'), { recursive: true });
    await fs.writeFile(path.join(home, 'policies', `${REF}.json`), JSON.stringify({ expiresAt: new Date(clock + 86_400_000).toISOString(), maxTradeUsd: 1000 }));
    const p = await withdraw();
    expect(await intent.executeTrade(deps as any, p.previewId, false)).toMatchObject({ status: 'denied' });
    expect(sdk.transferToken).not.toHaveBeenCalled();
    const r: any = await intent.executeTrade(deps as any, p.previewId, true);
    expect(sdk.transferToken).toHaveBeenCalledWith(expect.objectContaining({ recipient: DEST, amount: '4000000', chainId: 42161, tokenAddress: funds.USDC_TOKENS[42161].address, managed: expect.objectContaining({ userId: '0xA3288e03983A7C260419e348E897dd2533a31F9E' }) }));
    expect(r.operation).toMatchObject({ kind: 'withdraw', state: 'filled', hash: '0xwithdraw' });
  });

  it('Hyperliquid: only free USDC, fee shown, arrival confirmed on the Arbitrum wallet', async () => {
    hlSpot = { balances: [{ coin: 'USDC', total: '30', hold: '5' }] };
    hlPerp = { marginSummary: { totalMarginUsed: '5' } };
    await expect(intent.previewTrade(deps as any, REF, { kind: 'withdraw', from: 'hyperliquid', amount: '25' } as any)).rejects.toThrow(/Only ~20.00 USDC is free/);
    const p = await intent.previewTrade(deps as any, REF, { kind: 'withdraw', from: 'hyperliquid', amount: '20' } as any);
    expect(p.terms).toMatchObject({ amount: '20', fee: '1', arriving: '19.0', network: 'Arbitrum' });
    const r: any = await intent.executeTrade(deps as any, p.previewId, true);
    expect(sdk.perpWithdraw).toHaveBeenCalledWith(expect.objectContaining({ amount: '20' }));
    expect(r.operation.state).toBe('accepted');
    let op = await intent.reconcileOperation(deps as any, r.operation.opId, 10_000);
    expect(op.state).toBe('accepted');
    chains = [row(8453, '0'), row(42161, '29')];
    op = await intent.reconcileOperation(deps as any, r.operation.opId, 10_000);
    expect(op.state).toBe('filled');
  });
});

describe('sell half / all and daily caps', () => {
  it('resolves half and all against the actual raw holding', async () => {
    expect(await intent.resolveSellAmount(deps as any, REF, 'base', AERO, 'half')).toBe('1.5');
    expect(await intent.resolveSellAmount(deps as any, REF, 'base', AERO, 'all')).toBe('3.000000000000000001');
    await expect(intent.resolveSellAmount(deps as any, REF, 'base', AERO, 'most')).rejects.toThrow(/"all", "half"/);
  });

  it('funding and withdrawals do not count against the daily trading cap', async () => {
    await intent.addFunds(deps as any, REF, { method: 'crypto' });
    const p = await intent.previewTrade(deps as any, REF, { kind: 'withdraw', from: 'wallet', chain: 'arbitrum', amount: '4', recipient: DEST } as any);
    await intent.executeTrade(deps as any, p.previewId, true);
    await fs.mkdir(path.join(home, 'policies'), { recursive: true });
    await fs.writeFile(path.join(home, 'policies', `${REF}.json`), JSON.stringify({ expiresAt: new Date(clock + 86_400_000).toISOString(), maxTradeUsd: 30, maxDailyUsd: 25 }));
    const buy = await intent.previewTrade(deps as any, REF, { kind: 'spot', chain: 'base', tokenAddress: AERO, side: 'buy', amount: '20' });
    expect((await intent.checkAuthority(deps as any, buy, false)).ok).toBe(true);
  });
});
