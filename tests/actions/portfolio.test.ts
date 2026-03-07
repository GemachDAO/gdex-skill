/**
 * Tests for portfolio actions.
 */
import { GdexApiClient } from '../../src/client';
import { getPortfolio, getBalances, getTradeHistory } from '../../src/actions/portfolio';
import { GdexValidationError } from '../../src/utils/errors';
import { ChainId } from '../../src/types/common';

jest.mock('../../src/client');
const MockedClient = GdexApiClient as jest.MockedClass<typeof GdexApiClient>;

describe('portfolio', () => {
  let client: jest.Mocked<GdexApiClient>;

  beforeEach(() => {
    client = new MockedClient() as jest.Mocked<GdexApiClient>;
  });

  // ── getPortfolio ──────────────────────────────────────────────────────────

  describe('getPortfolio', () => {
    it('should fetch portfolio for a wallet', async () => {
      const mockPortfolio = {
        totalValueUsd: '5000',
        balances: [
          {
            tokenAddress: 'So11111111111111111111111111111111111111112',
            symbol: 'SOL',
            name: 'Solana',
            decimals: 9,
            rawBalance: '5000000000',
            balance: '5',
            usdValue: '750',
            chain: 'solana',
          },
        ],
      };
      client.get = jest.fn().mockResolvedValue(mockPortfolio);

      const portfolio = await getPortfolio(client, {
        walletAddress: 'So11111111111111111111111111111111111111112',
      });

      expect(client.get).toHaveBeenCalledWith('/v1/portfolio', expect.objectContaining({
        walletAddress: 'So11111111111111111111111111111111111111112',
        wallet: 'So11111111111111111111111111111111111111112',
      }));
      expect(portfolio).toEqual(mockPortfolio);
    });

    it('should include chain filter when specified', async () => {
      client.get = jest.fn().mockResolvedValue({ totalValueUsd: '0', balances: [] });

      await getPortfolio(client, {
        walletAddress: '0x1234567890123456789012345678901234567890',
        chain: ChainId.BASE,
      });

      expect(client.get).toHaveBeenCalledWith('/v1/portfolio', expect.objectContaining({
        chain: ChainId.BASE,
        chainId: ChainId.BASE,
      }));
    });

    it('should throw GdexValidationError for missing walletAddress', async () => {
      await expect(
        getPortfolio(client, { walletAddress: '' })
      ).rejects.toThrow(GdexValidationError);
    });

    it('should throw GdexValidationError for unsupported chain', async () => {
      await expect(
        getPortfolio(client, {
          walletAddress: '0x1234567890123456789012345678901234567890',
          chain: 9999 as ChainId,
        })
      ).rejects.toThrow(GdexValidationError);
    });
  });

  // ── getBalances ───────────────────────────────────────────────────────────

  describe('getBalances', () => {
    it('should fetch balances for a wallet on a specific chain', async () => {
      const mockBalances = [
        {
          tokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
          symbol: 'ETH',
          name: 'Ethereum',
          decimals: 18,
          rawBalance: '1000000000000000000',
          balance: '1',
          usdValue: '3000',
          chain: ChainId.ETHEREUM,
        },
      ];
      client.get = jest.fn().mockResolvedValue(mockBalances);

      const balances = await getBalances(client, {
        walletAddress: '0x1234567890123456789012345678901234567890',
        chain: ChainId.ETHEREUM,
      });

      expect(client.get).toHaveBeenCalledWith('/v1/portfolio/balances', expect.objectContaining({
        walletAddress: '0x1234567890123456789012345678901234567890',
        wallet: '0x1234567890123456789012345678901234567890',
        chain: ChainId.ETHEREUM,
        chainId: ChainId.ETHEREUM,
      }));
      expect(balances).toEqual(mockBalances);
    });
  });

  // ── getTradeHistory ───────────────────────────────────────────────────────

  describe('getTradeHistory', () => {
    it('should fetch trade history with pagination', async () => {
      const mockHistory = [
        {
          id: 'trade_1',
          type: 'buy',
          inputToken: 'So11111111111111111111111111111111111111112',
          outputToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amountIn: '1',
          amountOut: '155',
          chain: 'solana',
          txHash: 'tx_hash_1',
          timestamp: 1700000000,
          status: 'completed',
        },
      ];
      client.get = jest.fn().mockResolvedValue(mockHistory);

      const history = await getTradeHistory(client, {
        walletAddress: 'So11111111111111111111111111111111111111112',
        page: 1,
        limit: 10,
      });

      expect(client.get).toHaveBeenCalledWith('/v1/user_history', expect.objectContaining({
        walletAddress: 'So11111111111111111111111111111111111111112',
        wallet: 'So11111111111111111111111111111111111111112',
        page: 1,
        limit: 10,
      }));
      expect(history).toEqual(mockHistory);
    });

    it('should pass time range filters', async () => {
      client.get = jest.fn().mockResolvedValue([]);

      await getTradeHistory(client, {
        walletAddress: '0x1234567890123456789012345678901234567890',
        startTime: 1700000000,
        endTime: 1700086400,
      });

      expect(client.get).toHaveBeenCalledWith('/v1/user_history', expect.objectContaining({
        startTime: 1700000000,
        endTime: 1700086400,
        from: 1700000000,
        to: 1700086400,
      }));
    });
  });
});
