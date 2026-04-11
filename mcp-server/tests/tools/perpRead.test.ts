/**
 * E2E tests for perp read tools (perpRead.ts)
 * Tools: get_account_state, get_perp_positions, get_mark_price, get_all_mid_prices,
 *        get_usdc_balance, get_hl_open_orders, get_hl_trade_history, get_hl_spot_state, get_trader_leverage
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

const { registerPerpReadTools } = await import('../../src/tools/perpRead.js');

const wallet = '0xTestWallet';

describe('Perp Read Tools', () => {
  const { server, getTools } = createMockServer();

  beforeAll(() => {
    registerPerpReadTools(server);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registration', () => {
    it('should register all 9 perp read tools', () => {
      const tools = getTools();
      expect(tools.has('get_account_state')).toBe(true);
      expect(tools.has('get_perp_positions')).toBe(true);
      expect(tools.has('get_mark_price')).toBe(true);
      expect(tools.has('get_all_mid_prices')).toBe(true);
      expect(tools.has('get_usdc_balance')).toBe(true);
      expect(tools.has('get_hl_open_orders')).toBe(true);
      expect(tools.has('get_hl_trade_history')).toBe(true);
      expect(tools.has('get_hl_spot_state')).toBe(true);
      expect(tools.has('get_trader_leverage')).toBe(true);
      expect(tools.size).toBe(9);
    });
  });

  describe('get_account_state', () => {
    it('should call getHlAccountState with wallet address', async () => {
      const state = { marginSummary: { accountValue: '10000' }, assetPositions: [] };
      mockSdk.getHlAccountState.mockResolvedValue(state);
      const tool = getTools().get('get_account_state')!;
      const result = await expectMcpSuccess(tool.handler, { walletAddress: wallet });
      expect(result).toEqual(state);
      expect(mockSdk.getHlAccountState).toHaveBeenCalledWith(wallet);
    });
  });

  describe('get_perp_positions', () => {
    it('should call getPerpPositions with wallet and optional coin', async () => {
      const positions = [{ coin: 'BTC', size: '0.1', entryPx: '50000' }];
      mockSdk.getPerpPositions.mockResolvedValue(positions);
      const tool = getTools().get('get_perp_positions')!;
      const result = await expectMcpSuccess(tool.handler, { walletAddress: wallet, coin: 'BTC' });
      expect(result).toEqual(positions);
      expect(mockSdk.getPerpPositions).toHaveBeenCalledWith({ walletAddress: wallet, coin: 'BTC' });
    });

    it('should work without coin filter', async () => {
      mockSdk.getPerpPositions.mockResolvedValue([]);
      const tool = getTools().get('get_perp_positions')!;
      await expectMcpSuccess(tool.handler, { walletAddress: wallet });
      expect(mockSdk.getPerpPositions).toHaveBeenCalledWith({ walletAddress: wallet });
    });
  });

  describe('get_mark_price', () => {
    it('should return coin and markPrice', async () => {
      mockSdk.getHlMarkPrice.mockResolvedValue('50123.45');
      const tool = getTools().get('get_mark_price')!;
      const result = await expectMcpSuccess(tool.handler, { coin: 'BTC' });
      expect(result).toEqual({ coin: 'BTC', markPrice: '50123.45' });
      expect(mockSdk.getHlMarkPrice).toHaveBeenCalledWith('BTC');
    });
  });

  describe('get_all_mid_prices', () => {
    it('should return all mid prices', async () => {
      const mids = { BTC: '50000', ETH: '3000', SOL: '100' };
      mockSdk.getHlAllMids.mockResolvedValue(mids);
      const tool = getTools().get('get_all_mid_prices')!;
      const result = await expectMcpSuccess(tool.handler, {});
      expect(result).toEqual(mids);
    });
  });

  describe('get_usdc_balance', () => {
    it('should return wallet address and balance', async () => {
      mockSdk.getHlUsdcBalance.mockResolvedValue('5000.00');
      const tool = getTools().get('get_usdc_balance')!;
      const result = await expectMcpSuccess(tool.handler, { walletAddress: wallet });
      expect(result).toEqual({ walletAddress: wallet, usdcBalance: '5000.00' });
    });
  });

  describe('get_hl_open_orders', () => {
    it('should return open orders', async () => {
      const orders = [{ oid: 1, coin: 'BTC', side: 'B', sz: '0.1', limitPx: '49000' }];
      mockSdk.getHlOpenOrders.mockResolvedValue(orders);
      const tool = getTools().get('get_hl_open_orders')!;
      const result = await expectMcpSuccess(tool.handler, { walletAddress: wallet });
      expect(result).toEqual(orders);
      expect(mockSdk.getHlOpenOrders).toHaveBeenCalledWith(wallet);
    });
  });

  describe('get_hl_trade_history', () => {
    it('should return trade history', async () => {
      const trades = [{ coin: 'ETH', side: 'B', px: '3000', sz: '1', time: 1700000000 }];
      mockSdk.getHlTradeHistory.mockResolvedValue(trades);
      const tool = getTools().get('get_hl_trade_history')!;
      const result = await expectMcpSuccess(tool.handler, { walletAddress: wallet });
      expect(result).toEqual(trades);
    });
  });

  describe('get_hl_spot_state', () => {
    it('should return spot state', async () => {
      const spotState = { balances: [{ coin: 'USDC', total: '5000' }] };
      mockSdk.getHlSpotState.mockResolvedValue(spotState);
      const tool = getTools().get('get_hl_spot_state')!;
      const result = await expectMcpSuccess(tool.handler, { walletAddress: wallet });
      expect(result).toEqual(spotState);
    });
  });

  describe('get_trader_leverage', () => {
    it('should return trader wallet, coin, and leverage', async () => {
      mockSdk.getHlTraderLeverageContext.mockResolvedValue({ value: 10, type: 'cross' });
      const tool = getTools().get('get_trader_leverage')!;
      const result = await expectMcpSuccess(tool.handler, { traderWallet: wallet, coin: 'BTC' });
      expect(result).toEqual({
        traderWallet: wallet,
        coin: 'BTC',
        leverage: { value: 10, type: 'cross' },
      });
      expect(mockSdk.getHlTraderLeverageContext).toHaveBeenCalledWith(wallet, 'BTC');
    });
  });
});
