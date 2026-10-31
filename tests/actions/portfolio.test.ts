/**
 * Tests for managed portfolio reads.
 *
 * Fixtures follow the backend responses:
 * - /v1/portfolio → { holding: [{ amount, uiAmount, tokenInfo, holding, invested, pnlPercentage }] }
 *   (ServiceMain.ts:2723-2775; evmHelper.ts:967-1003, 1116-1158; solanaBalances.ts:280-310)
 * - /v1/user → { address, walletsByChain, balance, chainId, ... } (ServiceMain.ts:1151-1225)
 * - /v1/user_history → { tracks, tokenMap, nextCursor } (ServiceMain.ts:3127-3152; apiUtils.ts:11-65; models/track.ts)
 */
import { GdexApiClient } from '../../src/client';
import { getPortfolio, getBalances, getTradeHistory, getTradingFunds } from '../../src/actions/portfolio';
import { GdexApiError, GdexValidationError } from '../../src/utils/errors';
import { ChainId } from '../../src/types/common';
import { buildGdexReadSessionData } from '../../src/utils/gdexManagedCrypto';

jest.mock('../../src/client');
const MockedClient = GdexApiClient as jest.MockedClass<typeof GdexApiClient>;

const SESSION_PK = '0x' + '22'.repeat(32);
const API_KEY = 'test-api-key-00000000';
const USER = '0x1234567890123456789012345678901234567890';
const creds = { walletAddress: USER, sessionPrivateKey: SESSION_PK, apiKey: API_KEY };
const DATA = buildGdexReadSessionData(SESSION_PK, API_KEY);
const TOKEN = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

const EVM_PORTFOLIO = {
  holding: [
    {
      amount: '1500000',
      uiAmount: 1.5,
      tokenInfo: { address: TOKEN, symbol: 'USDC', name: 'USD Coin', decimals: 6, priceUsd: 1, priceNative: 0.0003 },
      holding: 0.00045,
      invested: 0.0005,
      pnlPercentage: -10,
      startTimestamp: 1700000000,
    },
    {
      amount: '123456789012345678901',
      uiAmount: 123.45678901234568,
      tokenInfo: { address: '0xabc0000000000000000000000000000000000001', symbol: 'BIG', name: 'Big', decimals: 18 },
    },
  ],
};

describe('portfolio (managed reads)', () => {
  let client: jest.Mocked<GdexApiClient>;

  beforeEach(() => {
    client = new MockedClient() as jest.Mocked<GdexApiClient>;
    client.get = jest.fn();
  });

  describe('getPortfolio', () => {
    it('reads /v1/portfolio with userId + encrypted session data + chainId', async () => {
      client.get = jest.fn().mockResolvedValue(EVM_PORTFOLIO);
      const p = await getPortfolio(client, { ...creds, chain: ChainId.BASE });
      expect(client.get).toHaveBeenCalledWith('/v1/portfolio', { userId: USER, data: DATA, chainId: 8453 });
      expect(p.status).toBe('ok');
      expect(p.mode).toBe('managed');
      expect(p.chainId).toBe(8453);
      expect(p.holdings).toBe(p.balances);
      expect(p.holdings[0]).toEqual({
        tokenAddress: TOKEN,
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        rawBalance: '1500000',
        balance: '1.5',
        priceUsd: '1',
        usdValue: '1.5',
        priceNative: '0.0003',
        valueNative: '0.00045',
        investedNative: '0.0005',
        pnlPercentage: -10,
        chain: 8453,
        chainId: 8453,
      });
      // raw stays exact past float precision
      expect(p.holdings[1].rawBalance).toBe('123456789012345678901');
      expect(p.holdings[1].balance).toBe('123.456789012345678901');
      // not every holding is priced, so no totals are invented
      expect(p.totalValueUsd).toBeUndefined();
      expect(p.totalValueNative).toBeUndefined();
    });

    it('passes an explicit session data value through and accepts userId', async () => {
      client.get = jest.fn().mockResolvedValue({ holding: [] });
      const p = await getPortfolio(client, { walletAddress: '', userId: USER, data: 'abcd', chain: 'solana' });
      expect(client.get).toHaveBeenCalledWith('/v1/portfolio', { userId: USER, data: 'abcd', chainId: ChainId.SOLANA });
      expect(p.holdings).toEqual([]);
    });

    it('normalizes Solana rows (numeric amount, string uiAmount)', async () => {
      client.get = jest.fn().mockResolvedValue({
        holding: [
          { amount: 2500000, uiAmount: '2.5', tokenInfo: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, symbol: 'USDC' } },
          // amount beyond 2^53: the exact uiAmount string is used
          { amount: 1.2345678901234567e22, uiAmount: '12345678901234.567890123', tokenInfo: { address: 'Mint111', decimals: 9 } },
        ],
      });
      const p = await getPortfolio(client, { ...creds, chain: 'solana' });
      expect(p.holdings[0].rawBalance).toBe('2500000');
      expect(p.holdings[1].rawBalance).toBe('12345678901234567890123');
    });

    it('rejects a public address query without a session', async () => {
      await expect(getPortfolio(client, { walletAddress: USER, chain: ChainId.BASE })).rejects.toThrow(/no public address-only holdings read/);
      expect(client.get).not.toHaveBeenCalled();
    });

    it('requires a chain and rejects chains the backend does not serve', async () => {
      await expect(getPortfolio(client, { ...creds } as never)).rejects.toThrow(GdexValidationError);
      await expect(getPortfolio(client, { ...creds, chain: ChainId.POLYGON })).rejects.toThrow(/not supported/);
      expect(client.get).not.toHaveBeenCalled();
    });

    it.each([
      ['legacy balances envelope', { totalValueUsd: '0', balances: [] }],
      ['null body', null],
      ['holding not an array', { holding: {} }],
      ['row without tokenInfo', { holding: [{ amount: '1' }] }],
      ['row without decimals', { holding: [{ amount: '1', tokenInfo: { address: TOKEN } }] }],
      ['row with a non-integer amount', { holding: [{ amount: 'abc', uiAmount: 1.5, tokenInfo: { address: TOKEN, decimals: 6 } }] }],
    ])('throws on a malformed response (%s) instead of returning zero', async (_n, body) => {
      client.get = jest.fn().mockResolvedValue(body);
      await expect(getPortfolio(client, { ...creds, chain: ChainId.BASE })).rejects.toThrow(GdexApiError);
    });

    it('propagates backend refusals (stale session)', async () => {
      client.get = jest.fn().mockRejectedValue(new GdexApiError('invalid params', 400, { code: 104, error: 'invalid params' }));
      await expect(getPortfolio(client, { ...creds, chain: ChainId.BASE })).rejects.toThrow('invalid params');
    });

    it('sums totals only when every holding is priced', async () => {
      client.get = jest.fn().mockResolvedValue({ holding: [EVM_PORTFOLIO.holding[0], EVM_PORTFOLIO.holding[0]] });
      const p = await getPortfolio(client, { ...creds, chain: ChainId.BASE });
      expect(p.totalValueUsd).toBe('3');
      expect(p.totalValueNative).toBe('0.0009');
    });
  });

  describe('getBalances', () => {
    it('returns holdings, optionally filtered case-insensitively on EVM', async () => {
      client.get = jest.fn().mockResolvedValue(EVM_PORTFOLIO);
      expect(await getBalances(client, { ...creds, chain: ChainId.BASE })).toHaveLength(2);
      const one = await getBalances(client, { ...creds, chain: ChainId.BASE, tokenAddress: TOKEN.toUpperCase().replace('0X', '0x') });
      expect(one).toHaveLength(1);
      expect(one[0].symbol).toBe('USDC');
    });

    it('distinguishes a verified empty wallet from a failed read', async () => {
      client.get = jest.fn().mockResolvedValue({ holding: [] });
      expect(await getBalances(client, { ...creds, chain: ChainId.BASE })).toEqual([]);
      client.get = jest.fn().mockResolvedValue({});
      await expect(getBalances(client, { ...creds, chain: ChainId.BASE })).rejects.toThrow(/Malformed/);
    });
  });

  describe('getTradingFunds', () => {
    it('reads the managed wallet native balance from /v1/user', async () => {
      client.get = jest.fn().mockResolvedValue({
        address: '0xManaged0000000000000000000000000000000001',
        walletsByChain: { evm: '0xManaged0000000000000000000000000000000001', solana: 'SoLManaged', sui: null },
        isNewUser: false,
        balance: 0.0123,
        chainId: '42161',
      });
      const f = await getTradingFunds(client, { ...creds, chain: ChainId.ARBITRUM });
      expect(client.get).toHaveBeenCalledWith('/v1/user', { userId: USER, data: DATA, chainId: 42161 });
      expect(f).toEqual({
        status: 'ok',
        mode: 'managed',
        userId: USER,
        chainId: 42161,
        address: '0xManaged0000000000000000000000000000000001',
        walletsByChain: { evm: '0xManaged0000000000000000000000000000000001', solana: 'SoLManaged', sui: null },
        nativeBalance: '0.0123',
        nativeSymbol: 'ETH',
        precision: 'approximate',
      });
    });

    it('throws when balance is missing', async () => {
      client.get = jest.fn().mockResolvedValue({ address: '0xM' });
      await expect(getTradingFunds(client, { ...creds, chain: ChainId.BASE })).rejects.toThrow(/Malformed \/v1\/user/);
    });
  });

  describe('getTradeHistory', () => {
    const TRACK = {
      chainId: 8453,
      walletAddress: '0xmanaged',
      userId: USER.toLowerCase(),
      nativePrice: 3000,
      txHash: '0xtx1',
      isBuy: true,
      isSuccess: true,
      isConfirmed: true,
      nativeAmount: '1000000000000000',
      tokenAmount: '3000000',
      token: TOKEN,
      tokenDecimals: 6,
      pair: '0xpair',
      timestamp: 1700000100,
    };

    it('reads /v1/user_history by control wallet with limit and cursor', async () => {
      client.get = jest.fn().mockResolvedValue({
        tracks: [TRACK, { ...TRACK, txHash: '0xtx2', isBuy: false, timestamp: 1700000050 }],
        tokenMap: { [TOKEN]: { address: TOKEN, symbol: 'USDC', decimals: 6 } },
        nextCursor: 1700000050,
      });
      const page = await getTradeHistory(client, { walletAddress: USER, chain: ChainId.BASE, limit: 2, cursor: 1700000200 });
      expect(client.get).toHaveBeenCalledWith('/v1/user_history', { chainId: 8453, user: USER, limit: 2, cursor: 1700000200 });
      expect(page.nextCursor).toBe(1700000050);
      expect(page.trades[0]).toEqual(expect.objectContaining({
        id: '0xtx1',
        type: 'buy',
        inputToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        outputToken: TOKEN,
        amountIn: '1000000000000000',
        amountOut: '3000000',
        tokenSymbol: 'USDC',
        tokenDecimals: 6,
        status: 'completed',
        timestamp: 1700000100,
      }));
      expect(page.trades[1]).toEqual(expect.objectContaining({ type: 'sell', inputToken: TOKEN, amountIn: '3000000', amountOut: '1000000000000000' }));
    });

    it('rejects filters the backend ignores', async () => {
      for (const extra of [{ page: 2 }, { startTime: 1 }, { endTime: 2 }, { limit: 51 }]) {
        await expect(getTradeHistory(client, { walletAddress: USER, chain: ChainId.BASE, ...extra })).rejects.toThrow(GdexValidationError);
      }
      await expect(getTradeHistory(client, { walletAddress: USER } as never)).rejects.toThrow(/chain is required/);
      expect(client.get).not.toHaveBeenCalled();
    });

    it('throws on a malformed history envelope', async () => {
      client.get = jest.fn().mockResolvedValue([]);
      await expect(getTradeHistory(client, { walletAddress: USER, chain: ChainId.BASE })).rejects.toThrow(/Malformed/);
    });
  });
});
