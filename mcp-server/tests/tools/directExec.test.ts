/**
 * E2E tests for direct execution tools (directExec.ts)
 * Tools: execute_cross_perp, execute_isolated_perp, execute_spot, direct_cancel_order
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

const { registerDirectExecTools } = await import('../../src/tools/directExec.js');

const pk = '0xabc123def456';

describe('Direct Exec Tools', () => {
  const { server, getTools } = createMockServer();

  beforeAll(() => {
    registerDirectExecTools(server);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registration', () => {
    it('should register all 4 direct exec tools', () => {
      const tools = getTools();
      expect(tools.has('execute_cross_perp')).toBe(true);
      expect(tools.has('execute_isolated_perp')).toBe(true);
      expect(tools.has('execute_spot')).toBe(true);
      expect(tools.has('direct_cancel_order')).toBe(true);
      expect(tools.size).toBe(4);
    });
  });

  describe('execute_cross_perp', () => {
    it('should call hlExecuteCrossPerp with built trade params', async () => {
      mockSdk.hlExecuteCrossPerp.mockResolvedValue({ status: 'filled', orderId: '1' });
      const tool = getTools().get('execute_cross_perp')!;
      const params = {
        privateKey: pk,
        coin: 'BTC',
        isLong: true,
        price: '50000',
        positionSize: '0.1',
        reduceOnly: false,
        leverage: 10,
        isMarket: true,
      };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ status: 'filled', orderId: '1' });
      expect(mockSdk.hlExecuteCrossPerp).toHaveBeenCalledWith(
        pk,
        expect.objectContaining({
          coin: 'BTC',
          isLong: true,
          price: '50000',
          positionSize: '0.1',
          reduceOnly: false,
          leverage: 10,
        }),
        true, // isMarket
      );
    });

    it('should include TP/SL and builder fee when provided', async () => {
      mockSdk.hlExecuteCrossPerp.mockResolvedValue({ status: 'filled' });
      const tool = getTools().get('execute_cross_perp')!;
      await expectMcpSuccess(tool.handler, {
        privateKey: pk,
        coin: 'ETH',
        isLong: false,
        price: '3000',
        positionSize: '1',
        reduceOnly: false,
        isMarket: false,
        takeProfitPrice: '2800',
        takeProfitTrigger: '2850',
        stopLossPrice: '3200',
        stopLossTrigger: '3150',
        builderFeeAddress: '0xBuilder',
        builderFeeRate: 5,
      });
      expect(mockSdk.hlExecuteCrossPerp).toHaveBeenCalledWith(
        pk,
        expect.objectContaining({
          takeProfit: { price: '2800', triggerPrice: '2850' },
          stopLoss: { price: '3200', triggerPrice: '3150' },
          builderFee: { address: '0xBuilder', feeRate: 5 },
        }),
        false,
      );
    });

    it('should not include TP/SL when not provided', async () => {
      mockSdk.hlExecuteCrossPerp.mockResolvedValue({ status: 'filled' });
      const tool = getTools().get('execute_cross_perp')!;
      await expectMcpSuccess(tool.handler, {
        privateKey: pk,
        coin: 'BTC',
        isLong: true,
        price: '50000',
        positionSize: '0.1',
        reduceOnly: false,
        isMarket: true,
      });
      const calledParams = mockSdk.hlExecuteCrossPerp.mock.calls[0][1];
      expect(calledParams).not.toHaveProperty('takeProfit');
      expect(calledParams).not.toHaveProperty('stopLoss');
      expect(calledParams).not.toHaveProperty('builderFee');
    });
  });

  describe('execute_isolated_perp', () => {
    it('should call hlExecuteIsolatedPerp with leverage', async () => {
      mockSdk.hlExecuteIsolatedPerp.mockResolvedValue({ status: 'filled' });
      const tool = getTools().get('execute_isolated_perp')!;
      const params = {
        privateKey: pk,
        coin: 'SOL',
        isLong: true,
        price: '100',
        positionSize: '10',
        leverage: 20,
        reduceOnly: false,
        isMarket: true,
      };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ status: 'filled' });
      expect(mockSdk.hlExecuteIsolatedPerp).toHaveBeenCalledWith(
        pk,
        expect.objectContaining({ coin: 'SOL', leverage: 20 }),
        true,
      );
    });
  });

  describe('execute_spot', () => {
    it('should call hlExecuteSpot', async () => {
      mockSdk.hlExecuteSpot.mockResolvedValue({ status: 'filled', fills: [] });
      const tool = getTools().get('execute_spot')!;
      const params = {
        privateKey: pk,
        coin: 'PURR',
        isBuy: true,
        price: '0.5',
        size: '100',
        isMarket: true,
      };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ status: 'filled', fills: [] });
      expect(mockSdk.hlExecuteSpot).toHaveBeenCalledWith(
        pk,
        expect.objectContaining({ coin: 'PURR', isBuy: true }),
        true,
      );
    });

    it('should include builder fee when provided', async () => {
      mockSdk.hlExecuteSpot.mockResolvedValue({ status: 'filled' });
      const tool = getTools().get('execute_spot')!;
      await expectMcpSuccess(tool.handler, {
        privateKey: pk,
        coin: 'PURR',
        isBuy: false,
        price: '0.5',
        size: '100',
        isMarket: false,
        builderFeeAddress: '0xBuilder',
        builderFeeRate: 3,
      });
      const calledParams = mockSdk.hlExecuteSpot.mock.calls[0][1];
      expect(calledParams.builderFee).toEqual({ address: '0xBuilder', feeRate: 3 });
    });
  });

  describe('direct_cancel_order', () => {
    it('should call hlDirectCancelOrder', async () => {
      mockSdk.hlDirectCancelOrder.mockResolvedValue({ cancelled: true });
      const tool = getTools().get('direct_cancel_order')!;
      const result = await expectMcpSuccess(tool.handler, {
        privateKey: pk,
        coin: 'BTC',
        orderId: 12345,
      });
      expect(result).toEqual({ cancelled: true });
      expect(mockSdk.hlDirectCancelOrder).toHaveBeenCalledWith(pk, 'BTC', 12345);
    });

    it('should handle cancellation failure', async () => {
      mockSdk.hlDirectCancelOrder.mockRejectedValue(new Error('Order not found'));
      const tool = getTools().get('direct_cancel_order')!;
      await expectMcpError(tool.handler, { privateKey: pk, coin: 'BTC', orderId: 99999 }, 'Order not found');
    });
  });
});
