/**
 * E2E tests for perp trade tools (perpTrade.ts)
 * Tools: open_perp_position, place_perp_order, close_perp_position, close_all_positions,
 *        cancel_perp_order, cancel_all_perp_orders, set_leverage, perp_deposit, perp_withdraw
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

const { registerPerpTradeTools } = await import('../../src/tools/perpTrade.js');

const hlCreds = {
  apiKey: 'test-api-key',
  walletAddress: '0xWallet',
  sessionPrivateKey: '0xSessionKey',
};

describe('Perp Trade Tools', () => {
  const { server, getTools } = createMockServer();

  beforeAll(() => {
    registerPerpTradeTools(server);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registration', () => {
    it('should register all 9 perp trade tools', () => {
      const tools = getTools();
      expect(tools.has('open_perp_position')).toBe(true);
      expect(tools.has('place_perp_order')).toBe(true);
      expect(tools.has('close_perp_position')).toBe(true);
      expect(tools.has('close_all_positions')).toBe(true);
      expect(tools.has('cancel_perp_order')).toBe(true);
      expect(tools.has('cancel_all_perp_orders')).toBe(true);
      expect(tools.has('set_leverage')).toBe(true);
      expect(tools.has('perp_deposit')).toBe(true);
      expect(tools.has('perp_withdraw')).toBe(true);
      expect(tools.size).toBe(9);
    });
  });

  describe('open_perp_position', () => {
    it('should call hlCreateOrder with full params', async () => {
      const orderResult = { orderId: '12345', status: 'filled' };
      mockSdk.hlCreateOrder.mockResolvedValue(orderResult);
      const tool = getTools().get('open_perp_position')!;
      const params = {
        ...hlCreds,
        coin: 'BTC',
        isLong: true,
        price: '50000',
        size: '0.1',
        reduceOnly: false,
        tpPrice: '55000',
        slPrice: '48000',
        isMarket: true,
      };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual(orderResult);
      expect(mockSdk.hlCreateOrder).toHaveBeenCalledWith(params);
    });

    it('should handle market orders with no TP/SL', async () => {
      mockSdk.hlCreateOrder.mockResolvedValue({ orderId: '999' });
      const tool = getTools().get('open_perp_position')!;
      await expectMcpSuccess(tool.handler, {
        ...hlCreds,
        coin: 'ETH',
        isLong: false,
        price: '3000',
        size: '1',
        reduceOnly: false,
        tpPrice: '',
        slPrice: '',
        isMarket: true,
      });
    });

    it('should propagate SDK errors', async () => {
      mockSdk.hlCreateOrder.mockRejectedValue(new Error('Position limit exceeded'));
      const tool = getTools().get('open_perp_position')!;
      await expectMcpError(tool.handler, {
        ...hlCreds, coin: 'BTC', isLong: true, price: '50000', size: '10',
        reduceOnly: false, tpPrice: '', slPrice: '', isMarket: true,
      }, 'Position limit exceeded');
    });
  });

  describe('place_perp_order', () => {
    it('should call hlPlaceOrder', async () => {
      mockSdk.hlPlaceOrder.mockResolvedValue({ orderId: '777' });
      const tool = getTools().get('place_perp_order')!;
      const params = { ...hlCreds, coin: 'SOL', isLong: true, price: '100', size: '5', reduceOnly: false, isMarket: false };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ orderId: '777' });
      expect(mockSdk.hlPlaceOrder).toHaveBeenCalledWith(params);
    });
  });

  describe('close_perp_position', () => {
    it('should call hlCreateOrder with reduceOnly=true and isLong=false', async () => {
      mockSdk.hlCreateOrder.mockResolvedValue({ status: 'closed' });
      const tool = getTools().get('close_perp_position')!;
      const params = { ...hlCreds, coin: 'BTC', size: '0.1', price: '50000' };
      await expectMcpSuccess(tool.handler, params);
      expect(mockSdk.hlCreateOrder).toHaveBeenCalledWith(expect.objectContaining({
        coin: 'BTC',
        isLong: false,
        reduceOnly: true,
        isMarket: true,
        tpPrice: '',
        slPrice: '',
      }));
    });
  });

  describe('close_all_positions', () => {
    it('should call hlCloseAll', async () => {
      mockSdk.hlCloseAll.mockResolvedValue({ closed: 3 });
      const tool = getTools().get('close_all_positions')!;
      const result = await expectMcpSuccess(tool.handler, hlCreds);
      expect(result).toEqual({ closed: 3 });
      expect(mockSdk.hlCloseAll).toHaveBeenCalledWith(hlCreds);
    });
  });

  describe('cancel_perp_order', () => {
    it('should call hlCancelOrder with coin and orderId', async () => {
      mockSdk.hlCancelOrder.mockResolvedValue({ cancelled: true });
      const tool = getTools().get('cancel_perp_order')!;
      const params = { ...hlCreds, coin: 'ETH', orderId: '12345' };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ cancelled: true });
      expect(mockSdk.hlCancelOrder).toHaveBeenCalledWith(params);
    });
  });

  describe('cancel_all_perp_orders', () => {
    it('should call hlCancelAllOrders', async () => {
      mockSdk.hlCancelAllOrders.mockResolvedValue({ cancelled: 5 });
      const tool = getTools().get('cancel_all_perp_orders')!;
      const result = await expectMcpSuccess(tool.handler, hlCreds);
      expect(result).toEqual({ cancelled: 5 });
    });
  });

  describe('set_leverage', () => {
    it('should call hlUpdateLeverage', async () => {
      mockSdk.hlUpdateLeverage.mockResolvedValue({ leverage: 10 });
      const tool = getTools().get('set_leverage')!;
      const params = { ...hlCreds, coin: 'BTC', leverage: 10, isCross: true };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ leverage: 10 });
      expect(mockSdk.hlUpdateLeverage).toHaveBeenCalledWith(params);
    });
  });

  describe('perp_deposit', () => {
    it('should call perpDeposit', async () => {
      mockSdk.perpDeposit.mockResolvedValue({ txHash: '0xDeposit' });
      const tool = getTools().get('perp_deposit')!;
      const params = { ...hlCreds, tokenAddress: '0xUSDC', amount: '100', chainId: 42161 };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ txHash: '0xDeposit' });
      expect(mockSdk.perpDeposit).toHaveBeenCalledWith(params);
    });
  });

  describe('perp_withdraw', () => {
    it('should call perpWithdraw', async () => {
      mockSdk.perpWithdraw.mockResolvedValue({ txHash: '0xWithdraw' });
      const tool = getTools().get('perp_withdraw')!;
      const params = { ...hlCreds, amount: '50' };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ txHash: '0xWithdraw' });
      expect(mockSdk.perpWithdraw).toHaveBeenCalledWith(params);
    });
  });
});
