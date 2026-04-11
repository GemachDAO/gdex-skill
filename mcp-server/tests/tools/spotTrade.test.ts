/**
 * E2E tests for spot trade tools (spotTrade.ts)
 * Tools: buy_token, sell_token
 */
import { jest, describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import { createMockSdk, createMockServer, expectMcpSuccess, expectMcpError } from '../helpers.js';

const mockSdk = createMockSdk();
jest.unstable_mockModule('../../src/sdk.js', () => ({
  getSdk: () => mockSdk,
  handleToolCall: jest.fn(async (fn: () => Promise<any>) => {
    try {
      const result = await fn();
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return { content: [{ type: 'text' as const, text }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text: `❌ Error: ${message}` }] };
    }
  }),
}));

const { registerSpotTradeTools } = await import('../../src/tools/spotTrade.js');

describe('Spot Trade Tools', () => {
  const { server, getTools } = createMockServer();

  beforeAll(() => {
    registerSpotTradeTools(server);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registration', () => {
    it('should register buy_token and sell_token', () => {
      const tools = getTools();
      expect(tools.has('buy_token')).toBe(true);
      expect(tools.has('sell_token')).toBe(true);
      expect(tools.size).toBe(2);
    });
  });

  describe('buy_token', () => {
    it('should call sdk.buyToken with params', async () => {
      const txResult = { txHash: '0xabc', status: 'confirmed' };
      mockSdk.buyToken.mockResolvedValue(txResult);
      const tool = getTools().get('buy_token')!;
      const params = {
        chain: 'solana',
        tokenAddress: 'So11111111111111111111111111111111111111112',
        amount: '0.1',
        slippage: 2,
      };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual(txResult);
      expect(mockSdk.buyToken).toHaveBeenCalledWith(params);
    });

    it('should handle optional params', async () => {
      mockSdk.buyToken.mockResolvedValue({ txHash: '0x123' });
      const tool = getTools().get('buy_token')!;
      const params = {
        chain: 8453,
        tokenAddress: '0xToken',
        amount: '0.5',
        slippage: 1,
        dex: 'uniswap-v3',
        walletAddress: '0xWallet',
        referrer: '0xRef',
        priorityFee: 0.001,
        inputToken: '0xUSDC',
      };
      await expectMcpSuccess(tool.handler, params);
      expect(mockSdk.buyToken).toHaveBeenCalledWith(params);
    });

    it('should wrap SDK errors', async () => {
      mockSdk.buyToken.mockRejectedValue(new Error('Insufficient balance'));
      const tool = getTools().get('buy_token')!;
      await expectMcpError(tool.handler, {
        chain: 'solana',
        tokenAddress: '0xToken',
        amount: '1',
        slippage: 1,
      }, 'Insufficient balance');
    });
  });

  describe('sell_token', () => {
    it('should call sdk.sellToken with params', async () => {
      const txResult = { txHash: '0xdef', status: 'confirmed' };
      mockSdk.sellToken.mockResolvedValue(txResult);
      const tool = getTools().get('sell_token')!;
      const params = {
        chain: 'solana',
        tokenAddress: '0xToken',
        amount: '50%',
        slippage: 1,
      };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual(txResult);
      expect(mockSdk.sellToken).toHaveBeenCalledWith(params);
    });

    it('should handle percentage amounts', async () => {
      mockSdk.sellToken.mockResolvedValue({ txHash: '0x789' });
      const tool = getTools().get('sell_token')!;
      await expectMcpSuccess(tool.handler, {
        chain: 1,
        tokenAddress: '0xToken',
        amount: '100%',
        slippage: 0.5,
        dex: 'odos',
        outputToken: '0xUSDC',
      });
    });
  });
});
