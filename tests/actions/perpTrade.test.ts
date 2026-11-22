/**
 * Tests for perpetual trading actions (HyperLiquid managed custody).
 */
import { GdexApiClient } from '../../src/client';
import {
  getHlAccountState,
  getPerpPositions,
  getHlMarkPrice,
  getHlUsdcBalance,
  getHlOpenOrders,
  getGbotUsdcBalance,
  perpDeposit,
  perpWithdraw,
  hlCreateOrder,
  hlPlaceOrder,
  hlClosePosition,
  hlModifyOrder,
  hlAddPositionTpsl,
  resolvePerpClose,
  closePerpPosition,
  hlCloseAll,
  hlCancelOrder,
  hlCancelAllOrders,
  hlUpdateLeverage,
  getHlAllMids,
  getHlTradeHistory,
  getHlTraderLeverageContext,
  getHlSpotState,
  hlExecuteCrossPerp,
  hlExecuteIsolatedPerp,
  hlExecuteSpot,
  hlDirectCancelOrder,
} from '../../src/actions/perpTrade';
import { GdexValidationError } from '../../src/utils/errors';
import * as crypto from '../../src/utils/gdexManagedCrypto';
import { HlInfoMock, installHlInfoMock } from '../helpers/hlInfoMock';

jest.mock('../../src/client');
jest.mock('../../src/utils/hlInfo');
jest.mock('../../src/utils/gdexManagedCrypto', () => {
  const actual = jest.requireActual('../../src/utils/gdexManagedCrypto');
  return {
    ...actual,
    buildHlComputedData: jest.fn().mockReturnValue('mock-computed-data'),
  };
});

const MockedClient = GdexApiClient as jest.MockedClass<typeof GdexApiClient>;

// Access the mock HyperLiquidTrading instance from the global module mock
function getMockTrader() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { __mockTrader } = require('@gdexsdk/hyper-liquid-trader');
  return __mockTrader;
}

const TEST_CREDS = {
  apiKey: 'test-api-key-00000000',
  walletAddress: '0x1234567890123456789012345678901234567890',
  sessionPrivateKey: 'a'.repeat(64),
};

describe('perpTrade', () => {
  let client: jest.Mocked<GdexApiClient>;
  let hlInfo: HlInfoMock;

  beforeEach(() => {
    client = new MockedClient() as jest.Mocked<GdexApiClient>;
    hlInfo = installHlInfoMock();
    // Re-set mock return values after jest's resetMocks clears them
    (crypto.buildHlComputedData as jest.Mock).mockReturnValue('mock-computed-data');
    const hl = require('@gdexsdk/hyper-liquid-trader');
    hl.HyperLiquidTrading.mockImplementation(() => hl.__mockTrader);
    const mock = hl.__mockTrader;
    mock.getAccountState.mockResolvedValue({
      marginSummary: { accountValue: '0', totalNtlPos: '0', totalRawUsd: '0', totalMarginUsed: '0' },
      assetPositions: [],
    });
    mock.getMidPrice.mockResolvedValue(0);
    mock.getAllMids.mockResolvedValue({});
    mock.getBalance.mockResolvedValue(0);
    mock.getOpenOrders.mockResolvedValue([]);
    mock.getTradeHistory.mockResolvedValue([]);
    mock.getSpotState.mockResolvedValue(undefined);
    mock.getTraderLeverageContext.mockResolvedValue(undefined);
    mock.executeCrossPerp.mockResolvedValue({ status: 'ok' });
    mock.executeIsolatedPerp.mockResolvedValue({ status: 'ok' });
    mock.executeSpot.mockResolvedValue({ status: 'ok' });
    mock.cancelOrder.mockResolvedValue({ status: 'ok' });
  });

  // ── Read operations (HyperLiquid info API) ──────────────────────────────────────

  describe('getHlAccountState', () => {
    it('should return account state with positions', async () => {
      const mockState = {
        marginSummary: {
          accountValue: '1000.50',
          totalNtlPos: '500.00',
          totalRawUsd: '1000.50',
          totalMarginUsed: '50.00',
        },
        assetPositions: [
          {
            position: {
              coin: 'BTC',
              szi: '0.001',
              entryPx: '100000',
              leverage: { value: 10 },
              liquidationPx: '90000',
              unrealizedPnl: '5.00',
              marginUsed: '10.00',
              positionValue: '100.00',
            },
          },
        ],
      };
      hlInfo.setState(mockState);

      const state = await getHlAccountState('0x1234');

      expect(hlInfo.calls).toEqual([{ type: 'clearinghouseState', user: '0x1234' }]);
      expect(state.accountValue).toBe('1000.50');
      expect(state.withdrawable).toBe('950.5');
      expect(state.positions).toHaveLength(1);
      expect(state.positions[0].coin).toBe('BTC');
      expect(state.positions[0].side).toBe('long');
      expect(state.positions[0].size).toBe('0.001');
      expect(state.positions[0].leverage).toBe(10);
    });

    it('should map short positions correctly', async () => {
      const mockState = {
        marginSummary: {
          accountValue: '500',
          totalNtlPos: '200',
          totalRawUsd: '500',
          totalMarginUsed: '20',
        },
        assetPositions: [
          {
            position: {
              coin: 'ETH',
              szi: '-2.5',
              entryPx: '3000',
              leverage: { value: 5 },
              liquidationPx: '3500',
              unrealizedPnl: '-100',
              marginUsed: '150',
              positionValue: '7500',
            },
          },
        ],
      };
      hlInfo.setState(mockState);

      const state = await getHlAccountState('0xabcd');
      expect(state.positions[0].side).toBe('short');
      expect(state.positions[0].size).toBe('2.5');
    });

    it('should return empty state when HyperLiquid returns no state', async () => {
      hlInfo.setState(null);

      const state = await getHlAccountState('0x1234');
      expect(state.accountValue).toBe('0');
      expect(state.positions).toHaveLength(0);
    });

    it('should throw for empty walletAddress', async () => {
      await expect(getHlAccountState('')).rejects.toThrow(GdexValidationError);
    });

    it('surfaces a failed read instead of reporting an empty account', async () => {
      hlInfo.fail('clearinghouseState');
      await expect(getHlAccountState('0x1234')).rejects.toThrow(/clearinghouseState/);
    });

    it('never loads the trader package for a read', async () => {
      const hl = require('@gdexsdk/hyper-liquid-trader');
      await getHlAccountState('0x1234');
      await getHlMarkPrice('BTC');
      await getHlAllMids();
      expect(hl.HyperLiquidTrading).not.toHaveBeenCalled();
    });
  });

  describe('getPerpPositions', () => {
    it('should return all positions', async () => {
      const mockState = {
        marginSummary: { accountValue: '100', totalNtlPos: '0', totalRawUsd: '100', totalMarginUsed: '0' },
        assetPositions: [
          { position: { coin: 'BTC', szi: '0.01', entryPx: '100000', leverage: { value: 10 }, liquidationPx: null, unrealizedPnl: '0', marginUsed: '100', positionValue: '1000' } },
          { position: { coin: 'ETH', szi: '-1', entryPx: '3000', leverage: { value: 5 }, liquidationPx: null, unrealizedPnl: '0', marginUsed: '600', positionValue: '3000' } },
        ],
      };
      hlInfo.setState(mockState);

      const positions = await getPerpPositions({ walletAddress: '0x123' });
      expect(positions).toHaveLength(2);
    });

    it('should filter by coin when specified', async () => {
      const mockState = {
        marginSummary: { accountValue: '100', totalNtlPos: '0', totalRawUsd: '100', totalMarginUsed: '0' },
        assetPositions: [
          { position: { coin: 'BTC', szi: '0.01', entryPx: '100000', leverage: { value: 10 }, liquidationPx: null, unrealizedPnl: '0', marginUsed: '100', positionValue: '1000' } },
          { position: { coin: 'ETH', szi: '-1', entryPx: '3000', leverage: { value: 5 }, liquidationPx: null, unrealizedPnl: '0', marginUsed: '600', positionValue: '3000' } },
        ],
      };
      hlInfo.setState(mockState);

      const positions = await getPerpPositions({ walletAddress: '0x123', coin: 'btc' });
      expect(positions).toHaveLength(1);
      expect(positions[0].coin).toBe('BTC');
    });
  });

  describe('getHlMarkPrice', () => {
    it('returns markPx from metaAndAssetCtxs, not the mid', async () => {
      hlInfo.setMark('ETH', '3000');
      hlInfo.setMark('BTC', '100010', '100055.5');
      hlInfo.setAllMids({ BTC: '100055.5' });

      const price = await getHlMarkPrice('btc');
      expect(price).toBe(100010);
      expect(hlInfo.calls).toEqual([{ type: 'metaAndAssetCtxs' }]);
    });

    it('reads a builder-DEX market from its own dex', async () => {
      hlInfo.setMark('NVDA', '1');
      hlInfo.setMark('xyz:NVDA', '187.42');

      expect(await getHlMarkPrice('XYZ:nvda')).toBe(187.42);
      expect(hlInfo.calls).toEqual([{ type: 'metaAndAssetCtxs', dex: 'xyz' }]);
    });

    it('accepts a builder universe that lists bare asset names', async () => {
      (require('../../src/utils/hlInfo').hlInfoRequest as jest.Mock).mockResolvedValue([
        { universe: [{ name: 'TSLA' }] },
        [{ markPx: '250.5' }],
      ]);
      expect(await getHlMarkPrice('xyz:TSLA')).toBe(250.5);
    });

    it('should return 0 when the market is not listed', async () => {
      hlInfo.setMark('BTC', '100000');
      expect(await getHlMarkPrice('NOPE')).toBe(0);
    });

    it('should return 0 for an unusable markPx', async () => {
      hlInfo.setMark('BTC', 'NaN');
      expect(await getHlMarkPrice('BTC')).toBe(0);
    });

    it('throws when HyperLiquid cannot be reached', async () => {
      hlInfo.fail('metaAndAssetCtxs');
      await expect(getHlMarkPrice('BTC')).rejects.toThrow(/metaAndAssetCtxs/);
    });

    it('should throw for empty coin', async () => {
      await expect(getHlMarkPrice('')).rejects.toThrow(GdexValidationError);
    });
  });

  describe('getHlUsdcBalance', () => {
    it('adds perp account value and spot USDC', async () => {
      hlInfo.setState({ marginSummary: { accountValue: '700.5' }, assetPositions: [] });
      hlInfo.setSpot({ balances: [{ coin: 'HYPE', total: '5' }, { coin: 'USDC', total: '99.5' }] });

      const balance = await getHlUsdcBalance('0x123');
      expect(balance).toBe(800);
    });

    it('should return 0 for an empty account', async () => {
      hlInfo.setState(null);
      hlInfo.setSpot(null);

      const balance = await getHlUsdcBalance('0x123');
      expect(balance).toBe(0);
    });
  });

  describe('getHlOpenOrders', () => {
    it('should call getOpenOrders', async () => {
      const mockOrders = [{ oid: 1, coin: 'BTC', side: 'B', sz: '0.01' }];
      hlInfo.setOpenOrders(mockOrders);

      const orders = await getHlOpenOrders('0x123');
      expect(hlInfo.calls).toEqual([{ type: 'openOrders', user: '0x123' }]);
      expect(orders).toEqual(mockOrders);
    });
  });

  describe('getHlAllMids', () => {
    it('should return all mid prices', async () => {
      const mids = { BTC: '100000', ETH: '3000' };
      hlInfo.setAllMids(mids);

      const result = await getHlAllMids();
      expect(result).toEqual(mids);
    });
  });

  describe('getHlTradeHistory', () => {
    it('should return trade history', async () => {
      const history = [{ coin: 'BTC', size: '0.01' }];
      hlInfo.setFills(history);

      const result = await getHlTradeHistory('0x123');
      expect(result).toEqual(history);
    });
  });

  describe('getHlTraderLeverageContext', () => {
    it('should return leverage for trader/coin', async () => {
      hlInfo.setState({
        marginSummary: { accountValue: '1' },
        assetPositions: [{ position: { coin: 'BTC', szi: '1', leverage: { type: 'cross', value: 10 } } }],
      });

      const leverage = await getHlTraderLeverageContext('0xtrader', 'btc');
      expect(leverage).toBe(10);
      expect(hlInfo.calls).toEqual([{ type: 'clearinghouseState', user: '0xtrader' }]);
      expect(await getHlTraderLeverageContext('0xtrader', 'ETH')).toBeUndefined();
    });
  });

  describe('getGbotUsdcBalance', () => {
    it('should GET from gbot endpoint', async () => {
      client.get = jest.fn().mockResolvedValue({ balance: 500.25 });

      const balance = await getGbotUsdcBalance(client, '0xabc');
      expect(client.get).toHaveBeenCalledWith('/v1/hl/gbot_usdc_balance', { address: '0xabc' });
      expect(balance).toBe(500.25);
    });
  });

  // ── Write operations (managed-custody computedData) ───────────────────────

  describe('perpDeposit', () => {
    it('should build computedData and POST to deposit endpoint', async () => {
      client.post = jest.fn().mockResolvedValue({ isSuccess: true, message: 'ok' });

      const result = await perpDeposit(client, {
        ...TEST_CREDS,
        tokenAddress: '0xUSDC',
        amount: '100',
        chainId: 42161,
      });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        action: 'hl_deposit',
        actionParams: { chainId: 42161, tokenAddress: '0xUSDC', amount: '100000000' },
      }));
      expect(client.post).toHaveBeenCalledWith('/v1/hl/deposit', { computedData: 'mock-computed-data' });
      expect(result.isSuccess).toBe(true);
    });

    it('should throw for invalid amount', async () => {
      await expect(
        perpDeposit(client, { ...TEST_CREDS, tokenAddress: '0xUSDC', amount: '-1', chainId: 42161 })
      ).rejects.toThrow(GdexValidationError);
    });

    it('should throw for missing walletAddress', async () => {
      await expect(
        perpDeposit(client, { ...TEST_CREDS, walletAddress: '', tokenAddress: '0xUSDC', amount: '10', chainId: 42161 })
      ).rejects.toThrow(GdexValidationError);
    });

    it('converts to 6-decimal units exactly (no float rounding)', async () => {
      client.post = jest.fn().mockResolvedValue({ isSuccess: true });
      await perpDeposit(client, { ...TEST_CREDS, tokenAddress: '0xUSDC', amount: '4.35', chainId: 42161 });
      await perpDeposit(client, { ...TEST_CREDS, tokenAddress: '0xUSDC', amount: '10.000001', chainId: 42161 });
      const calls = (crypto.buildHlComputedData as jest.Mock).mock.calls;
      expect(calls[calls.length - 2][0].actionParams.amount).toBe('4350000');
      expect(calls[calls.length - 1][0].actionParams.amount).toBe('10000001');
    });

    it.each(['10.0000001', '1e3', '10abc', 'Infinity'])('should reject amount %p', async (amount) => {
      client.post = jest.fn();
      await expect(
        perpDeposit(client, { ...TEST_CREDS, tokenAddress: '0xUSDC', amount, chainId: 42161 })
      ).rejects.toThrow(GdexValidationError);
      expect(client.post).not.toHaveBeenCalled();
    });
  });

  describe('perpWithdraw', () => {
    it('should build computedData and POST to withdraw endpoint', async () => {
      client.post = jest.fn().mockResolvedValue({ isSuccess: true, message: 'ok' });

      const result = await perpWithdraw(client, { ...TEST_CREDS, amount: '50' });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        action: 'hl_withdraw',
        actionParams: { amount: '50' },
      }));
      expect(client.post).toHaveBeenCalledWith('/v1/hl/withdraw', { computedData: 'mock-computed-data' });
      expect(result.isSuccess).toBe(true);
    });

    it('should throw for zero amount', async () => {
      await expect(
        perpWithdraw(client, { ...TEST_CREDS, amount: '0' })
      ).rejects.toThrow(GdexValidationError);
    });

    it('accepts one decimal place (backend precision) and rejects finer precision', async () => {
      client.post = jest.fn().mockResolvedValue({ isSuccess: true });
      await perpWithdraw(client, { ...TEST_CREDS, amount: '2.5' });
      expect(client.post).toHaveBeenCalledTimes(1);
      await expect(perpWithdraw(client, { ...TEST_CREDS, amount: '5.25' })).rejects.toThrow(/more than 1 decimal/);
      expect(client.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('hlCreateOrder', () => {
    it('should build computedData and POST to create_order endpoint', async () => {
      client.post = jest.fn().mockResolvedValue({ isSuccess: true, message: 'filled', orderId: '123' });

      const result = await hlCreateOrder(client, {
        ...TEST_CREDS,
        coin: 'btc',
        isLong: true,
        price: '100000',
        size: '0.001',
        isMarket: true,
      });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        action: 'hl_create_order',
        actionParams: expect.objectContaining({
          coin: 'BTC',
          isLong: true,
          price: '100000',
          size: '0.001',
          reduceOnly: false,
          tpPrice: '',
          slPrice: '',
          isMarket: true,
        }),
      }));
      expect(client.post).toHaveBeenCalledWith('/v1/hl/create_order', { computedData: 'mock-computed-data' });
      expect(result.orderId).toBe('123');
    });

    it('should include TP/SL when provided', async () => {
      client.post = jest.fn().mockResolvedValue({ isSuccess: true, message: 'ok' });

      await hlCreateOrder(client, {
        ...TEST_CREDS,
        coin: 'ETH',
        isLong: false,
        price: '3000',
        size: '1',
        tpPrice: '2500',
        slPrice: '3200',
        isMarket: false,
      });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        actionParams: expect.objectContaining({
          tpPrice: '2500',
          slPrice: '3200',
          isMarket: false,
        }),
      }));
    });

    it('should throw for empty coin', async () => {
      await expect(
        hlCreateOrder(client, { ...TEST_CREDS, coin: '', isLong: true, price: '100', size: '1' })
      ).rejects.toThrow(GdexValidationError);
    });

    it('should throw for missing price', async () => {
      await expect(
        hlCreateOrder(client, { ...TEST_CREDS, coin: 'BTC', isLong: true, price: '', size: '1' })
      ).rejects.toThrow(GdexValidationError);
    });
  });

  describe('hlCreateOrder price / leverage / limit close', () => {
    beforeEach(() => {
      client.post = jest.fn().mockResolvedValue({ isSuccess: true });
    });

    function sentParams() {
      return ((crypto.buildHlComputedData as jest.Mock).mock.calls[0][0] as any).actionParams;
    }

    it("resolves price '0' on a market order to the MARK price, not the mid", async () => {
      hlInfo.setMark('BTC', '100010', '100077');
      hlInfo.setAllMids({ BTC: '100077' });
      await hlCreateOrder(client, { ...TEST_CREDS, coin: 'BTC', isLong: true, price: '0', size: '0.001', leverage: 5 });
      expect(sentParams().price).toBe('100010');
    });

    it("resolves price '0' on a builder-DEX market from that dex", async () => {
      hlInfo.setMark('xyz:NVDA', '187.42');
      await hlCreateOrder(client, { ...TEST_CREDS, coin: 'xyz:nvda', isLong: true, price: '0', size: '1', leverage: 3 });
      expect(sentParams()).toEqual(expect.objectContaining({ coin: 'xyz:NVDA', price: '187.42' }));
    });

    it('refuses a market order when no mark price is available', async () => {
      await expect(
        hlCreateOrder(client, { ...TEST_CREDS, coin: 'BTC', isLong: true, price: '0', size: '0.001' })
      ).rejects.toThrow(/No mark price/);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('sends leverage as a top-level body field, outside the signed payload', async () => {
      await hlCreateOrder(client, { ...TEST_CREDS, coin: 'BTC', isLong: true, price: '100000', size: '0.001', leverage: 7 });
      expect(client.post).toHaveBeenCalledWith('/v1/hl/create_order', { computedData: 'mock-computed-data', leverage: 7 });
      expect(sentParams()).not.toHaveProperty('leverage');
    });

    it('never sends marginMode (the back-end decides it)', async () => {
      await hlCreateOrder(client, {
        ...TEST_CREDS, coin: 'BTC', isLong: true, price: '100000', size: '0.001', marginMode: 'isolated',
      });
      expect(client.post).toHaveBeenCalledWith('/v1/hl/create_order', { computedData: 'mock-computed-data' });
      expect(sentParams()).not.toHaveProperty('marginMode');
    });

    it('places a limit close as a reduce-only limit without fetching a price', async () => {
      await hlCreateOrder(client, {
        ...TEST_CREDS, coin: 'ETH', isLong: false, price: '3500', size: '1', reduceOnly: true, isMarket: false, leverage: 10,
      });
      expect(sentParams()).toEqual(expect.objectContaining({
        coin: 'ETH', isLong: false, price: '3500', size: '1', reduceOnly: true, isMarket: false, tpPrice: '', slPrice: '',
      }));
      expect(hlInfo.calls).toEqual([]);
    });
  });

  describe('hlClosePosition (place_order = close at market)', () => {
    beforeEach(() => {
      client.post = jest.fn().mockResolvedValue({ isSuccess: true });
    });

    function sent() {
      return (crypto.buildHlComputedData as jest.Mock).mock.calls[0][0] as any;
    }

    it('builds a reduce-only hl_place_order with the mark price, as gdex.pro does', async () => {
      hlInfo.setMark('SOL', '150.25', '150.31');
      const result = await hlClosePosition(client, { ...TEST_CREDS, coin: 'sol', size: '10' });

      expect(sent().action).toBe('hl_place_order');
      expect(sent().actionParams).toEqual({ coin: 'SOL', isLong: false, price: '150.25', size: '10', reduceOnly: true });
      expect(client.post).toHaveBeenCalledWith('/v1/hl/place_order', { computedData: 'mock-computed-data' });
      expect(result.isSuccess).toBe(true);
    });

    it('reads a builder-DEX mark from its dex and keeps the dex prefix lowercase', async () => {
      hlInfo.setMark('xyz:TSLA', '250.5');
      await hlClosePosition(client, { ...TEST_CREDS, coin: 'XYZ:tsla', size: '2', isLong: true });
      expect(sent().actionParams).toEqual({ coin: 'xyz:TSLA', isLong: true, price: '250.5', size: '2', reduceOnly: true });
    });

    it('sends an explicit price without reading the mark', async () => {
      await hlClosePosition(client, { ...TEST_CREDS, coin: 'BTC', size: '0.01', price: '99000' });
      expect(sent().actionParams.price).toBe('99000');
      expect(hlInfo.calls).toEqual([]);
    });

    it('still closes when the mark cannot be read (the back-end ignores the price)', async () => {
      hlInfo.fail('metaAndAssetCtxs');
      await hlClosePosition(client, { ...TEST_CREDS, coin: 'BTC', size: '0.01' });
      expect(sent().actionParams).toEqual(expect.objectContaining({ price: '0', reduceOnly: true }));
      expect(client.post).toHaveBeenCalledTimes(1);
    });

    it('rejects a bad size or price before signing', async () => {
      const bad: Array<{ size: string; price?: string }> = [
        { size: '0' }, { size: '-1' }, { size: '1e3' }, { size: '' }, { size: '1', price: 'abc' },
      ];
      for (const fields of bad) {
        await expect(
          hlClosePosition(client, { ...TEST_CREDS, coin: 'BTC', ...fields })
        ).rejects.toThrow(GdexValidationError);
      }
      await expect(
        hlClosePosition(client, { ...TEST_CREDS, coin: 'BTC', size: '0.123', szDecimals: 2 })
      ).rejects.toThrow(GdexValidationError);
      expect(crypto.buildHlComputedData).not.toHaveBeenCalled();
      expect(client.post).not.toHaveBeenCalled();
    });
  });

  describe('hlPlaceOrder (deprecated alias)', () => {
    beforeEach(() => {
      client.post = jest.fn().mockResolvedValue({ isSuccess: true });
    });

    it('rejects anything that is not reduce-only before signing or any network call', async () => {
      for (const reduceOnly of [undefined, false, 'true' as any, 1 as any]) {
        const err = await hlPlaceOrder(client, {
          ...TEST_CREDS, coin: 'SOL', isLong: true, price: '150', size: '10', reduceOnly,
        }).catch((e) => e);
        expect(err).toBeInstanceOf(GdexValidationError);
        expect(err.field).toBe('reduceOnly');
        expect(err.message).toMatch(/hlCreateOrder/);
        expect(err.message).toMatch(/MARKET/);
      }
      expect(crypto.buildHlComputedData).not.toHaveBeenCalled();
      expect(client.post).not.toHaveBeenCalled();
      expect(hlInfo.calls).toEqual([]);
    });

    it('rejects a "market" flag without reduceOnly too', async () => {
      await expect(
        hlPlaceOrder(client, {
          ...TEST_CREDS, coin: 'SOL', isLong: true, price: '150', size: '10', isMarket: true,
        } as any)
      ).rejects.toThrow(/hlCreateOrder/);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('with reduceOnly: true sends the close through place_order', async () => {
      await hlPlaceOrder(client, {
        ...TEST_CREDS, coin: 'sol', isLong: false, price: '150', size: '10', reduceOnly: true,
      });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        action: 'hl_place_order',
        actionParams: { coin: 'SOL', isLong: false, price: '150', size: '10', reduceOnly: true },
      }));
      expect(client.post).toHaveBeenCalledWith('/v1/hl/place_order', { computedData: 'mock-computed-data' });
    });

    it('still validates price and size', async () => {
      await expect(
        hlPlaceOrder(client, { ...TEST_CREDS, coin: 'SOL', isLong: false, price: '', size: '10', reduceOnly: true })
      ).rejects.toThrow(GdexValidationError);
      await expect(
        hlPlaceOrder(client, { ...TEST_CREDS, coin: 'SOL', isLong: false, price: '150', size: '0', reduceOnly: true })
      ).rejects.toThrow(GdexValidationError);
      expect(client.post).not.toHaveBeenCalled();
    });
  });

  describe('hlModifyOrder', () => {
    beforeEach(() => {
      client.post = jest.fn().mockResolvedValue({
        isSuccess: true,
        retData: { previousOrderId: 111, orderId: 222, status: 'waitingForTrigger', price: '90000', size: '0.01', triggerPrice: '95000', triggerType: 'sl' },
      });
    });

    function sent() {
      return (crypto.buildHlComputedData as jest.Mock).mock.calls[0][0] as any;
    }

    it('moves a TP/SL trigger: triggerPrice only, price and size kept', async () => {
      const result = await hlModifyOrder(client, { ...TEST_CREDS, coin: 'btc', orderId: 111, triggerPrice: '95000' });

      expect(sent().action).toBe('hl_modify_order');
      expect(sent().actionParams).toEqual({ coin: 'BTC', orderId: '111', price: '', size: '', triggerPrice: '95000' });
      expect(client.post).toHaveBeenCalledWith('/v1/hl/modify_order', { computedData: 'mock-computed-data' });
      expect(result.retData).toEqual(expect.objectContaining({ previousOrderId: 111, orderId: 222, triggerType: 'sl' }));
    });

    it('re-prices a resting limit: price only', async () => {
      await hlModifyOrder(client, { ...TEST_CREDS, coin: 'xyz:nvda', orderId: '987654321', price: '180.5' });
      expect(sent().actionParams).toEqual({ coin: 'xyz:NVDA', orderId: '987654321', price: '180.5', size: '', triggerPrice: '' });
    });

    it("accepts size '0' (position-level TP/SL sentinel) and a size change", async () => {
      await hlModifyOrder(client, { ...TEST_CREDS, coin: 'BTC', orderId: '5', size: '0' });
      expect(sent().actionParams).toEqual(expect.objectContaining({ size: '0', price: '', triggerPrice: '' }));
    });

    it('rejects a bad orderId before signing', async () => {
      for (const orderId of ['', 'abc', '12.5', '-3', '0', '0x1f', '99999999999999999999', undefined as any]) {
        const err = await hlModifyOrder(client, { ...TEST_CREDS, coin: 'BTC', orderId, price: '1' }).catch((e) => e);
        expect(err).toBeInstanceOf(GdexValidationError);
        expect(err.field).toBe('orderId');
      }
      expect(crypto.buildHlComputedData).not.toHaveBeenCalled();
      expect(client.post).not.toHaveBeenCalled();
    });

    it('requires at least one of price, size, triggerPrice', async () => {
      await expect(
        hlModifyOrder(client, { ...TEST_CREDS, coin: 'BTC', orderId: '5' })
      ).rejects.toThrow(/At least one of price, size or triggerPrice/);
      await expect(
        hlModifyOrder(client, { ...TEST_CREDS, coin: 'BTC', orderId: '5', price: '', size: '', triggerPrice: '' })
      ).rejects.toThrow(/At least one/);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('rejects non-decimal, signed, exponent and zero prices before signing', async () => {
      const bad: Array<Record<string, any>> = [
        { price: '-1' }, { price: '1e5' }, { price: '0' }, { price: ' 1' }, { price: '1.' }, { price: '.5' },
        { triggerPrice: '0' }, { triggerPrice: 'abc' }, { triggerPrice: 95000 }, { size: '-1' }, { size: '1,5' },
      ];
      for (const fields of bad) {
        await expect(
          hlModifyOrder(client, { ...TEST_CREDS, coin: 'BTC', orderId: '5', ...fields })
        ).rejects.toThrow(GdexValidationError);
      }
      expect(crypto.buildHlComputedData).not.toHaveBeenCalled();
      expect(client.post).not.toHaveBeenCalled();
    });

    it('checks precision when szDecimals is given', async () => {
      await expect(
        hlModifyOrder(client, { ...TEST_CREDS, coin: 'BTC', orderId: '5', triggerPrice: '95000.123', szDecimals: 5 })
      ).rejects.toThrow(GdexValidationError);
      await expect(
        hlModifyOrder(client, { ...TEST_CREDS, coin: 'BTC', orderId: '5', size: '0.0000001', szDecimals: 5 })
      ).rejects.toThrow(GdexValidationError);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('requires coin and walletAddress', async () => {
      await expect(
        hlModifyOrder(client, { ...TEST_CREDS, coin: '', orderId: '5', price: '1' })
      ).rejects.toThrow(GdexValidationError);
      await expect(
        hlModifyOrder(client, { ...TEST_CREDS, walletAddress: '', coin: 'BTC', orderId: '5', price: '1' })
      ).rejects.toThrow(GdexValidationError);
    });
  });

  describe('hlAddPositionTpsl', () => {
    beforeEach(() => {
      client.post = jest.fn().mockResolvedValue({
        isSuccess: true,
        retData: { coin: 'BTC', size: '0.01', isBuy: false, createdOrders: [], failedOrders: [], partialSuccess: false },
      });
    });

    function sent() {
      return (crypto.buildHlComputedData as jest.Mock).mock.calls[0][0] as any;
    }

    it('adds both sides the way gdex.pro does: full position, market triggers, no execution price', async () => {
      const result = await hlAddPositionTpsl(client, {
        ...TEST_CREDS, coin: 'btc', tpTriggerPrice: '110000', slTriggerPrice: '95000',
      });

      expect(sent().action).toBe('hl_add_position_tpsl');
      expect(sent().actionParams).toEqual({
        coin: 'BTC', size: '',
        tpTriggerPrice: '110000', tpPrice: '', tpIsMarket: true,
        slTriggerPrice: '95000', slPrice: '', slIsMarket: true,
      });
      expect(client.post).toHaveBeenCalledWith('/v1/hl/add_position_tpsl', { computedData: 'mock-computed-data' });
      expect(result.retData?.createdOrders).toEqual([]);
    });

    it('adds one side only: the unused side is "" / true', async () => {
      await hlAddPositionTpsl(client, { ...TEST_CREDS, coin: 'xyz:tsla', size: '2', slTriggerPrice: '240' });
      expect(sent().actionParams).toEqual({
        coin: 'xyz:TSLA', size: '2',
        tpTriggerPrice: '', tpPrice: '', tpIsMarket: true,
        slTriggerPrice: '240', slPrice: '', slIsMarket: true,
      });
    });

    it('passes a limit trigger with its execution price', async () => {
      await hlAddPositionTpsl(client, {
        ...TEST_CREDS, coin: 'ETH', tpTriggerPrice: '4000', tpPrice: '3990', tpIsMarket: false,
      });
      expect(sent().actionParams).toEqual(expect.objectContaining({
        tpTriggerPrice: '4000', tpPrice: '3990', tpIsMarket: false, slIsMarket: true,
      }));
    });

    it('requires at least one trigger price', async () => {
      await expect(
        hlAddPositionTpsl(client, { ...TEST_CREDS, coin: 'BTC' })
      ).rejects.toThrow(/At least one of tpTriggerPrice or slTriggerPrice/);
      await expect(
        hlAddPositionTpsl(client, { ...TEST_CREDS, coin: 'BTC', size: '1', tpTriggerPrice: '', slTriggerPrice: '' })
      ).rejects.toThrow(/At least one/);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('refuses an execution price without its trigger', async () => {
      await expect(
        hlAddPositionTpsl(client, { ...TEST_CREDS, coin: 'BTC', tpPrice: '110000', slTriggerPrice: '95000' })
      ).rejects.toThrow(/tpPrice .* requires tpTriggerPrice/);
      await expect(
        hlAddPositionTpsl(client, { ...TEST_CREDS, coin: 'BTC', tpTriggerPrice: '110000', slPrice: '95000' })
      ).rejects.toThrow(/slPrice .* requires slTriggerPrice/);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('rejects zero, signed, exponent and non-string numbers, and non-boolean modes, before signing', async () => {
      const bad: Array<Record<string, any>> = [
        { tpTriggerPrice: '0' }, { tpTriggerPrice: '-1' }, { slTriggerPrice: '9e4' }, { slTriggerPrice: 95000 },
        { slTriggerPrice: '95000', size: '0' }, { slTriggerPrice: '95000', size: 'all' },
        { tpTriggerPrice: '110000', tpPrice: '0' },
        { slTriggerPrice: '95000', slIsMarket: 'true' }, { tpTriggerPrice: '110000', tpIsMarket: 1 },
      ];
      for (const fields of bad) {
        await expect(
          hlAddPositionTpsl(client, { ...TEST_CREDS, coin: 'BTC', ...fields })
        ).rejects.toThrow(GdexValidationError);
      }
      expect(crypto.buildHlComputedData).not.toHaveBeenCalled();
      expect(client.post).not.toHaveBeenCalled();
    });

    it('requires coin', async () => {
      await expect(
        hlAddPositionTpsl(client, { ...TEST_CREDS, coin: '', slTriggerPrice: '95000' })
      ).rejects.toThrow(GdexValidationError);
    });
  });

  describe('closePerpPosition', () => {
    const POS_ADDR = '0x9967179de55bd67e6b90fcc4f908556d93938c0f';

    /** Stub the backend clearinghouse reads: per-dex states plus the all-dex view. */
    function mockStates(byDex: Record<string, Array<{ coin: string; szi: string }>>) {
      client.get = jest.fn().mockImplementation(async (path: string, query: any) => {
        const toAssetPositions = (list: Array<{ coin: string; szi: string }>) =>
          list.map((p) => ({ type: 'oneWay', position: { ...p, entryPx: '1', leverage: { value: 3 } } }));
        if (path === '/v1/hl/clearinghouse_state') {
          const dex = query?.dex ?? '';
          return { isSuccess: true, dex: dex || 'default', state: { assetPositions: toAssetPositions(byDex[dex] ?? []) } };
        }
        if (path === '/v1/hl/clearinghouse_state_all') {
          const allPositions = Object.entries(byDex).flatMap(([dex, list]) =>
            toAssetPositions(list).map((ap) => ({ ...ap, dex })));
          return { isSuccess: true, allPositions };
        }
        throw new Error(`unexpected GET ${path}`);
      }) as any;
      client.post = jest.fn().mockResolvedValue({ isSuccess: true, message: 'ok' });
    }

    function sentActionParams() {
      const call = (crypto.buildHlComputedData as jest.Mock).mock.calls[0][0] as any;
      expect(call.action).toBe('hl_place_order');
      return call.actionParams;
    }

    it('closes a long in full with a reduce-only SELL', async () => {
      mockStates({ '': [{ coin: 'BTC', szi: '0.0123' }] });
      const result = await closePerpPosition(client, {
        ...TEST_CREDS, coin: 'btc', price: '100000', positionAddress: POS_ADDR,
      });

      expect(client.get).toHaveBeenCalledWith('/v1/hl/clearinghouse_state', { address: POS_ADDR });
      // The site's Close button: place_order, reduce-only, no leverage and no TP/SL fields.
      expect(sentActionParams()).toEqual({
        coin: 'BTC', isLong: false, price: '100000', size: '0.0123', reduceOnly: true,
      });
      expect(client.post).toHaveBeenCalledWith('/v1/hl/place_order', { computedData: 'mock-computed-data' });
      expect(result).toEqual(expect.objectContaining({
        positionSide: 'long', closeSide: 'sell', size: '0.0123', remainingSize: '0', isFullClose: true,
      }));
    });

    it('closes a short in full with a reduce-only BUY', async () => {
      mockStates({ '': [{ coin: 'ETH', szi: '-1.5' }] });
      const result = await closePerpPosition(client, { ...TEST_CREDS, coin: 'ETH', price: '3000' });

      expect(sentActionParams()).toEqual(expect.objectContaining({
        coin: 'ETH', isLong: true, size: '1.5', reduceOnly: true,
      }));
      expect(result.closeSide).toBe('buy');
      expect(result.positionSize).toBe('1.5');
    });

    it('partially closes with exact decimal remaining size', async () => {
      mockStates({ '': [{ coin: 'SOL', szi: '-0.3' }] });
      const result = await closePerpPosition(client, { ...TEST_CREDS, coin: 'SOL', size: '0.1', price: '150' });

      expect(sentActionParams()).toEqual(expect.objectContaining({ isLong: true, size: '0.1' }));
      expect(result.remainingSize).toBe('0.2'); // 0.3 - 0.1 in float is 0.19999999999999998
      expect(result.isFullClose).toBe(false);
    });

    it('rejects a flat position without placing an order', async () => {
      mockStates({ '': [{ coin: 'BTC', szi: '0.0' }] });
      await expect(
        closePerpPosition(client, { ...TEST_CREDS, coin: 'BTC', price: '100000' })
      ).rejects.toThrow(/No open BTC position/);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('rejects a missing position (also checking builder DEXes)', async () => {
      mockStates({ '': [{ coin: 'ETH', szi: '1' }] });
      await expect(
        closePerpPosition(client, { ...TEST_CREDS, coin: 'BTC', price: '100000' })
      ).rejects.toThrow(GdexValidationError);
      expect(client.get).toHaveBeenCalledWith('/v1/hl/clearinghouse_state_all', { address: TEST_CREDS.walletAddress });
      expect(client.post).not.toHaveBeenCalled();
    });

    it('rejects size larger than the position', async () => {
      mockStates({ '': [{ coin: 'BTC', szi: '0.01' }] });
      await expect(
        closePerpPosition(client, { ...TEST_CREDS, coin: 'BTC', size: '0.0100001', price: '100000' })
      ).rejects.toThrow(/exceeds the open BTC position \(0\.01\)/);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('rejects non-decimal and zero sizes', async () => {
      mockStates({ '': [{ coin: 'BTC', szi: '0.01' }] });
      await expect(resolvePerpClose(client, { ...TEST_CREDS, coin: 'BTC', size: '1e-3' })).rejects.toThrow(/decimal string/);
      await expect(resolvePerpClose(client, { ...TEST_CREDS, coin: 'BTC', size: '0' })).rejects.toThrow(/greater than 0/);
    });

    it('enforces szDecimals on a partial size when given', async () => {
      mockStates({ '': [{ coin: 'BTC', szi: '1' }] });
      await expect(
        resolvePerpClose(client, { ...TEST_CREDS, coin: 'BTC', size: '0.123', szDecimals: 2 })
      ).rejects.toThrow(/more than 2 decimals/);
      const plan = await resolvePerpClose(client, { ...TEST_CREDS, coin: 'BTC', size: '0.120', szDecimals: 2 });
      expect(plan.size).toBe('0.12');
    });

    it('reads a dex-prefixed builder coin from that dex only', async () => {
      mockStates({ xyz: [{ coin: 'xyz:TSLA', szi: '-2' }] });
      const result = await closePerpPosition(client, { ...TEST_CREDS, coin: 'XYZ:tsla', price: '250' });

      expect(client.get).toHaveBeenCalledWith('/v1/hl/clearinghouse_state', { address: TEST_CREDS.walletAddress, dex: 'xyz' });
      expect(client.get).toHaveBeenCalledTimes(1);
      expect(sentActionParams()).toEqual(expect.objectContaining({ coin: 'xyz:TSLA', isLong: true, size: '2' }));
      expect(result.dex).toBe('xyz');
    });

    it('resolves a bare coin to its single builder-dex position', async () => {
      mockStates({ '': [], xyz: [{ coin: 'xyz:NVDA', szi: '3' }] });
      const result = await closePerpPosition(client, { ...TEST_CREDS, coin: 'NVDA', price: '180' });
      expect(sentActionParams()).toEqual(expect.objectContaining({ coin: 'xyz:NVDA', isLong: false, size: '3' }));
      expect(result.coin).toBe('xyz:NVDA');
    });

    it('rejects a bare coin open on several builder DEXes as ambiguous', async () => {
      mockStates({ '': [], xyz: [{ coin: 'xyz:TSLA', szi: '1' }], para: [{ coin: 'para:TSLA', szi: '-1' }] });
      await expect(
        closePerpPosition(client, { ...TEST_CREDS, coin: 'TSLA', price: '250' })
      ).rejects.toThrow(/Ambiguous close.*xyz:TSLA, para:TSLA/);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('rejects a dex that contradicts the coin prefix', async () => {
      await expect(
        resolvePerpClose(client, { ...TEST_CREDS, coin: 'xyz:TSLA', dex: 'para' })
      ).rejects.toThrow(/does not match/);
    });

    it('uses the mark price when no price is given', async () => {
      mockStates({ '': [{ coin: 'BTC', szi: '0.01' }] });
      hlInfo.setMark('BTC', '101000', '101044');
      await closePerpPosition(client, { ...TEST_CREDS, coin: 'BTC' });
      expect(sentActionParams()).toEqual(expect.objectContaining({ price: '101000', isLong: false }));
    });

    it('never goes through create_order (which would reset the position leverage)', async () => {
      mockStates({ '': [{ coin: 'BTC', szi: '0.01' }] });
      hlInfo.setMark('BTC', '101000');
      await closePerpPosition(client, { ...TEST_CREDS, coin: 'BTC' });
      expect(client.post).toHaveBeenCalledTimes(1);
      expect((client.post as jest.Mock).mock.calls[0][0]).toBe('/v1/hl/place_order');
      expect((client.post as jest.Mock).mock.calls[0][1]).not.toHaveProperty('leverage');
    });
  });

  describe('hlCloseAll', () => {
    it('should build computedData and POST to close_all endpoint', async () => {
      client.post = jest.fn().mockResolvedValue({ isSuccess: true, message: 'closed all' });

      const result = await hlCloseAll(client, TEST_CREDS);

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        action: 'hl_close_all',
      }));
      expect(client.post).toHaveBeenCalledWith('/v1/hl/close_all_positions', { computedData: 'mock-computed-data' });
      expect(result.isSuccess).toBe(true);
    });
  });

  describe('hlCancelOrder', () => {
    it('should build computedData and POST to cancel_order endpoint', async () => {
      client.post = jest.fn().mockResolvedValue({ isSuccess: true, message: 'cancelled' });

      const result = await hlCancelOrder(client, {
        ...TEST_CREDS,
        coin: 'BTC',
        orderId: '456',
      });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        action: 'hl_cancel_order',
        actionParams: { coin: 'BTC', orderId: '456' },
      }));
      expect(client.post).toHaveBeenCalledWith('/v1/hl/cancel_order', { computedData: 'mock-computed-data' });
      expect(result.isSuccess).toBe(true);
    });

    it('should throw for missing orderId', async () => {
      await expect(
        hlCancelOrder(client, { ...TEST_CREDS, coin: 'BTC', orderId: '' })
      ).rejects.toThrow(GdexValidationError);
    });
  });

  describe('hlCancelAllOrders', () => {
    it('should POST cancel_order with isCancelAll flag', async () => {
      client.post = jest.fn().mockResolvedValue({ isSuccess: true, message: 'all cancelled' });

      const result = await hlCancelAllOrders(client, TEST_CREDS);

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        action: 'hl_cancel_all_orders',
      }));
      expect(client.post).toHaveBeenCalledWith('/v1/hl/cancel_order', {
        computedData: 'mock-computed-data',
        isCancelAll: true,
      });
      expect(result.isSuccess).toBe(true);
    });
  });

  describe('hlUpdateLeverage (no such back-end route)', () => {
    it('always throws a clear error and never signs or posts', async () => {
      client.post = jest.fn();
      const err = await hlUpdateLeverage(client, { ...TEST_CREDS, coin: 'btc', leverage: 40, isCross: true }).catch((e) => e);

      expect(err).toBeInstanceOf(GdexValidationError);
      expect(err.message).toMatch(/no \/v1\/hl\/update_leverage route/);
      expect(err.message).toMatch(/`leverage` field of hlCreateOrder/);
      expect(crypto.buildHlComputedData).not.toHaveBeenCalled();
      expect(client.post).not.toHaveBeenCalled();
    });
  });

  // ── Direct execution tests (via HyperLiquidTrading SDK) ───────────────────

  describe('hlExecuteCrossPerp', () => {
    it('should call executeCrossPerp on trader SDK', async () => {
      const result = await hlExecuteCrossPerp('0xprivkey', {
        coin: 'btc',
        isLong: true,
        price: '100000',
        positionSize: '0.001',
      });

      expect(getMockTrader().executeCrossPerp).toHaveBeenCalledWith(
        '0xprivkey',
        expect.objectContaining({ coin: 'BTC', isLong: true, price: '100000', positionSize: '0.001' }),
        true,
      );
      expect(result).toEqual({ status: 'ok' });
    });

    it('should throw for missing privateKey', async () => {
      await expect(
        hlExecuteCrossPerp('', { coin: 'BTC', isLong: true, price: '100', positionSize: '1' })
      ).rejects.toThrow(GdexValidationError);
    });

    it('should throw for empty coin', async () => {
      await expect(
        hlExecuteCrossPerp('0xprivkey', { coin: '', isLong: true, price: '100', positionSize: '1' })
      ).rejects.toThrow(GdexValidationError);
    });
  });

  describe('hlExecuteIsolatedPerp', () => {
    it('should call executeIsolatedPerp on trader SDK', async () => {
      const result = await hlExecuteIsolatedPerp('0xprivkey', {
        coin: 'eth',
        isLong: false,
        price: '3000',
        positionSize: '1',
        leverage: 10,
      });

      expect(getMockTrader().executeIsolatedPerp).toHaveBeenCalledWith(
        '0xprivkey',
        expect.objectContaining({ coin: 'ETH', isLong: false, leverage: 10 }),
        true,
      );
      expect(result).toEqual({ status: 'ok' });
    });
  });

  describe('hlExecuteSpot', () => {
    it('should call executeSpot on trader SDK', async () => {
      const result = await hlExecuteSpot('0xprivkey', {
        coin: 'sol',
        isBuy: true,
        price: '150',
        size: '10',
      });

      expect(getMockTrader().executeSpot).toHaveBeenCalledWith(
        '0xprivkey',
        expect.objectContaining({ coin: 'SOL', isBuy: true }),
        true,
      );
      expect(result).toEqual({ status: 'ok' });
    });
  });

  describe('hlDirectCancelOrder', () => {
    it('should call cancelOrder on trader SDK', async () => {
      const result = await hlDirectCancelOrder('0xprivkey', 'BTC', 123);

      expect(getMockTrader().cancelOrder).toHaveBeenCalledWith('0xprivkey', 'BTC', 123);
      expect(result).toEqual({ status: 'ok' });
    });

    it('should throw for empty coin', async () => {
      await expect(
        hlDirectCancelOrder('0xprivkey', '', 123)
      ).rejects.toThrow(GdexValidationError);
    });
  });
});
