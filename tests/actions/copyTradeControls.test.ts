/**
 * Copy-trade controls (GDX-15).
 *
 * The payloads are decoded with the exact ABI types the backend uses
 * (gbotTradingDashboardBackend src/shared/parser/evm/decoder.ts), so these
 * tests fail if the SDK ever drifts back to an encoding the backend reads as
 * "delete".
 */
import { AbiCoder } from 'ethers';
import type { GdexApiClient } from '../../src/client';
import * as Endpoints from '../../src/client/endpoints';
import {
  createCopyTrade,
  updateCopyTrade,
  updateCopyTradeSettings,
  deleteCopyTrade,
  pauseCopyTrade,
  resumeCopyTrade,
  resetCopyTradeToggleGuardForTests,
} from '../../src/actions/copyTrade';
import {
  createHlCopyTrade,
  updateHlCopyTrade,
  updateHlCopyTradeSettings,
  deleteHlCopyTrade,
  pauseHlCopyTrade,
  resumeHlCopyTrade,
} from '../../src/actions/hlCopyTrade';
import {
  decryptGdexComputedData,
  encodeCopyTradeData,
  encodeHlActionData,
  toAbiBool,
} from '../../src/utils/gdexManagedCrypto';
import { GdexErrorCode } from '../../src/types/common';
import { GdexError, GdexValidationError } from '../../src/utils/errors';

// ── Backend decode schemas (decoder.ts decodeInputData) ─────────────────────

const BACKEND_CREATE_COPY_TRADE = [
  'string', 'string', 'uint64', 'string', 'uint64', 'string',
  'bool', 'string', 'string', 'string', 'bool', 'uint64[]',
];
const BACKEND_UPDATE_COPY_TRADE = [
  'string', 'string', 'uint64', 'string', 'uint64', 'string',
  'bool', 'string', 'string', 'string', 'bool', 'bool', 'string', 'bool', 'uint64[]',
];
const BACKEND_HL_CREATE = ['string', 'string', 'uint64', 'string', 'string', 'string', 'string', 'bool'];
const BACKEND_HL_UPDATE = [
  'string', 'string', 'uint64', 'string', 'string', 'string', 'string', 'bool', 'bool', 'string', 'bool',
];

function decode(types: string[], hex: string): unknown[] {
  return Array.from(AbiCoder.defaultAbiCoder().decode(types, '0x' + hex));
}

/** Decrypt a posted computedData and decode it the way the backend does. */
function decodePosted(body: unknown, types: string[]): unknown[] {
  const { computedData } = body as { computedData: string };
  const inner = JSON.parse(decryptGdexComputedData(computedData, CREDS.apiKey)) as { data: string };
  return decode(types, inner.data);
}

/** Named view of a decoded update_copy_trade (ServiceCopyTrade.update indices). */
function solUpdateFields(d: unknown[]) {
  return {
    traderWallet: d[0], copyTradeName: d[1], chainId: Number(d[2]), gasPrice: d[3],
    buyMode: Number(d[4]), copyBuyAmount: d[5], isBuyExistingToken: d[6],
    lossPercent: d[7], profitPercent: d[8], isDelete: d[10], isChangeStatus: d[11],
    copyTradeId: d[12], copySell: d[13], excludedDexNumbers: (d[14] as bigint[]).map(Number),
  };
}

/** Named view of a decoded hl_update (ServiceHyperLiquid.update indices). */
function hlUpdateFields(d: unknown[]) {
  return {
    traderWallet: d[0], copyTradeName: d[1], copyMode: Number(d[2]),
    fixedAmountCostPerOrder: d[3], lossPercent: d[4], profitPercent: d[5],
    isDelete: d[7], isChangeStatus: d[8], copyTradeId: d[9], oppositeCopy: d[10],
  };
}

const CREDS = {
  apiKey: '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54', // gitleaks:allow (test fixture, not a real key)
  userId: '0xabcdef1234567890abcdef1234567890abcdef12',
  sessionPrivateKey: '0x' + 'ab'.repeat(32),
};

// ── Fixtures shaped like the backend list responses ─────────────────────────

/** GET /v1/copy_trade/list row: a lean CopyTradeSetting document. */
function solConfig(overrides: Record<string, unknown> = {}) {
  return {
    _id: '6650f0c2a1b2c3d4e5f60718',
    copyTradeId: 'sol-ct-1',
    copyTradeName: 'Alpha',
    buyMode: 1,
    chainId: 622112261,
    isActive: true,
    isBuyExistingToken: false,
    userId: CREDS.userId,
    userWallet: 'MngdSoLWaLLet1111111111111111111111111111111',
    traderWallet: 'TraderSoLWaLLet111111111111111111111111111111',
    copyBuyFixedAmount: '0.25',
    copyBuyPercent: 0,
    createdAt: 1760000000,
    profitPercent: 100,
    lossPercent: 50,
    gasPrice: '0',
    copySell: true,
    excludedProgramIds: [],
    excludedDexNumbers: [3],
    lastUpdated: 1760000100,
    ...overrides,
  };
}

/** GET /v1/hl/list row: a lean HLFuturesCopySetting document plus totals. */
function hlConfig(overrides: Record<string, unknown> = {}) {
  return {
    _id: '6650f0c2a1b2c3d4e5f60719',
    copyTradeId: 'hl-ct-1',
    copyTradeName: 'Whale',
    copyMode: 1,
    chainId: 1,
    isActive: true,
    userId: CREDS.userId,
    userWallet: '0x1111111111111111111111111111111111111111',
    traderWallet: '0x2222222222222222222222222222222222222222',
    lossPercent: 20,
    profitPercent: 40,
    fixedAmountCostPerOrder: '25',
    oppositeCopy: false,
    createdAt: 1760000000,
    lastUpdated: 1760000100,
    totalTrades: 3,
    totalVolumes: 750,
    totalPnl: 12.5,
    ...overrides,
  };
}

function mockClient(list: unknown) {
  const get = jest.fn().mockResolvedValue(list);
  const post = jest.fn().mockResolvedValue({ isSuccess: true, message: 'Updated' });
  return { client: { get, post } as unknown as GdexApiClient, get, post };
}

const ids = { ...CREDS, copyTradeId: 'sol-ct-1' };
const hlIds = { ...CREDS, copyTradeId: 'hl-ct-1' };

beforeEach(() => resetCopyTradeToggleGuardForTests());

// ── Boolean / empty serialization ───────────────────────────────────────────

describe('typed ABI serialization', () => {
  it('toAbiBool maps real and legacy forms and rejects garbage', () => {
    expect(toAbiBool(true)).toBe(true);
    expect(toAbiBool(false)).toBe(false);
    expect(toAbiBool(undefined)).toBe(false);
    expect(toAbiBool('')).toBe(false);
    expect(toAbiBool('0')).toBe(false);
    expect(toAbiBool('false')).toBe(false);
    expect(toAbiBool('1')).toBe(true);
    expect(toAbiBool('true')).toBe(true);
    expect(() => toAbiBool('yes')).toThrow();
    expect(() => toAbiBool(480)).toThrow();
  });

  it('update_copy_trade with all-false flags and empty lists decodes as false/[] on the backend', () => {
    const hex = encodeCopyTradeData('update_copy_trade', {
      traderWallet: 'T', copyTradeName: 'N', chainId: 622112261, gasPrice: '0',
      buyMode: 1, copyBuyAmount: '0.1', isBuyExistingToken: false, lossPercent: '10',
      profitPercent: '20', nonce: '123', isDelete: false, isChangeStatus: false,
      copyTradeId: 'id', copySell: false, excludedDexNumbers: [],
    });
    const f = solUpdateFields(decode(BACKEND_UPDATE_COPY_TRADE, hex));
    expect(f).toMatchObject({
      chainId: 622112261, buyMode: 1, isBuyExistingToken: false, isDelete: false,
      isChangeStatus: false, copyTradeId: 'id', copySell: false, excludedDexNumbers: [],
    });
  });

  it('legacy empty-string flags still decode as false (never as delete)', () => {
    const hex = encodeCopyTradeData('update_copy_trade', {
      traderWallet: 'T', copyTradeName: 'N', chainId: '622112261', buyMode: '2',
      copyBuyAmount: '50', isBuyExistingToken: '', lossPercent: '10', profitPercent: '20',
      nonce: '1', isDelete: '', isChangeStatus: '', copyTradeId: 'id', copySell: '1',
      excludedDexNumbers: '1,4',
    });
    const f = solUpdateFields(decode(BACKEND_UPDATE_COPY_TRADE, hex));
    expect(f.isDelete).toBe(false);
    expect(f.isChangeStatus).toBe(false);
    expect(f.copySell).toBe(true);
    expect(f.buyMode).toBe(2);
    expect(f.excludedDexNumbers).toEqual([1, 4]);
  });

  it('hl_update true/false flags land in the right slots', () => {
    const hex = encodeHlActionData('hl_update', {
      traderWallet: '0xT', copyTradeName: 'N', copyMode: 2, fixedAmountCostPerOrder: '0.5',
      lossPercent: '10', profitPercent: '20', nonce: '9', isDelete: false,
      isChangeStatus: true, copyTradeId: 'id', oppositeCopy: false,
    });
    expect(hlUpdateFields(decode(BACKEND_HL_UPDATE, hex))).toEqual({
      traderWallet: '0xT', copyTradeName: 'N', copyMode: 2, fixedAmountCostPerOrder: '0.5',
      lossPercent: '10', profitPercent: '20', isDelete: false, isChangeStatus: true,
      copyTradeId: 'id', oppositeCopy: false,
    });
  });

  it('rejects a non-integer uint64 instead of encoding an offset', () => {
    expect(() =>
      encodeHlActionData('hl_create', {
        traderWallet: '0xT', copyTradeName: 'N', copyMode: 'fixed', fixedAmountCostPerOrder: '1',
        lossPercent: '1', profitPercent: '1', nonce: '1', oppositeCopy: false,
      }),
    ).toThrow(/copyMode/);
  });

  it('createCopyTrade sends a payload the backend decodes with the requested values', async () => {
    const { client, post } = mockClient({});
    await createCopyTrade(client, {
      ...CREDS, chainId: 622112261, traderWallet: 'T', copyTradeName: 'N', buyMode: 2,
      copyBuyAmount: '40', lossPercent: '10', profitPercent: '20', copySell: false,
      isBuyExistingToken: true, excludedDexNumbers: [2],
    });
    expect(post.mock.calls[0][0]).toBe(Endpoints.COPY_TRADE_CREATE);
    const d = decodePosted(post.mock.calls[0][1], BACKEND_CREATE_COPY_TRADE);
    expect(Number(d[2])).toBe(622112261);
    expect(Number(d[4])).toBe(2);
    expect(d[6]).toBe(true);
    expect(d[10]).toBe(false);
    expect((d[11] as bigint[]).map(Number)).toEqual([2]);
  });

  it('createHlCopyTrade: copyMode decodes as 1, not an ABI offset; oppositeCopy false stays false', async () => {
    const { client, post } = mockClient({});
    await createHlCopyTrade(client, {
      ...CREDS, traderWallet: '0xT', copyTradeName: 'N', copyMode: 1,
      fixedAmountCostPerOrder: '25', lossPercent: '10', profitPercent: '20', oppositeCopy: false,
    });
    const d = decodePosted(post.mock.calls[0][1], BACKEND_HL_CREATE);
    expect(Number(d[2])).toBe(1);
    expect(d[7]).toBe(false);
  });

  it('legacy update with isDelete=false and isChangeStatus=false never deletes', async () => {
    const { client, post } = mockClient({});
    await updateHlCopyTrade(client, {
      ...hlIds, traderWallet: '0xT', copyTradeName: 'N', copyMode: 1,
      fixedAmountCostPerOrder: '25', lossPercent: '10', profitPercent: '20',
    });
    const f = hlUpdateFields(decodePosted(post.mock.calls[0][1], BACKEND_HL_UPDATE));
    expect(f.isDelete).toBe(false);
    expect(f.isChangeStatus).toBe(false);
    expect(f.copyMode).toBe(1);
  });

  it('legacy updates reject isDelete together with isChangeStatus', async () => {
    const { client, post } = mockClient({});
    await expect(updateCopyTrade(client, {
      ...ids, chainId: 622112261, traderWallet: 'T', copyTradeName: 'N', buyMode: 1,
      copyBuyAmount: '1', lossPercent: '1', profitPercent: '1', isDelete: true, isChangeStatus: true,
    })).rejects.toThrow(GdexValidationError);
    await expect(updateHlCopyTrade(client, {
      ...hlIds, traderWallet: '0xT', copyTradeName: 'N', copyMode: 1,
      fixedAmountCostPerOrder: '1', lossPercent: '1', profitPercent: '1', isDelete: true, isChangeStatus: true,
    })).rejects.toThrow(GdexValidationError);
    expect(post).not.toHaveBeenCalled();
  });
});

// ── Pause never deletes (regression) ────────────────────────────────────────

describe('pause / resume', () => {
  it('Solana pause sends isChangeStatus=true, isDelete=false and re-sends the stored config', async () => {
    const { client, get, post } = mockClient({ isSuccess: true, count: 1, allCopyTrades: [solConfig()], dexes: [] });
    const res = await pauseCopyTrade(client, ids);
    expect(get).toHaveBeenCalledWith(Endpoints.COPY_TRADE_LIST, expect.objectContaining({ userId: CREDS.userId }));
    expect(post.mock.calls[0][0]).toBe(Endpoints.COPY_TRADE_UPDATE);
    const f = solUpdateFields(decodePosted(post.mock.calls[0][1], BACKEND_UPDATE_COPY_TRADE));
    expect(f.isDelete).toBe(false);
    expect(f.isChangeStatus).toBe(true);
    expect(f).toMatchObject({
      traderWallet: solConfig().traderWallet, copyTradeName: 'Alpha', chainId: 622112261,
      buyMode: 1, copyBuyAmount: '0.25', lossPercent: '50', profitPercent: '100',
      copySell: true, isBuyExistingToken: false, excludedDexNumbers: [3], copyTradeId: 'sol-ct-1',
    });
    expect(res).toMatchObject({ operation: 'pause', submitted: true, previousIsActive: true, expectedIsActive: false });
    expect(res.note).toMatch(/stay open/);
  });

  it('HL pause sends isChangeStatus=true, isDelete=false', async () => {
    const { client, get, post } = mockClient({ isSuccess: true, count: 1, allCopyTrades: [hlConfig()] });
    const res = await pauseHlCopyTrade(client, hlIds);
    expect(get).toHaveBeenCalledWith(Endpoints.HL_COPY_LIST, expect.any(Object));
    const f = hlUpdateFields(decodePosted(post.mock.calls[0][1], BACKEND_HL_UPDATE));
    expect(f.isDelete).toBe(false);
    expect(f.isChangeStatus).toBe(true);
    expect(f).toMatchObject({ copyMode: 1, fixedAmountCostPerOrder: '25', oppositeCopy: false, lossPercent: '20' });
    expect(res.expectedIsActive).toBe(false);
  });

  it('already paused is a no-op (nothing posted)', async () => {
    const sol = mockClient({ isSuccess: true, count: 1, allCopyTrades: [solConfig({ isActive: false })], dexes: [] });
    const r1 = await pauseCopyTrade(sol.client, ids);
    expect(r1.submitted).toBe(false);
    expect(sol.post).not.toHaveBeenCalled();

    const hl = mockClient({ isSuccess: true, count: 1, allCopyTrades: [hlConfig({ isActive: false })] });
    const r2 = await pauseHlCopyTrade(hl.client, hlIds);
    expect(r2.submitted).toBe(false);
    expect(hl.post).not.toHaveBeenCalled();
  });

  it('resume of a paused config toggles; resume of an active config is a no-op', async () => {
    const paused = mockClient({ isSuccess: true, count: 1, allCopyTrades: [hlConfig({ isActive: false })] });
    const r = await resumeHlCopyTrade(paused.client, hlIds);
    expect(r).toMatchObject({ operation: 'resume', submitted: true, expectedIsActive: true });
    expect(hlUpdateFields(decodePosted(paused.post.mock.calls[0][1], BACKEND_HL_UPDATE)).isDelete).toBe(false);

    const active = mockClient({ isSuccess: true, count: 1, allCopyTrades: [solConfig()], dexes: [] });
    expect((await resumeCopyTrade(active.client, ids)).submitted).toBe(false);
    expect(active.post).not.toHaveBeenCalled();
  });

  it('unknown isActive -> PAUSE_STATE_UNVERIFIED, nothing posted', async () => {
    const { client, post } = mockClient({ isSuccess: true, count: 1, allCopyTrades: [solConfig({ isActive: undefined })], dexes: [] });
    await expect(pauseCopyTrade(client, ids)).rejects.toMatchObject({ code: GdexErrorCode.PAUSE_STATE_UNVERIFIED });
    expect(post).not.toHaveBeenCalled();
  });

  it('unreadable list -> PAUSE_STATE_UNVERIFIED', async () => {
    const { client, post } = mockClient({ isSuccess: false, count: 0 });
    await expect(pauseHlCopyTrade(client, hlIds)).rejects.toMatchObject({ code: GdexErrorCode.PAUSE_STATE_UNVERIFIED });
    expect(post).not.toHaveBeenCalled();
  });

  it('missing config -> COPY_TRADE_NOT_FOUND', async () => {
    const { client } = mockClient({ isSuccess: true, count: 1, allCopyTrades: [hlConfig({ copyTradeId: 'other' })] });
    await expect(pauseHlCopyTrade(client, hlIds)).rejects.toMatchObject({ code: GdexErrorCode.COPY_TRADE_NOT_FOUND });
  });

  it('legacy copyMode 480 -> PAUSE_UNSUPPORTED naming the delete alternative, nothing posted', async () => {
    const { client, post } = mockClient({ isSuccess: true, count: 1, allCopyTrades: [hlConfig({ copyMode: 480, oppositeCopy: true })] });
    const err = await pauseHlCopyTrade(client, hlIds).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GdexError);
    expect((err as GdexError).code).toBe(GdexErrorCode.PAUSE_UNSUPPORTED);
    expect((err as GdexError).message).toMatch(/deleteHlCopyTrade/);
    expect((err as GdexError).message).toMatch(/positions it opened stay open/);
    expect(post).not.toHaveBeenCalled();
  });

  it('a second Solana toggle inside the 20s list-cache window is refused', async () => {
    const { client, post } = mockClient({ isSuccess: true, count: 1, allCopyTrades: [solConfig()], dexes: [] });
    await pauseCopyTrade(client, ids);
    // The cached list still says active; a blind second toggle would resume it.
    await expect(pauseCopyTrade(client, ids)).rejects.toMatchObject({ code: GdexErrorCode.PAUSE_STATE_UNVERIFIED });
    expect(post).toHaveBeenCalledTimes(1);
  });
});

// ── Delete / settings ───────────────────────────────────────────────────────

describe('delete and update settings', () => {
  it('delete sets isDelete only', async () => {
    const sol = mockClient({ isSuccess: true, count: 1, allCopyTrades: [solConfig()], dexes: [] });
    const r = await deleteCopyTrade(sol.client, ids);
    const f = solUpdateFields(decodePosted(sol.post.mock.calls[0][1], BACKEND_UPDATE_COPY_TRADE));
    expect(f.isDelete).toBe(true);
    expect(f.isChangeStatus).toBe(false);
    expect(r.note).toMatch(/NOT sold/);

    const hl = mockClient({ isSuccess: true, count: 1, allCopyTrades: [hlConfig({ copyMode: 416 })] });
    const r2 = await deleteHlCopyTrade(hl.client, hlIds);
    const g = hlUpdateFields(decodePosted(hl.post.mock.calls[0][1], BACKEND_HL_UPDATE));
    expect(g.isDelete).toBe(true);
    expect(g.isChangeStatus).toBe(false);
    expect(r2.note).toMatch(/NOT closed/);
  });

  it('updateSettings keeps unspecified fields and never sets either flag', async () => {
    const { client, post } = mockClient({ isSuccess: true, count: 1, allCopyTrades: [solConfig()], dexes: [] });
    await updateCopyTradeSettings(client, { ...ids, lossPercent: '30' });
    const f = solUpdateFields(decodePosted(post.mock.calls[0][1], BACKEND_UPDATE_COPY_TRADE));
    expect(f).toMatchObject({ isDelete: false, isChangeStatus: false, lossPercent: '30', profitPercent: '100', copySell: true, buyMode: 1, copyBuyAmount: '0.25' });
  });

  it('updateSettings requires copyBuyAmount when buyMode changes', async () => {
    const { client, post } = mockClient({ isSuccess: true, count: 1, allCopyTrades: [solConfig()], dexes: [] });
    await expect(updateCopyTradeSettings(client, { ...ids, buyMode: 2 })).rejects.toThrow(GdexValidationError);
    expect(post).not.toHaveBeenCalled();
  });

  it('HL updateSettings repairs a legacy copyMode when given explicitly, and rejects it otherwise', async () => {
    const legacy = { isSuccess: true, count: 1, allCopyTrades: [hlConfig({ copyMode: 480, oppositeCopy: true })] };
    const bad = mockClient(legacy);
    await expect(updateHlCopyTradeSettings(bad.client, { ...hlIds, lossPercent: '15' }))
      .rejects.toMatchObject({ code: GdexErrorCode.COPY_TRADE_CONFIG_INVALID });
    expect(bad.post).not.toHaveBeenCalled();

    const good = mockClient(legacy);
    await updateHlCopyTradeSettings(good.client, { ...hlIds, copyMode: 1, oppositeCopy: false });
    const f = hlUpdateFields(decodePosted(good.post.mock.calls[0][1], BACKEND_HL_UPDATE));
    expect(f).toMatchObject({ copyMode: 1, oppositeCopy: false, isDelete: false, isChangeStatus: false });
  });
});
