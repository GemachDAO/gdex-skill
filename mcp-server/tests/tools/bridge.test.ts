/**
 * E2E tests for bridge tools (bridge.ts)
 * Tools: estimate_bridge, execute_bridge, get_bridge_orders
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

const { registerBridgeTools } = await import('../../src/tools/bridge.js');

describe('Bridge Tools', () => {
  const { server, getTools } = createMockServer();

  beforeAll(() => {
    registerBridgeTools(server);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registration', () => {
    it('should register all 3 bridge tools', () => {
      const tools = getTools();
      expect(tools.has('estimate_bridge')).toBe(true);
      expect(tools.has('execute_bridge')).toBe(true);
      expect(tools.has('get_bridge_orders')).toBe(true);
      expect(tools.size).toBe(3);
    });
  });

  describe('estimate_bridge', () => {
    it('should call estimateBridge and return quote', async () => {
      const quote = { estimatedOutput: '99.5', provider: 'Wormhole', estimatedTime: 120 };
      mockSdk.estimateBridge.mockResolvedValue(quote);
      const tool = getTools().get('estimate_bridge')!;
      const params = { fromChainId: 42161, toChainId: 622112261, amount: '100000000' };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual(quote);
      expect(mockSdk.estimateBridge).toHaveBeenCalledWith(params);
    });

    it('should handle unsupported routes', async () => {
      mockSdk.estimateBridge.mockRejectedValue(new Error('Route not supported'));
      const tool = getTools().get('estimate_bridge')!;
      await expectMcpError(tool.handler, {
        fromChainId: 999,
        toChainId: 1,
        amount: '1000',
      }, 'Route not supported');
    });
  });

  describe('execute_bridge', () => {
    it('should call requestBridge with auth params', async () => {
      mockSdk.requestBridge.mockResolvedValue({ txHash: '0xBridge', status: 'pending' });
      const tool = getTools().get('execute_bridge')!;
      const params = {
        fromChainId: 42161,
        toChainId: 622112261,
        amount: '100000000',
        userId: '0xUser',
        sessionPrivateKey: '0xSk',
        apiKey: 'key',
      };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ txHash: '0xBridge', status: 'pending' });
      expect(mockSdk.requestBridge).toHaveBeenCalledWith(params);
    });
  });

  describe('get_bridge_orders', () => {
    it('should call getBridgeOrders', async () => {
      const orders = [{ id: 'b1', status: 'completed', amount: '100', fromChain: 42161, toChain: 622112261 }];
      mockSdk.getBridgeOrders.mockResolvedValue(orders);
      const tool = getTools().get('get_bridge_orders')!;
      const params = { userId: '0xUser', data: 'enc-session' };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual(orders);
      expect(mockSdk.getBridgeOrders).toHaveBeenCalledWith(params);
    });
  });
});
