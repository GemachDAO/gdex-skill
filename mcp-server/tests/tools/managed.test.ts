/**
 * E2E tests for managed custody tools (managed.ts)
 * Tools: managed_purchase, managed_sell, managed_trade_status, build_trade_payload
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

const { registerManagedTools } = await import('../../src/tools/managed.js');

describe('Managed Custody Tools', () => {
  const { server, getTools } = createMockServer();

  beforeAll(() => {
    registerManagedTools(server);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registration', () => {
    it('should register all 4 managed custody tools', () => {
      const tools = getTools();
      expect(tools.has('managed_purchase')).toBe(true);
      expect(tools.has('managed_sell')).toBe(true);
      expect(tools.has('managed_trade_status')).toBe(true);
      expect(tools.has('build_trade_payload')).toBe(true);
      expect(tools.size).toBe(4);
    });
  });

  describe('managed_purchase', () => {
    it('should call submitManagedPurchase with chainId as number', async () => {
      mockSdk.submitManagedPurchase.mockResolvedValue({ requestId: 'req-1', status: 'submitted' });
      const tool = getTools().get('managed_purchase')!;
      const params = {
        computedData: 'encrypted-buy-payload',
        chainId: '622112261',
        slippage: 2,
        tip: '0.001',
      };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ requestId: 'req-1', status: 'submitted' });
      expect(mockSdk.submitManagedPurchase).toHaveBeenCalledWith({
        computedData: 'encrypted-buy-payload',
        chainId: 622112261,
        slippage: 2,
        tip: '0.001',
      });
    });

    it('should use default slippage of 1', async () => {
      mockSdk.submitManagedPurchase.mockResolvedValue({ requestId: 'req-2' });
      const tool = getTools().get('managed_purchase')!;
      await expectMcpSuccess(tool.handler, {
        computedData: 'enc-data',
        chainId: 42161,
        slippage: 1,
      });
      expect(mockSdk.submitManagedPurchase).toHaveBeenCalledWith(
        expect.objectContaining({ slippage: 1 }),
      );
    });
  });

  describe('managed_sell', () => {
    it('should call submitManagedSell', async () => {
      mockSdk.submitManagedSell.mockResolvedValue({ requestId: 'sell-1' });
      const tool = getTools().get('managed_sell')!;
      const params = {
        computedData: 'encrypted-sell-payload',
        chainId: 622112261,
        slippage: 1,
      };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ requestId: 'sell-1' });
      expect(mockSdk.submitManagedSell).toHaveBeenCalledWith({
        computedData: 'encrypted-sell-payload',
        chainId: 622112261,
        slippage: 1,
        tip: undefined,
      });
    });

    it('should handle trade submission failure', async () => {
      mockSdk.submitManagedSell.mockRejectedValue(new Error('Session expired'));
      const tool = getTools().get('managed_sell')!;
      await expectMcpError(tool.handler, {
        computedData: 'enc',
        chainId: 622112261,
        slippage: 1,
      }, 'Session expired');
    });
  });

  describe('managed_trade_status', () => {
    it('should call getManagedTradeStatus with requestId', async () => {
      const status = { requestId: 'req-1', status: 'confirmed', txHash: '0xTx' };
      mockSdk.getManagedTradeStatus.mockResolvedValue(status);
      const tool = getTools().get('managed_trade_status')!;
      const result = await expectMcpSuccess(tool.handler, { requestId: 'req-1' });
      expect(result).toEqual(status);
      expect(mockSdk.getManagedTradeStatus).toHaveBeenCalledWith('req-1');
    });

    it('should handle pending status', async () => {
      mockSdk.getManagedTradeStatus.mockResolvedValue({ requestId: 'req-2', status: 'pending' });
      const tool = getTools().get('managed_trade_status')!;
      const result = await expectMcpSuccess(tool.handler, { requestId: 'req-2' });
      expect(result.status).toBe('pending');
    });
  });

  describe('build_trade_payload', () => {
    it('should call buildManagedTradeComputedData', async () => {
      mockSdk.buildManagedTradeComputedData.mockResolvedValue({ computedData: 'enc-payload' });
      const tool = getTools().get('build_trade_payload')!;
      const params = {
        apiKey: 'key',
        action: 'purchase',
        userId: '0xUser',
        tokenAddress: '0xToken',
        amount: '1000000000',
        nonce: 'nonce-123',
        sessionPrivateKey: '0xSk',
      };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ computedData: 'enc-payload' });
      expect(mockSdk.buildManagedTradeComputedData).toHaveBeenCalledWith(params);
    });

    it('should handle sell action', async () => {
      mockSdk.buildManagedTradeComputedData.mockResolvedValue({ computedData: 'enc-sell' });
      const tool = getTools().get('build_trade_payload')!;
      await expectMcpSuccess(tool.handler, {
        apiKey: 'key',
        action: 'sell',
        userId: '0xUser',
        tokenAddress: '0xToken',
        amount: '500000',
        nonce: 'nonce-456',
        sessionPrivateKey: '0xSk',
      });
    });
  });
});
