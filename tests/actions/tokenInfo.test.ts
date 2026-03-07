/**
 * Tests for token information actions.
 */
import { GdexApiClient } from '../../src/client';
import { getTokenDetails, getTrendingTokens, getOHLCV } from '../../src/actions/tokenInfo';
import { GdexValidationError } from '../../src/utils/errors';
import { ChainId } from '../../src/types/common';

jest.mock('../../src/client');
const MockedClient = GdexApiClient as jest.MockedClass<typeof GdexApiClient>;

describe('tokenInfo', () => {
  let client: jest.Mocked<GdexApiClient>;

  beforeEach(() => {
    client = new MockedClient() as jest.Mocked<GdexApiClient>;
  });

  // ── getTokenDetails ───────────────────────────────────────────────────────

  describe('getTokenDetails', () => {
    it('should fetch token details for a Solana token', async () => {
      const mockDetails = {
        address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        chain: 'solana',
        priceUsd: '1.00',
        marketCap: '43000000000',
      };
      client.get = jest.fn().mockResolvedValue(mockDetails);

      const details = await getTokenDetails(client, {
        tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        chain: 'solana',
      });

      expect(client.get).toHaveBeenCalledWith('/v1/token_details', expect.objectContaining({
        tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        chain: 'solana',
      }));
      expect(details).toEqual(mockDetails);
    });

    it('should fetch token details for an EVM token', async () => {
      client.get = jest.fn().mockResolvedValue({ address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' });

      await getTokenDetails(client, {
        tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        chain: ChainId.BASE,
      });

      expect(client.get).toHaveBeenCalledWith('/v1/token_details', expect.objectContaining({
        chain: ChainId.BASE,
      }));
    });

    it('should throw GdexValidationError for missing tokenAddress', async () => {
      await expect(
        getTokenDetails(client, {
          tokenAddress: '',
          chain: 'solana',
        })
      ).rejects.toThrow(GdexValidationError);
    });

    it('should throw GdexValidationError for unsupported chain', async () => {
      await expect(
        getTokenDetails(client, {
          tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          chain: 9999 as ChainId,
        })
      ).rejects.toThrow(GdexValidationError);
    });
  });

  // ── getTrendingTokens ─────────────────────────────────────────────────────

  describe('getTrendingTokens', () => {
    it('should fetch trending tokens without params', async () => {
      const mockTrending = [
        {
          rank: 1,
          address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          symbol: 'BONK',
          name: 'Bonk',
          chain: 'solana',
          priceUsd: '0.000025',
          priceChange: '+15.3',
          volume24h: '5000000',
          liquidity: '2000000',
        },
      ];
      client.get = jest.fn().mockResolvedValue(mockTrending);

      const tokens = await getTrendingTokens(client, {});

      expect(client.get).toHaveBeenCalledWith('/v1/trending/list', expect.any(Object));
      expect(tokens).toEqual(mockTrending);
    });

    it('should pass chain and period filters', async () => {
      client.get = jest.fn().mockResolvedValue([]);

      await getTrendingTokens(client, {
        chain: 'solana',
        period: '24h',
        limit: 10,
      });

      expect(client.get).toHaveBeenCalledWith('/v1/trending/list', expect.objectContaining({
        chain: 'solana',
        period: '24h',
        limit: 10,
      }));
    });

    it('should throw GdexValidationError for unsupported chain', async () => {
      await expect(
        getTrendingTokens(client, { chain: 9999 as ChainId })
      ).rejects.toThrow(GdexValidationError);
    });
  });

  // ── getOHLCV ──────────────────────────────────────────────────────────────

  describe('getOHLCV', () => {
    it('should fetch OHLCV data', async () => {
      const mockOHLCV = {
        tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        chain: 'solana',
        resolution: '60',
        candles: [
          {
            time: 1700000000,
            open: '1.00',
            high: '1.01',
            low: '0.99',
            close: '1.005',
            volume: '1000000',
          },
        ],
      };
      client.get = jest.fn().mockResolvedValue(mockOHLCV);

      const data = await getOHLCV(client, {
        tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        chain: 'solana',
        resolution: '60',
        from: 1700000000,
        to: 1700086400,
      });

      expect(client.get).toHaveBeenCalledWith('/v1/candles', expect.objectContaining({
        token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        chain: 'solana',
        resolution: '60',
        from: 1700000000,
        to: 1700086400,
      }));
      expect(data).toEqual(mockOHLCV);
    });

    it('should throw GdexValidationError for missing tokenAddress', async () => {
      await expect(
        getOHLCV(client, {
          tokenAddress: '',
          chain: 'solana',
          resolution: '60',
        })
      ).rejects.toThrow(GdexValidationError);
    });

    it('should throw GdexValidationError for missing resolution', async () => {
      await expect(
        getOHLCV(client, {
          tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          chain: 'solana',
          resolution: '' as '60',
        })
      ).rejects.toThrow(GdexValidationError);
    });
  });
});
