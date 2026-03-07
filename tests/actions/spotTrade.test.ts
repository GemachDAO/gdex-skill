/**
 * Tests for spot trading actions.
 */
import { GdexApiClient } from '../../src/client';
import { buyToken, sellToken } from '../../src/actions/spotTrade';
import { GdexValidationError } from '../../src/utils/errors';
import { ChainId } from '../../src/types/common';

// Mock the GdexApiClient
jest.mock('../../src/client');
const MockedClient = GdexApiClient as jest.MockedClass<typeof GdexApiClient>;

describe('spotTrade', () => {
  let client: jest.Mocked<GdexApiClient>;

  beforeEach(() => {
    client = new MockedClient() as jest.Mocked<GdexApiClient>;
  });

  // ── buyToken ──────────────────────────────────────────────────────────────

  describe('buyToken', () => {
    it('should call the correct endpoint with valid Solana params', async () => {
      const mockResult = {
        txHash: 'abc123',
        chain: 'solana',
        status: 'confirmed',
        inputToken: 'So11111111111111111111111111111111111111112',
        outputToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inputAmount: '0.1',
        outputAmount: '15.5',
        executionPrice: '155',
      };
      client.post = jest.fn().mockResolvedValue(mockResult);

      const result = await buyToken(client, {
        chain: 'solana',
        tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: '0.1',
        slippage: 1,
      });

      expect(client.post).toHaveBeenCalledWith('/v1/purchase_v2', expect.objectContaining({
        chain: 'solana',
        tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: '0.1',
        slippage: 1,
      }));
      expect(result).toEqual(mockResult);
    });

    it('should use default slippage of 1 when not specified', async () => {
      client.post = jest.fn().mockResolvedValue({});

      await buyToken(client, {
        chain: 'solana',
        tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: '1.0',
      });

      expect(client.post).toHaveBeenCalledWith('/v1/purchase_v2', expect.objectContaining({
        slippage: 1,
      }));
    });

    it('should work with EVM chain and address', async () => {
      client.post = jest.fn().mockResolvedValue({});

      await buyToken(client, {
        chain: ChainId.BASE,
        tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        amount: '0.01',
      });

      expect(client.post).toHaveBeenCalledWith('/v1/purchase_v2', expect.objectContaining({
        chain: ChainId.BASE,
        tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      }));
    });

    it('should throw GdexValidationError for invalid Solana address', async () => {
      await expect(
        buyToken(client, {
          chain: 'solana',
          tokenAddress: 'not_a_valid_address!@#',
          amount: '0.1',
        })
      ).rejects.toThrow(GdexValidationError);
    });

    it('should throw GdexValidationError for invalid EVM address', async () => {
      await expect(
        buyToken(client, {
          chain: ChainId.ETHEREUM,
          tokenAddress: 'not-an-evm-address',
          amount: '0.1',
        })
      ).rejects.toThrow(GdexValidationError);
    });

    it('should throw GdexValidationError for zero amount', async () => {
      await expect(
        buyToken(client, {
          chain: 'solana',
          tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amount: '0',
        })
      ).rejects.toThrow(GdexValidationError);
    });

    it('should throw GdexValidationError for negative amount', async () => {
      await expect(
        buyToken(client, {
          chain: 'solana',
          tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amount: '-1',
        })
      ).rejects.toThrow(GdexValidationError);
    });

    it('should throw GdexValidationError for slippage > 100', async () => {
      await expect(
        buyToken(client, {
          chain: 'solana',
          tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amount: '1.0',
          slippage: 101,
        })
      ).rejects.toThrow(GdexValidationError);
    });
  });

  // ── sellToken ─────────────────────────────────────────────────────────────

  describe('sellToken', () => {
    it('should call the correct endpoint with valid params', async () => {
      const mockResult = {
        txHash: 'def456',
        chain: 'solana',
        status: 'confirmed',
        inputToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        outputToken: 'So11111111111111111111111111111111111111112',
        inputAmount: '100',
        outputAmount: '0.64',
        executionPrice: '0.0064',
      };
      client.post = jest.fn().mockResolvedValue(mockResult);

      const result = await sellToken(client, {
        chain: 'solana',
        tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: '100',
        slippage: 0.5,
      });

      expect(client.post).toHaveBeenCalledWith('/v1/sell_v2', expect.objectContaining({
        chain: 'solana',
        amount: '100',
        slippage: 0.5,
      }));
      expect(result).toEqual(mockResult);
    });

    it('should allow percentage amount strings', async () => {
      client.post = jest.fn().mockResolvedValue({});

      await sellToken(client, {
        chain: 'solana',
        tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: '50%',
      });

      expect(client.post).toHaveBeenCalledWith('/v1/sell_v2', expect.objectContaining({
        amount: '50%',
      }));
    });

    it('should throw GdexValidationError for invalid percentage > 100%', async () => {
      await expect(
        sellToken(client, {
          chain: 'solana',
          tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amount: '101%',
        })
      ).rejects.toThrow(GdexValidationError);
    });
  });
});
