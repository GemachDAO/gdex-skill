/**
 * Replay / challenge / invite tools end to end against stubbed Hyperliquid + GDEX:
 * account selection, preview == export, privacy of the shared message, invite opt-in,
 * Agent A → Agent B practice flow without any account, and feature flags.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'gdex-practice-'));
process.env.GDEX_HOME = home;

const { registerPracticeTools } = await import('../src/tools/practice.js');
const { createMockServer } = await import('./helpers.js');

const REF = 'acct_aaaaaaaaaaaa';
const REF2 = 'acct_bbbbbbbbbbbb';
const CONTROL = '0xA3288e03983A7C260419e348E897dd2533a31F9E';
const MANAGED = '0x1111111111111111111111111111111111111111';
const CODE = 'TestRefCode123456789';
const T0 = 1_793_800_000_000;

async function seed(ref: string, wallet = CONTROL) {
  await fs.mkdir(path.join(home, 'accounts'), { recursive: true });
  await fs.writeFile(path.join(home, 'accounts', `${ref}.json`), JSON.stringify({
    version: 1, accountRef: ref, walletAddress: wallet,
    controlPrivateKey: '0x' + '11'.repeat(32), sessionPrivateKey: '0x' + '22'.repeat(32), sessionKey: '0x02' + '33'.repeat(32),
    apiKey: 'k', source: 'key_file', createdAt: 0, sessionAt: Date.now(), sessionUsedAt: Date.now(),
    managed: { evm: MANAGED }, browserSession: { cookie: 'c', expiresAt: Date.now() + 3_600_000 },
  }));
}

const fills = [
  { coin: 'ETH', px: '2422.9', sz: '0.1032', side: 'A', time: T0, startPosition: '0.0', dir: 'Open Short', closedPnl: '0.0', oid: 11, tid: 501, fee: '0.237535', builderFee: '0.12502', feeToken: 'USDC' },
  { coin: 'ETH', px: '2349.4', sz: '0.1032', side: 'B', time: T0 + 82_800_000, startPosition: '-0.1032', dir: 'Close Short', closedPnl: '7.5852', oid: 12, tid: 502, fee: '0.230177', builderFee: '0.121229', feeToken: 'USDC' },
  { coin: 'SOL', px: '150', sz: '10', side: 'B', time: T0 + 90_000_000, startPosition: '0.0', dir: 'Open Long', closedPnl: '0.0', oid: 31, tid: 601, fee: '0.1', feeToken: 'USDC' },
  { coin: 'SOL', px: '155', sz: '4', side: 'A', time: T0 + 91_000_000, startPosition: '10', dir: 'Close Long', closedPnl: '20', oid: 32, tid: 602, fee: '0.1', feeToken: 'USDC' },
];
const orders = [
  { order: { coin: 'ETH', side: 'B', oid: 12, timestamp: T0, orderType: 'Take Profit Market', isTrigger: true, triggerPx: '2350.0', reduceOnly: true, origSz: '0.1032', limitPx: '0' }, status: 'filled', statusTimestamp: T0 + 82_800_000 },
  { order: { coin: 'ETH', side: 'B', oid: 13, timestamp: T0, orderType: 'Stop Market', isTrigger: true, triggerPx: '2471.4', reduceOnly: true, origSz: '0.1032', limitPx: '0' }, status: 'siblingFilledCanceled', statusTimestamp: T0 + 82_800_000 },
];
const hlInfo = jest.fn(async (body: any): Promise<unknown> => {
  switch (body.type) {
    case 'userFillsByTime': return fills;
    case 'historicalOrders': return orders;
    case 'userFunding': return [];
    case 'clearinghouseState': return { assetPositions: [{ position: { coin: 'SOL', szi: '6' } }] };
    case 'frontendOpenOrders': return [];
    default: throw new Error(`unexpected ${body.type}`);
  }
});

// Every SDK method is a stub; writes must never be touched by these tools.
const writes = ['hlCreateOrder', 'closePerpPosition', 'buyWithUsdc', 'sellToUsdc', 'requestHlReferralClaim', 'signInWithComputedData', 'hlCancelOrder'];
const sdk: any = {
  getManagedUser: jest.fn(async () => ({ refCode: CODE, referralSource: '' })),
  client: { get: jest.fn(async () => ({ isSuccess: true, refEarnable: 7.74, refEarned: 0, withdrawable: 7.74, totalReferralCountTier1: 7, totalReferralCountTier2: 0, claimHistorys: [{ status: false }] })) },
  setBrowserSession: jest.fn(), setSessionSigningKey: jest.fn(),
  ...Object.fromEntries(writes.map((w) => [w, jest.fn(async () => { throw new Error(`write ${w} called`); })])),
};
const deps = { sdk: () => sdk, hlInfo: hlInfo as any, now: () => T0 + 4 * 86_400_000 };

function tools(flags = { practice: true, invites: true }) {
  const { server, getTools } = createMockServer();
  // createMockServer captures (name, desc, schema, handler); these tools pass annotations too.
  (server as any).tool = jest.fn((...a: any[]) => getTools().set(a[0], { name: a[0], description: a[1], schema: a[2], handler: a[a.length - 1] }));
  registerPracticeTools(server, deps as any, flags);
  return getTools();
}
const call = async (t: Map<string, any>, name: string, p: Record<string, unknown>) => {
  const r = await t.get(name)!.handler(p);
  return { isError: r.isError === true, body: JSON.parse(r.content[0].text) };
};

beforeEach(async () => {
  jest.clearAllMocks();
  await fs.rm(path.join(home, 'accounts'), { recursive: true, force: true });
  await seed(REF);
});

describe('gdex_replay_trade', () => {
  it('asks which trade when several match, replays the latest on request', async () => {
    const t = tools();
    const list = await call(t, 'gdex_replay_trade', {});
    expect(list.body.needsChoice).toBe(true);
    expect(list.body.candidates.map((c: any) => [c.coin, c.state])).toEqual([['SOL', 'partial_close'], ['ETH', 'full_close']]);
    const eth = await call(t, 'gdex_replay_trade', { coin: 'ETH' });
    expect(eth.body.replay.state).toBe('full_close');
    expect(eth.body.text).toMatch(/Take-profit filled[\s\S]*flat \(fresh read\)[\s\S]*confirmed canceled/);
    expect(hlInfo).toHaveBeenCalledWith(expect.objectContaining({ type: 'userFillsByTime', user: MANAGED }));
  });

  it('asks which account when several are connected', async () => {
    await seed(REF2, '0xB3288e03983A7C260419e348E897dd2533a31F9E');
    const r = await call(tools(), 'gdex_replay_trade', { latest: true });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.body)).toMatch(/Several accounts/);
  });
});

describe('gdex_make_challenge', () => {
  const ethClose = 'ETH-501';

  it('preview and export are identical; export needs the matching token', async () => {
    const t = tools();
    const pv = await call(t, 'gdex_make_challenge', { closeId: ethClose });
    expect(pv.body.stage).toBe('preview');
    const bad = await call(t, 'gdex_make_challenge', { closeId: ethClose, confirmExport: true, exportToken: 'nope' });
    expect(bad.isError).toBe(true);
    const ex = await call(t, 'gdex_make_challenge', { closeId: ethClose, confirmExport: true, exportToken: pv.body.exportToken });
    expect(ex.body.message).toBe(pv.body.message);
  });

  it('keeps private data out of the shared message by default', async () => {
    const { body } = await call(tools(), 'gdex_make_challenge', { closeId: ethClose });
    // Check the readable text with the (opaque) capsule token removed, then the capsule's fields.
    const m: string = body.message.replace(/GDEX-CHALLENGE:[A-Za-z0-9_-]+/, '<capsule>');
    for (const secret of [CONTROL, MANAGED, '0.1032', '2422.9', '2349.4', '7.58', '7.13', 'ETH-501', 'acct_', String(T0).slice(0, 6), CODE, 'Nov 4']) {
      expect(m).not.toContain(secret);
    }
    expect(m).toMatch(/Practice only/);
    expect(m).toMatch(/inspired by a real GDEX trade/);
    expect(m).toMatch(/Run this challenge/);
    expect(m).toMatch(/npx @gemachdao\/gdex-mcp-server init/);
    expect(m).not.toMatch(/ref=/);
    expect(Object.keys(body.capsuleContents).sort()).toEqual(['kind', 'rules', 'scenario', 'source', 'v']);
  });

  it('includes the sender plan and invite only when asked, with a disclosure', async () => {
    const { body } = await call(tools(), 'gdex_make_challenge', { closeId: ethClose, includeSenderPlan: true, includeInvite: true });
    expect(body.capsuleContents).toMatchObject({ senderPlan: { targetPct: '3.0', stopPct: '2.0' }, invite: CODE });
    expect(body.message).toContain(`https://gdex.pro/?ref=${CODE}`);
    expect(body.message).toMatch(/I may earn a share of eligible fees/);
    expect(body.message).not.toMatch(/npx[^\n]*ref/); // no referral code in the install command
  });

  it('refuses to export a partial close', async () => {
    const r = await call(tools(), 'gdex_make_challenge', { closeId: 'SOL-601' });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.body)).toMatch(/partial_close.*stays private/);
  });

  it('standalone scenario needs no account', async () => {
    await fs.rm(path.join(home, 'accounts'), { recursive: true, force: true });
    const r = await call(tools(), 'gdex_make_challenge', { scenarioId: 'btc-long-target-vs-stop-01' });
    expect(r.body.stage).toBe('preview');
    expect(r.body.message).toMatch(/practice fixture \(synthetic tape\)/);
  });
});

describe('Agent A → Agent B', () => {
  it('B runs A\'s capsule in practice mode with no account and gets a debrief', async () => {
    const a = tools();
    const pv = await call(a, 'gdex_make_challenge', { closeId: 'ETH-501', includeSenderPlan: true, includeInvite: true });
    const ex = await call(a, 'gdex_make_challenge', { closeId: 'ETH-501', includeSenderPlan: true, includeInvite: true, confirmExport: true, exportToken: pv.body.exportToken });

    // Agent B: different machine, no accounts at all.
    await fs.rm(path.join(home, 'accounts'), { recursive: true, force: true });
    jest.clearAllMocks();
    const b = tools();
    const start = await call(b, 'gdex_run_challenge', { stage: 'start', capsule: ex.body.message });
    expect(start.body.mode).toBe('practice');
    expect(start.body.hiddenBars).toBe(24);
    expect(JSON.stringify(start.body)).not.toMatch(/"2470\.0"|"2338\.0"|"2485\.0"/);
    expect(start.body.notices.join(' ')).toMatch(/has not been used/);
    const done = await call(b, 'gdex_run_challenge', { stage: 'submit', capsule: ex.body.message, decision: { targetPct: '2.5', stopPct: '1.8' } });
    expect(done.body.plans.map((p: any) => [p.who, p.exit.reason])).toEqual([
      ['Your plan', 'stop_ambiguous_same_bar'], ['Baseline', 'target'], ["Sender's plan", 'target'],
    ]);
    expect(done.body.resultMessage).toMatch(/GDEX Agent Challenge result/);
    // No network, no SDK, no account
    expect(hlInfo).not.toHaveBeenCalled();
    for (const w of writes) expect(sdk[w]).not.toHaveBeenCalled();
    expect(sdk.getManagedUser).not.toHaveBeenCalled();
  });

  it('rejects malformed capsules and invalid decisions without scoring', async () => {
    const t = tools();
    expect((await call(t, 'gdex_run_challenge', { stage: 'start', capsule: 'GDEX-CHALLENGE:%%%' })).isError).toBe(true);
    const r = await call(t, 'gdex_run_challenge', { stage: 'submit', scenarioId: 'eth-short-target-vs-stop-01', decision: { targetPct: '50', stopPct: '1' } });
    expect(r.isError).toBe(true);
  });
});

describe('gdex_invite', () => {
  it('shows the existing code and states without applying anything', async () => {
    const { body } = await call(tools(), 'gdex_invite', {});
    expect(body.link).toBe(`https://gdex.pro/?ref=${CODE}`);
    expect(body.hyperliquid).toMatchObject({ referredDirect: 7, accruedUsd: 7.74, claimedUsd: 0, claimRequestsAwaitingPayout: 1 });
    expect(body.states).toMatch(/not paid/);
    expect(sdk.client.get).toHaveBeenCalledWith('/v1/hl_ref/info', expect.objectContaining({ userId: CONTROL }));
  });
});

describe('feature flags', () => {
  it('practice off removes practice tools; invites off removes the invite surface', () => {
    expect([...tools({ practice: false, invites: true }).keys()]).toEqual(['gdex_invite']);
    const noInv = tools({ practice: true, invites: false });
    expect(noInv.has('gdex_invite')).toBe(false);
    expect(noInv.get('gdex_make_challenge')!.schema).not.toHaveProperty('includeInvite');
    expect([...tools({ practice: false, invites: false }).keys()]).toEqual([]);
  });
});
