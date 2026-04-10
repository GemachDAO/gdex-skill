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

jest.mock('../../src/client');
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

  beforeEach(() => {
    client = new MockedClient() as jest.Mocked<GdexApiClient>;
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

  // ── Read operations (HyperLiquid L1) ──────────────────────────────────────

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
      getMockTrader().getAccountState.mockResolvedValue(mockState);

      const state = await getHlAccountState('0x1234');

      expect(getMockTrader().getAccountState).toHaveBeenCalledWith('0x1234');
      expect(state.accountValue).toBe('1000.50');
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
      getMockTrader().getAccountState.mockResolvedValue(mockState);

      const state = await getHlAccountState('0xabcd');
      expect(state.positions[0].side).toBe('short');
      expect(state.positions[0].size).toBe('2.5');
    });

    it('should return empty state when getAccountState returns undefined', async () => {
      getMockTrader().getAccountState.mockResolvedValue(undefined);

      const state = await getHlAccountState('0x1234');
      expect(state.accountValue).toBe('0');
      expect(state.positions).toHaveLength(0);
    });

    it('should throw for empty walletAddress', async () => {
      await expect(getHlAccountState('')).rejects.toThrow(GdexValidationError);
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
      getMockTrader().getAccountState.mockResolvedValue(mockState);

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
      getMockTrader().getAccountState.mockResolvedValue(mockState);

      const positions = await getPerpPositions({ walletAddress: '0x123', coin: 'btc' });
      expect(positions).toHaveLength(1);
      expect(positions[0].coin).toBe('BTC');
    });
  });

  describe('getHlMarkPrice', () => {
    it('should return mid price from trader SDK', async () => {
      getMockTrader().getMidPrice.mockResolvedValue(100010);

      const price = await getHlMarkPrice('BTC');
      expect(price).toBe(100010);
      expect(getMockTrader().getMidPrice).toHaveBeenCalledWith('BTC');
    });

    it('should return 0 when getMidPrice returns undefined', async () => {
      getMockTrader().getMidPrice.mockResolvedValue(undefined);
      const price = await getHlMarkPrice('XYZ');
      expect(price).toBe(0);
    });

    it('should throw for empty coin', async () => {
      await expect(getHlMarkPrice('')).rejects.toThrow(GdexValidationError);
    });
  });

  describe('getHlUsdcBalance', () => {
    it('should return balance from trader SDK', async () => {
      getMockTrader().getBalance.mockResolvedValue(800);

      const balance = await getHlUsdcBalance('0x123');
      expect(balance).toBe(800);
    });

    it('should return 0 when getBalance returns undefined', async () => {
      getMockTrader().getBalance.mockResolvedValue(undefined);

      const balance = await getHlUsdcBalance('0x123');
      expect(balance).toBe(0);
    });
  });

  describe('getHlOpenOrders', () => {
    it('should call getOpenOrders', async () => {
      const mockOrders = [{ oid: 1, coin: 'BTC', side: 'B', sz: '0.01' }];
      getMockTrader().getOpenOrders.mockResolvedValue(mockOrders);

      const orders = await getHlOpenOrders('0x123');
      expect(getMockTrader().getOpenOrders).toHaveBeenCalledWith('0x123');
      expect(orders).toEqual(mockOrders);
    });
  });

  describe('getHlAllMids', () => {
    it('should return all mid prices', async () => {
      const mids = { BTC: '100000', ETH: '3000' };
      getMockTrader().getAllMids.mockResolvedValue(mids);

      const result = await getHlAllMids();
      expect(result).toEqual(mids);
    });
  });

  describe('getHlTradeHistory', () => {
    it('should return trade history', async () => {
      const history = [{ coin: 'BTC', size: '0.01' }];
      getMockTrader().getTradeHistory.mockResolvedValue(history);

      const result = await getHlTradeHistory('0x123');
      expect(result).toEqual(history);
    });
  });

  describe('getHlTraderLeverageContext', () => {
    it('should return leverage for trader/coin', async () => {
      getMockTrader().getTraderLeverageContext.mockResolvedValue(10);

      const leverage = await getHlTraderLeverageContext('0xtrader', 'btc');
      expect(leverage).toBe(10);
      expect(getMockTrader().getTraderLeverageContext).toHaveBeenCalledWith('0xtrader', 'BTC');
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

  describe('hlPlaceOrder', () => {
    it('should build computedData and POST to place_order endpoint', async () => {
      client.post = jest.fn().mockResolvedValue({ isSuccess: true, message: 'ok' });

      await hlPlaceOrder(client, {
        ...TEST_CREDS,
        coin: 'sol',
        isLong: true,
        price: '150',
        size: '10',
      });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        action: 'hl_place_order',
        actionParams: expect.objectContaining({ coin: 'SOL', isLong: true }),
      }));
      expect(client.post).toHaveBeenCalledWith('/v1/hl/place_order', { computedData: 'mock-computed-data' });
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

  describe('hlUpdateLeverage', () => {
    it('should build computedData and POST to update_leverage endpoint', async () => {
      client.post = jest.fn().mockResolvedValue({ isSuccess: true, message: 'leverage updated' });

      const result = await hlUpdateLeverage(client, {
        ...TEST_CREDS,
        coin: 'btc',
        leverage: 40,
        isCross: true,
      });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        action: 'hl_update_leverage',
        actionParams: expect.objectContaining({
          coin: 'BTC',
          leverage: 40,
          isCross: true,
        }),
      }));
      expect(client.post).toHaveBeenCalledWith('/v1/hl/update_leverage', { computedData: 'mock-computed-data' });
      expect(result.isSuccess).toBe(true);
    });

    it('should default isCross to true', async () => {
      client.post = jest.fn().mockResolvedValue({ isSuccess: true, message: 'ok' });

      await hlUpdateLeverage(client, {
        ...TEST_CREDS,
        coin: 'ETH',
        leverage: 25,
      });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        actionParams: expect.objectContaining({
          isCross: true,
        }),
      }));
    });

    it('should throw for empty coin', async () => {
      await expect(
        hlUpdateLeverage(client, { ...TEST_CREDS, coin: '', leverage: 40 })
      ).rejects.toThrow(GdexValidationError);
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
