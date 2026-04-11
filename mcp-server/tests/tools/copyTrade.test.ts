/**
 * E2E tests for copy trade tools (copyTrade.ts)
 * Tools: get_copy_trade_wallets, get_copy_trade_custom_wallets, get_copy_trade_gems,
 *        get_copy_trade_dexes, get_copy_trade_list, get_copy_trade_tx_list,
 *        create_copy_trade, update_copy_trade
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

const { registerCopyTradeTools } = await import('../../src/tools/copyTrade.js');

describe('Copy Trade Tools', () => {
  const { server, getTools } = createMockServer();

  beforeAll(() => {
    registerCopyTradeTools(server);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registration', () => {
    it('should register all 8 copy trade tools', () => {
      const tools = getTools();
      expect(tools.has('get_copy_trade_wallets')).toBe(true);
      expect(tools.has('get_copy_trade_custom_wallets')).toBe(true);
      expect(tools.has('get_copy_trade_gems')).toBe(true);
      expect(tools.has('get_copy_trade_dexes')).toBe(true);
      expect(tools.has('get_copy_trade_list')).toBe(true);
      expect(tools.has('get_copy_trade_tx_list')).toBe(true);
      expect(tools.has('create_copy_trade')).toBe(true);
      expect(tools.has('update_copy_trade')).toBe(true);
      expect(tools.size).toBe(8);
    });
  });

  // --- Discovery (no auth) ---

  describe('get_copy_trade_wallets', () => {
    it('should call getCopyTradeWallets', async () => {
      const wallets = [{ wallet: '0xTop1', totalPnl: 50000 }];
      mockSdk.getCopyTradeWallets.mockResolvedValue(wallets);
      const tool = getTools().get('get_copy_trade_wallets')!;
      const result = await expectMcpSuccess(tool.handler, {});
      expect(result).toEqual(wallets);
    });
  });

  describe('get_copy_trade_custom_wallets', () => {
    it('should call getCopyTradeCustomWallets', async () => {
      mockSdk.getCopyTradeCustomWallets.mockResolvedValue([{ wallet: '0xW' }]);
      const tool = getTools().get('get_copy_trade_custom_wallets')!;
      await expectMcpSuccess(tool.handler, {});
      expect(mockSdk.getCopyTradeCustomWallets).toHaveBeenCalled();
    });
  });

  describe('get_copy_trade_gems', () => {
    it('should call getCopyTradeGems', async () => {
      const gems = [{ token: '0xGem', volume: 1000000 }];
      mockSdk.getCopyTradeGems.mockResolvedValue(gems);
      const tool = getTools().get('get_copy_trade_gems')!;
      const result = await expectMcpSuccess(tool.handler, {});
      expect(result).toEqual(gems);
    });
  });

  describe('get_copy_trade_dexes', () => {
    it('should call getCopyTradeDexes with chainId', async () => {
      const dexes = [{ name: 'Raydium', number: 1 }, { name: 'Pumpfun', number: 2 }];
      mockSdk.getCopyTradeDexes.mockResolvedValue(dexes);
      const tool = getTools().get('get_copy_trade_dexes')!;
      const result = await expectMcpSuccess(tool.handler, { chainId: 622112261 });
      expect(result).toEqual(dexes);
      expect(mockSdk.getCopyTradeDexes).toHaveBeenCalledWith(622112261);
    });
  });

  // --- User Operations (session-key auth) ---

  describe('get_copy_trade_list', () => {
    it('should call getCopyTradeList with auth', async () => {
      const list = [{ id: 'ct1', traderWallet: '0xTrader', status: 'active' }];
      mockSdk.getCopyTradeList.mockResolvedValue(list);
      const tool = getTools().get('get_copy_trade_list')!;
      const params = { userId: '0xUser', data: 'encrypted-session' };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual(list);
      expect(mockSdk.getCopyTradeList).toHaveBeenCalledWith(params);
    });
  });

  describe('get_copy_trade_tx_list', () => {
    it('should call getCopyTradeTxList', async () => {
      const txList = [{ txHash: '0xTx1', pnl: '+500' }];
      mockSdk.getCopyTradeTxList.mockResolvedValue(txList);
      const tool = getTools().get('get_copy_trade_tx_list')!;
      const params = { userId: '0xUser', data: 'encrypted-session' };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual(txList);
    });
  });

  // --- Write Operations ---

  describe('create_copy_trade', () => {
    it('should call createCopyTrade with full params', async () => {
      mockSdk.createCopyTrade.mockResolvedValue({ copyTradeId: 'ct-new', status: 'active' });
      const tool = getTools().get('create_copy_trade')!;
      const params = {
        apiKey: 'key',
        userId: '0xUser',
        sessionPrivateKey: '0xSk',
        traderWallet: '0xTrader',
        copyTradeName: 'My Copy',
        chainId: 622112261,
        buyMode: 1,
        copyBuyAmount: '0.5',
        lossPercent: '25',
        profitPercent: '50',
        copySell: true,
        isBuyExistingToken: false,
      };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ copyTradeId: 'ct-new', status: 'active' });
      expect(mockSdk.createCopyTrade).toHaveBeenCalledWith(params);
    });
  });

  describe('update_copy_trade', () => {
    it('should call updateCopyTrade for update', async () => {
      mockSdk.updateCopyTrade.mockResolvedValue({ updated: true });
      const tool = getTools().get('update_copy_trade')!;
      const params = {
        apiKey: 'key',
        userId: '0xUser',
        sessionPrivateKey: '0xSk',
        copyTradeId: 'ct-1',
        traderWallet: '0xTrader',
        chainId: 622112261,
        buyMode: 2,
        copyBuyAmount: '50',
        lossPercent: '30',
        profitPercent: '60',
        isDelete: false,
        isChangeStatus: false,
      };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ updated: true });
    });

    it('should call updateCopyTrade for deletion', async () => {
      mockSdk.updateCopyTrade.mockResolvedValue({ deleted: true });
      const tool = getTools().get('update_copy_trade')!;
      const params = {
        apiKey: 'key',
        userId: '0xUser',
        sessionPrivateKey: '0xSk',
        copyTradeId: 'ct-1',
        traderWallet: '0xTrader',
        chainId: 622112261,
        buyMode: 1,
        copyBuyAmount: '0.5',
        lossPercent: '25',
        profitPercent: '50',
        isDelete: true,
      };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ deleted: true });
    });
  });
});
