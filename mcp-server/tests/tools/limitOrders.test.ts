/**
 * E2E tests for limit order tools (limitOrders.ts)
 * Tools: limit_buy, limit_sell, update_order, get_limit_orders
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

const { registerLimitOrderTools } = await import('../../src/tools/limitOrders.js');

const authParams = {
  apiKey: 'test-key',
  userId: '0xUser',
  sessionPrivateKey: '0xSessionPk',
};

describe('Limit Order Tools', () => {
  const { server, getTools } = createMockServer();

  beforeAll(() => {
    registerLimitOrderTools(server);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registration', () => {
    it('should register all 4 limit order tools', () => {
      const tools = getTools();
      expect(tools.has('limit_buy')).toBe(true);
      expect(tools.has('limit_sell')).toBe(true);
      expect(tools.has('update_order')).toBe(true);
      expect(tools.has('get_limit_orders')).toBe(true);
      expect(tools.size).toBe(4);
    });
  });

  describe('limit_buy', () => {
    it('should call sdk.limitBuy with all params', async () => {
      mockSdk.limitBuy.mockResolvedValue({ orderId: 'abc123', status: 'pending' });
      const tool = getTools().get('limit_buy')!;
      const params = {
        ...authParams,
        chainId: 622112261,
        tokenAddress: 'So11111111111111111111111111111111111111112',
        amount: '1000000000',
        triggerPrice: '0.50',
        profitPercent: '50',
        lossPercent: '25',
      };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ orderId: 'abc123', status: 'pending' });
      expect(mockSdk.limitBuy).toHaveBeenCalledWith(params);
    });

    it('should handle defaults for profit/loss percent', async () => {
      mockSdk.limitBuy.mockResolvedValue({ orderId: 'def456' });
      const tool = getTools().get('limit_buy')!;
      await expectMcpSuccess(tool.handler, {
        ...authParams,
        chainId: 622112261,
        tokenAddress: '0xToken',
        amount: '500000000',
        triggerPrice: '1.00',
        profitPercent: '0',
        lossPercent: '0',
      });
    });
  });

  describe('limit_sell', () => {
    it('should call sdk.limitSell', async () => {
      mockSdk.limitSell.mockResolvedValue({ orderId: 'sell-1' });
      const tool = getTools().get('limit_sell')!;
      const params = {
        ...authParams,
        chainId: 622112261,
        tokenAddress: '0xToken',
        amount: '100000',
        triggerPrice: '2.00',
      };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ orderId: 'sell-1' });
      expect(mockSdk.limitSell).toHaveBeenCalledWith(params);
    });

    it('should handle errors', async () => {
      mockSdk.limitSell.mockRejectedValue(new Error('Token not found'));
      const tool = getTools().get('limit_sell')!;
      await expectMcpError(tool.handler, {
        ...authParams,
        chainId: 622112261,
        tokenAddress: '0xBad',
        amount: '100',
        triggerPrice: '1.00',
      }, 'Token not found');
    });
  });

  describe('update_order', () => {
    it('should call sdk.updateOrder for update', async () => {
      mockSdk.updateOrder.mockResolvedValue({ updated: true });
      const tool = getTools().get('update_order')!;
      const params = {
        ...authParams,
        chainId: 622112261,
        orderId: 'abc123def456'.padEnd(64, '0'),
        amount: '2000000000',
        triggerPrice: '0.75',
        isDelete: false,
      };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ updated: true });
    });

    it('should call sdk.updateOrder for deletion', async () => {
      mockSdk.updateOrder.mockResolvedValue({ deleted: true });
      const tool = getTools().get('update_order')!;
      const params = {
        ...authParams,
        chainId: 622112261,
        orderId: 'abc123def456'.padEnd(64, '0'),
        isDelete: true,
      };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ deleted: true });
    });
  });

  describe('get_limit_orders', () => {
    it('should call sdk.getLimitOrders', async () => {
      const orders = [{ orderId: 'o1', token: '0xT', amount: '100', triggerPrice: '1.0' }];
      mockSdk.getLimitOrders.mockResolvedValue(orders);
      const tool = getTools().get('get_limit_orders')!;
      const params = { userId: '0xUser', data: 'encrypted-session', chainId: 622112261 };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual(orders);
      expect(mockSdk.getLimitOrders).toHaveBeenCalledWith(params);
    });
  });
});
