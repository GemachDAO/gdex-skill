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

// Access the mock InfoClient instance from the global module mock
function getMockInfoClient() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { __mockInfoClient } = require('@nktkas/hyperliquid');
  return __mockInfoClient;
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
    const hl = require('@nktkas/hyperliquid');
    hl.InfoClient.mockImplementation(() => hl.__mockInfoClient);
    const mock = hl.__mockInfoClient;
    mock.clearinghouseState.mockResolvedValue({
      crossMarginSummary: { accountValue: '0', totalNtlPos: '0', totalRawUsd: '0', totalMarginUsed: '0' },
      withdrawable: '0',
      assetPositions: [],
    });
    mock.l2Book.mockResolvedValue({ levels: [[], []] });
    mock.frontendOpenOrders.mockResolvedValue([]);
  });

  // ── Read operations (HyperLiquid L1) ──────────────────────────────────────

  describe('getHlAccountState', () => {
    it('should return account state with positions', async () => {
      const mockState = {
        crossMarginSummary: {
          accountValue: '1000.50',
          totalNtlPos: '500.00',
          totalRawUsd: '1000.50',
          totalMarginUsed: '50.00',
        },
        withdrawable: '950.50',
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
      getMockInfoClient().clearinghouseState.mockResolvedValue(mockState);

      const state = await getHlAccountState('0x1234');

      expect(getMockInfoClient().clearinghouseState).toHaveBeenCalledWith({ user: '0x1234' });
      expect(state.accountValue).toBe('1000.50');
      expect(state.withdrawable).toBe('950.50');
      expect(state.positions).toHaveLength(1);
      expect(state.positions[0].coin).toBe('BTC');
      expect(state.positions[0].side).toBe('long');
      expect(state.positions[0].size).toBe('0.001');
      expect(state.positions[0].leverage).toBe(10);
    });

    it('should map short positions correctly', async () => {
      const mockState = {
        crossMarginSummary: {
          accountValue: '500',
          totalNtlPos: '200',
          totalRawUsd: '500',
          totalMarginUsed: '20',
        },
        withdrawable: '480',
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
      getMockInfoClient().clearinghouseState.mockResolvedValue(mockState);

      const state = await getHlAccountState('0xabcd');
      expect(state.positions[0].side).toBe('short');
      expect(state.positions[0].size).toBe('2.5');
    });

    it('should throw for empty walletAddress', async () => {
      await expect(getHlAccountState('')).rejects.toThrow(GdexValidationError);
    });
  });

  describe('getPerpPositions', () => {
    it('should return all positions', async () => {
      const mockState = {
        crossMarginSummary: { accountValue: '100', totalNtlPos: '0', totalRawUsd: '100', totalMarginUsed: '0' },
        withdrawable: '100',
        assetPositions: [
          { position: { coin: 'BTC', szi: '0.01', entryPx: '100000', leverage: { value: 10 }, liquidationPx: null, unrealizedPnl: '0', marginUsed: '100', positionValue: '1000' } },
          { position: { coin: 'ETH', szi: '-1', entryPx: '3000', leverage: { value: 5 }, liquidationPx: null, unrealizedPnl: '0', marginUsed: '600', positionValue: '3000' } },
        ],
      };
      getMockInfoClient().clearinghouseState.mockResolvedValue(mockState);

      const positions = await getPerpPositions({ walletAddress: '0x123' });
      expect(positions).toHaveLength(2);
    });

    it('should filter by coin when specified', async () => {
      const mockState = {
        crossMarginSummary: { accountValue: '100', totalNtlPos: '0', totalRawUsd: '100', totalMarginUsed: '0' },
        withdrawable: '100',
        assetPositions: [
          { position: { coin: 'BTC', szi: '0.01', entryPx: '100000', leverage: { value: 10 }, liquidationPx: null, unrealizedPnl: '0', marginUsed: '100', positionValue: '1000' } },
          { position: { coin: 'ETH', szi: '-1', entryPx: '3000', leverage: { value: 5 }, liquidationPx: null, unrealizedPnl: '0', marginUsed: '600', positionValue: '3000' } },
        ],
      };
      getMockInfoClient().clearinghouseState.mockResolvedValue(mockState);

      const positions = await getPerpPositions({ walletAddress: '0x123', coin: 'btc' });
      expect(positions).toHaveLength(1);
      expect(positions[0].coin).toBe('BTC');
    });
  });

  describe('getHlMarkPrice', () => {
    it('should return mark price from L2 book', async () => {
      getMockInfoClient().l2Book.mockResolvedValue({
        levels: [
          [{ px: '99990', sz: '1' }], // bids
          [{ px: '100010', sz: '0.5' }], // asks
        ],
      });

      const price = await getHlMarkPrice('BTC');
      expect(price).toBe(100010);
      expect(getMockInfoClient().l2Book).toHaveBeenCalledWith({ coin: 'BTC' });
    });

    it('should return 0 when book is null', async () => {
      getMockInfoClient().l2Book.mockResolvedValue(null);
      const price = await getHlMarkPrice('XYZ');
      expect(price).toBe(0);
    });

    it('should throw for empty coin', async () => {
      await expect(getHlMarkPrice('')).rejects.toThrow(GdexValidationError);
    });
  });

  describe('getHlUsdcBalance', () => {
    it('should compute available balance', async () => {
      getMockInfoClient().clearinghouseState.mockResolvedValue({
        crossMarginSummary: { accountValue: '1000', totalMarginUsed: '200' },
      });

      const balance = await getHlUsdcBalance('0x123');
      expect(balance).toBe(800);
    });
  });

  describe('getHlOpenOrders', () => {
    it('should call frontendOpenOrders', async () => {
      const mockOrders = [{ oid: 1, coin: 'BTC', side: 'B', sz: '0.01' }];
      getMockInfoClient().frontendOpenOrders.mockResolvedValue(mockOrders);

      const orders = await getHlOpenOrders('0x123');
      expect(getMockInfoClient().frontendOpenOrders).toHaveBeenCalledWith({ user: '0x123' });
      expect(orders).toEqual(mockOrders);
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
});
