/**
 * Tests for perpetual trading actions.
 */
import { GdexApiClient } from '../../src/client';
import {
  openPerpPosition,
  closePerpPosition,
  setPerpLeverage,
  getPerpPositions,
  perpDeposit,
  perpWithdraw,
} from '../../src/actions/perpTrade';
import { GdexValidationError } from '../../src/utils/errors';

jest.mock('../../src/client');
const MockedClient = GdexApiClient as jest.MockedClass<typeof GdexApiClient>;

describe('perpTrade', () => {
  let client: jest.Mocked<GdexApiClient>;

  beforeEach(() => {
    client = new MockedClient() as jest.Mocked<GdexApiClient>;
  });

  // ── openPerpPosition ──────────────────────────────────────────────────────

  describe('openPerpPosition', () => {
    it('should open a long position with correct params', async () => {
      const mockResult = {
        txHash: 'hl_order_123',
        chain: 'hyperliquid',
        status: 'confirmed',
        coin: 'BTC',
        side: 'long',
        executionPrice: '100000',
        size: '0.01',
      };
      client.post = jest.fn().mockResolvedValue(mockResult);

      const result = await openPerpPosition(client, {
        coin: 'BTC',
        side: 'long',
        sizeUsd: '1000',
        leverage: 10,
        takeProfitPrice: '110000',
        stopLossPrice: '95000',
      });

      expect(client.post).toHaveBeenCalledWith('/v1/hl/trade', expect.objectContaining({
        coin: 'BTC',
        side: 'long',
        sizeUsd: '1000',
        leverage: 10,
        takeProfitPrice: '110000',
        stopLossPrice: '95000',
      }));
      expect(result).toEqual(mockResult);
    });

    it('should uppercase coin symbol', async () => {
      client.post = jest.fn().mockResolvedValue({});

      await openPerpPosition(client, {
        coin: 'eth',
        side: 'short',
        sizeUsd: '500',
      });

      expect(client.post).toHaveBeenCalledWith('/v1/hl/trade', expect.objectContaining({
        coin: 'ETH',
      }));
    });

    it('should use default leverage of 5 when not specified', async () => {
      client.post = jest.fn().mockResolvedValue({});

      await openPerpPosition(client, {
        coin: 'SOL',
        side: 'long',
        sizeUsd: '200',
      });

      expect(client.post).toHaveBeenCalledWith('/v1/hl/trade', expect.objectContaining({
        leverage: 5,
      }));
    });

    it('should use default marginMode of cross when not specified', async () => {
      client.post = jest.fn().mockResolvedValue({});

      await openPerpPosition(client, {
        coin: 'SOL',
        side: 'long',
        sizeUsd: '200',
      });

      expect(client.post).toHaveBeenCalledWith('/v1/hl/trade', expect.objectContaining({
        marginMode: 'cross',
      }));
    });

    it('should throw GdexValidationError for empty coin', async () => {
      await expect(
        openPerpPosition(client, {
          coin: '',
          side: 'long',
          sizeUsd: '1000',
        })
      ).rejects.toThrow(GdexValidationError);
    });

    it('should throw GdexValidationError for invalid leverage', async () => {
      await expect(
        openPerpPosition(client, {
          coin: 'BTC',
          side: 'long',
          sizeUsd: '1000',
          leverage: 0,
        })
      ).rejects.toThrow(GdexValidationError);
    });

    it('should throw GdexValidationError for leverage over 100', async () => {
      await expect(
        openPerpPosition(client, {
          coin: 'BTC',
          side: 'long',
          sizeUsd: '1000',
          leverage: 101,
        })
      ).rejects.toThrow(GdexValidationError);
    });

    it('should throw GdexValidationError for zero sizeUsd', async () => {
      await expect(
        openPerpPosition(client, {
          coin: 'BTC',
          side: 'long',
          sizeUsd: '0',
        })
      ).rejects.toThrow(GdexValidationError);
    });
  });

  // ── closePerpPosition ─────────────────────────────────────────────────────

  describe('closePerpPosition', () => {
    it('should close entire position by default (100%)', async () => {
      client.post = jest.fn().mockResolvedValue({ coin: 'BTC', realizedPnl: '50' });

      await closePerpPosition(client, { coin: 'BTC' });

      expect(client.post).toHaveBeenCalledWith('/v1/hl/trade', expect.objectContaining({
        coin: 'BTC',
        action: 'close',
        closePercent: 100,
      }));
    });

    it('should close partial position', async () => {
      client.post = jest.fn().mockResolvedValue({});

      await closePerpPosition(client, { coin: 'ETH', closePercent: 50 });

      expect(client.post).toHaveBeenCalledWith('/v1/hl/trade', expect.objectContaining({
        coin: 'ETH',
        closePercent: 50,
      }));
    });

    it('should throw for closePercent > 100', async () => {
      await expect(
        closePerpPosition(client, { coin: 'BTC', closePercent: 101 })
      ).rejects.toThrow();
    });
  });

  // ── setPerpLeverage ───────────────────────────────────────────────────────

  describe('setPerpLeverage', () => {
    it('should set leverage correctly', async () => {
      client.post = jest.fn().mockResolvedValue(undefined);

      await setPerpLeverage(client, { coin: 'BTC', leverage: 20 });

      expect(client.post).toHaveBeenCalledWith('/v1/hl/leverage', expect.objectContaining({
        coin: 'BTC',
        leverage: 20,
      }));
    });
  });

  // ── getPerpPositions ──────────────────────────────────────────────────────

  describe('getPerpPositions', () => {
    it('should get positions for a wallet', async () => {
      const mockPositions = [
        {
          coin: 'BTC',
          side: 'long',
          size: '0.01',
          entryPrice: '100000',
          markPrice: '105000',
          leverage: 10,
          unrealizedPnl: '50',
        },
      ];
      client.get = jest.fn().mockResolvedValue(mockPositions);

      const positions = await getPerpPositions(client, {
        walletAddress: '0x1234567890123456789012345678901234567890',
      });

      expect(client.get).toHaveBeenCalledWith('/v1/hl/positions', expect.objectContaining({
        walletAddress: '0x1234567890123456789012345678901234567890',
      }));
      expect(positions).toEqual(mockPositions);
    });

    it('should throw GdexValidationError for missing walletAddress', async () => {
      await expect(
        getPerpPositions(client, { walletAddress: '' })
      ).rejects.toThrow(GdexValidationError);
    });
  });

  // ── perpDeposit / perpWithdraw ────────────────────────────────────────────

  describe('perpDeposit', () => {
    it('should deposit with valid amount', async () => {
      client.post = jest.fn().mockResolvedValue({ txHash: 'dep_tx' });

      await perpDeposit(client, { amount: '100' });

      expect(client.post).toHaveBeenCalledWith('/v1/hl/deposit', expect.objectContaining({
        amount: '100',
      }));
    });

    it('should throw for invalid amount', async () => {
      await expect(
        perpDeposit(client, { amount: '-50' })
      ).rejects.toThrow(GdexValidationError);
    });
  });

  describe('perpWithdraw', () => {
    it('should withdraw with valid amount', async () => {
      client.post = jest.fn().mockResolvedValue({ txHash: 'wit_tx' });

      await perpWithdraw(client, { amount: '50' });

      expect(client.post).toHaveBeenCalledWith('/v1/hl/withdraw', expect.objectContaining({
        amount: '50',
      }));
    });
  });
});
