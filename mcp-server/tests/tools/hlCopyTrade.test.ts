/**
 * E2E tests for HL copy trade tools (hlCopyTrade.ts)
 * Tools: get_hl_top_traders, get_hl_top_traders_by_pnl, get_hl_user_stats, get_hl_perp_dexes,
 *        get_hl_all_assets, get_hl_clearinghouse_state, get_hl_meta_and_asset_ctxs,
 *        get_hl_deposit_tokens, get_hl_copy_trade_list, get_hl_copy_trade_tx_list,
 *        create_hl_copy_trade, update_hl_copy_trade
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

const { registerHlCopyTradeTools } = await import('../../src/tools/hlCopyTrade.js');

describe('HL Copy Trade Tools', () => {
  const { server, getTools } = createMockServer();

  beforeAll(() => {
    registerHlCopyTradeTools(server);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registration', () => {
    it('should register all 12 HL copy trade tools', () => {
      const tools = getTools();
      const expectedTools = [
        'get_hl_top_traders', 'get_hl_top_traders_by_pnl', 'get_hl_user_stats',
        'get_hl_perp_dexes', 'get_hl_all_assets', 'get_hl_clearinghouse_state',
        'get_hl_meta_and_asset_ctxs', 'get_hl_deposit_tokens',
        'get_hl_copy_trade_list', 'get_hl_copy_trade_tx_list',
        'create_hl_copy_trade', 'update_hl_copy_trade',
      ];
      for (const name of expectedTools) {
        expect(tools.has(name)).toBe(true);
      }
      expect(tools.size).toBe(12);
    });
  });

  // --- Discovery ---

  describe('get_hl_top_traders', () => {
    it('should call getHlTopTraders with sort param', async () => {
      const traders = [{ address: '0xT1', volume: 1000000 }];
      mockSdk.getHlTopTraders.mockResolvedValue(traders);
      const tool = getTools().get('get_hl_top_traders')!;
      const result = await expectMcpSuccess(tool.handler, { sort: 'volume' });
      expect(result).toEqual(traders);
      expect(mockSdk.getHlTopTraders).toHaveBeenCalledWith('volume');
    });
  });

  describe('get_hl_top_traders_by_pnl', () => {
    it('should call getHlTopTradersByPnl', async () => {
      mockSdk.getHlTopTradersByPnl.mockResolvedValue({ day: [], week: [], month: [] });
      const tool = getTools().get('get_hl_top_traders_by_pnl')!;
      await expectMcpSuccess(tool.handler, {});
      expect(mockSdk.getHlTopTradersByPnl).toHaveBeenCalled();
    });
  });

  describe('get_hl_user_stats', () => {
    it('should call getHlUserStats with address', async () => {
      const stats = { dailyPnl: [], winRate: 0.65 };
      mockSdk.getHlUserStats.mockResolvedValue(stats);
      const tool = getTools().get('get_hl_user_stats')!;
      const result = await expectMcpSuccess(tool.handler, { userAddress: '0xTrader' });
      expect(result).toEqual(stats);
      expect(mockSdk.getHlUserStats).toHaveBeenCalledWith('0xTrader');
    });
  });

  describe('get_hl_perp_dexes', () => {
    it('should call getHlPerpDexes', async () => {
      mockSdk.getHlPerpDexes.mockResolvedValue([{ id: 1, name: 'HL Perps' }]);
      const tool = getTools().get('get_hl_perp_dexes')!;
      await expectMcpSuccess(tool.handler, {});
      expect(mockSdk.getHlPerpDexes).toHaveBeenCalled();
    });
  });

  describe('get_hl_all_assets', () => {
    it('should call getHlAllAssets', async () => {
      const assets = [{ coin: 'BTC', maxLeverage: 50 }, { coin: 'ETH', maxLeverage: 50 }];
      mockSdk.getHlAllAssets.mockResolvedValue(assets);
      const tool = getTools().get('get_hl_all_assets')!;
      const result = await expectMcpSuccess(tool.handler, {});
      expect(result).toEqual(assets);
    });
  });

  describe('get_hl_clearinghouse_state', () => {
    it('should call getHlClearinghouseState', async () => {
      mockSdk.getHlClearinghouseState.mockResolvedValue({ positions: [] });
      const tool = getTools().get('get_hl_clearinghouse_state')!;
      const result = await expectMcpSuccess(tool.handler, { userAddress: '0xUser' });
      expect(result).toEqual({ positions: [] });
      expect(mockSdk.getHlClearinghouseState).toHaveBeenCalledWith('0xUser');
    });
  });

  describe('get_hl_meta_and_asset_ctxs', () => {
    it('should call getHlMetaAndAssetCtxs', async () => {
      mockSdk.getHlMetaAndAssetCtxs.mockResolvedValue({ meta: {}, assetCtxs: [] });
      const tool = getTools().get('get_hl_meta_and_asset_ctxs')!;
      await expectMcpSuccess(tool.handler, {});
    });
  });

  describe('get_hl_deposit_tokens', () => {
    it('should call getHlDepositTokens', async () => {
      mockSdk.getHlDepositTokens.mockResolvedValue([{ symbol: 'USDC' }]);
      const tool = getTools().get('get_hl_deposit_tokens')!;
      await expectMcpSuccess(tool.handler, {});
      expect(mockSdk.getHlDepositTokens).toHaveBeenCalled();
    });
  });

  // --- User Operations ---

  describe('get_hl_copy_trade_list', () => {
    it('should call getHlCopyTradeList with auth', async () => {
      mockSdk.getHlCopyTradeList.mockResolvedValue([{ id: 'hlct1' }]);
      const tool = getTools().get('get_hl_copy_trade_list')!;
      const params = { userId: '0xUser', data: 'enc-session' };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual([{ id: 'hlct1' }]);
    });
  });

  describe('get_hl_copy_trade_tx_list', () => {
    it('should call getHlCopyTradeTxList with pagination', async () => {
      mockSdk.getHlCopyTradeTxList.mockResolvedValue({ items: [], total: 0 });
      const tool = getTools().get('get_hl_copy_trade_tx_list')!;
      const params = { userId: '0xUser', data: 'enc-session', page: '1', limit: '10' };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ items: [], total: 0 });
      expect(mockSdk.getHlCopyTradeTxList).toHaveBeenCalledWith(params);
    });
  });

  // --- Write Operations ---

  describe('create_hl_copy_trade', () => {
    it('should call createHlCopyTrade', async () => {
      mockSdk.createHlCopyTrade.mockResolvedValue({ copyTradeId: 'hlct-new' });
      const tool = getTools().get('create_hl_copy_trade')!;
      const params = {
        apiKey: 'key',
        userId: '0xUser',
        sessionPrivateKey: '0xSk',
        traderWallet: '0xTrader',
        copyTradeName: 'HL Copy',
        copyMode: 1,
        fixedAmountCostPerOrder: '100',
        lossPercent: '20',
        profitPercent: '40',
        oppositeCopy: false,
      };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ copyTradeId: 'hlct-new' });
      expect(mockSdk.createHlCopyTrade).toHaveBeenCalledWith(params);
    });
  });

  describe('update_hl_copy_trade', () => {
    it('should call updateHlCopyTrade', async () => {
      mockSdk.updateHlCopyTrade.mockResolvedValue({ updated: true });
      const tool = getTools().get('update_hl_copy_trade')!;
      const params = {
        apiKey: 'key',
        userId: '0xUser',
        sessionPrivateKey: '0xSk',
        copyTradeId: 'hlct-1',
        traderWallet: '0xTrader',
        copyTradeName: 'Updated HL Copy',
        copyMode: 2,
        fixedAmountCostPerOrder: '0.5',
        lossPercent: '25',
        profitPercent: '50',
        oppositeCopy: true,
        isDelete: false,
        isChangeStatus: false,
      };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ updated: true });
    });

    it('should handle deletion', async () => {
      mockSdk.updateHlCopyTrade.mockResolvedValue({ deleted: true });
      const tool = getTools().get('update_hl_copy_trade')!;
      await expectMcpSuccess(tool.handler, {
        apiKey: 'key',
        userId: '0xUser',
        sessionPrivateKey: '0xSk',
        copyTradeId: 'hlct-1',
        traderWallet: '0xTrader',
        copyTradeName: 'Delete Me',
        copyMode: 1,
        fixedAmountCostPerOrder: '100',
        lossPercent: '20',
        profitPercent: '40',
        isDelete: true,
      });
    });

    it('should propagate errors', async () => {
      mockSdk.updateHlCopyTrade.mockRejectedValue(new Error('Copy trade not found'));
      const tool = getTools().get('update_hl_copy_trade')!;
      await expectMcpError(tool.handler, {
        apiKey: 'key',
        userId: '0xUser',
        sessionPrivateKey: '0xSk',
        copyTradeId: 'bad-id',
        traderWallet: '0xTrader',
        copyTradeName: 'x',
        copyMode: 1,
        fixedAmountCostPerOrder: '100',
        lossPercent: '20',
        profitPercent: '40',
      }, 'Copy trade not found');
    });
  });
});
