/**
 * E2E tests for portfolio tools (portfolio.ts)
 * Tools: get_portfolio, get_balances, get_trade_history, get_token_details, get_trending_tokens,
 *        get_ohlcv, get_top_traders, get_wallet_info, generate_evm_wallet
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

const { registerPortfolioTools } = await import('../../src/tools/portfolio.js');

describe('Portfolio Tools', () => {
  const { server, getTools } = createMockServer();

  beforeAll(() => {
    registerPortfolioTools(server);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registration', () => {
    it('should register all 9 portfolio tools', () => {
      const tools = getTools();
      const expectedTools = [
        'get_portfolio', 'get_balances', 'get_trade_history', 'get_token_details',
        'get_trending_tokens', 'get_ohlcv', 'get_top_traders', 'get_wallet_info',
        'generate_evm_wallet',
      ];
      for (const name of expectedTools) {
        expect(tools.has(name)).toBe(true);
      }
      expect(tools.size).toBe(9);
    });
  });

  describe('get_portfolio', () => {
    it('should call getPortfolio with wallet and optional chain', async () => {
      const portfolio = { tokens: [{ symbol: 'SOL', balance: '10' }], perpPositions: [] };
      mockSdk.getPortfolio.mockResolvedValue(portfolio);
      const tool = getTools().get('get_portfolio')!;
      const result = await expectMcpSuccess(tool.handler, { walletAddress: '0xW', chain: 'solana' });
      expect(result).toEqual(portfolio);
    });

    it('should work without chain filter', async () => {
      mockSdk.getPortfolio.mockResolvedValue({ tokens: [] });
      const tool = getTools().get('get_portfolio')!;
      await expectMcpSuccess(tool.handler, { walletAddress: '0xW' });
    });
  });

  describe('get_balances', () => {
    it('should call getBalances', async () => {
      const balances = [{ token: 'USDC', balance: '5000' }];
      mockSdk.getBalances.mockResolvedValue(balances);
      const tool = getTools().get('get_balances')!;
      const result = await expectMcpSuccess(tool.handler, {
        walletAddress: '0xW',
        chain: 42161,
      });
      expect(result).toEqual(balances);
    });
  });

  describe('get_trade_history', () => {
    it('should call getTradeHistory with pagination', async () => {
      const history = { trades: [], total: 0 };
      mockSdk.getTradeHistory.mockResolvedValue(history);
      const tool = getTools().get('get_trade_history')!;
      const params = { walletAddress: '0xW', chain: 'solana', page: 1, limit: 20 };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual(history);
      expect(mockSdk.getTradeHistory).toHaveBeenCalledWith(params);
    });
  });

  describe('get_token_details', () => {
    it('should call getTokenDetails', async () => {
      const details = { name: 'BONK', price: 0.00001, marketCap: 500000000 };
      mockSdk.getTokenDetails.mockResolvedValue(details);
      const tool = getTools().get('get_token_details')!;
      const result = await expectMcpSuccess(tool.handler, {
        tokenAddress: '0xBonk',
        chain: 'solana',
      });
      expect(result).toEqual(details);
    });
  });

  describe('get_trending_tokens', () => {
    it('should call getTrendingTokens with filters', async () => {
      const trending = [{ symbol: 'WIF', volume: 10000000 }];
      mockSdk.getTrendingTokens.mockResolvedValue(trending);
      const tool = getTools().get('get_trending_tokens')!;
      const result = await expectMcpSuccess(tool.handler, {
        chain: 'solana',
        period: '24h',
        limit: 10,
        minLiquidity: 50000,
        minVolume: 100000,
      });
      expect(result).toEqual(trending);
    });
  });

  describe('get_ohlcv', () => {
    it('should call getOHLCV', async () => {
      const candles = [{ o: 100, h: 105, l: 99, c: 103, v: 50000, t: 1700000000 }];
      mockSdk.getOHLCV.mockResolvedValue(candles);
      const tool = getTools().get('get_ohlcv')!;
      const result = await expectMcpSuccess(tool.handler, {
        tokenAddress: '0xToken',
        chain: 1,
        resolution: '60',
        limit: 100,
      });
      expect(result).toEqual(candles);
    });
  });

  describe('get_top_traders', () => {
    it('should call getTopTraders with sort and filter', async () => {
      const traders = [{ wallet: '0xT1', pnl: 50000 }];
      mockSdk.getTopTraders.mockResolvedValue(traders);
      const tool = getTools().get('get_top_traders')!;
      const result = await expectMcpSuccess(tool.handler, {
        chain: 'solana',
        period: '7d',
        limit: 10,
        sortBy: 'pnl',
      });
      expect(result).toEqual(traders);
    });
  });

  describe('get_wallet_info', () => {
    it('should call getWalletInfo', async () => {
      const info = { address: '0xW', nativeBalance: '10.5' };
      mockSdk.getWalletInfo.mockResolvedValue(info);
      const tool = getTools().get('get_wallet_info')!;
      const result = await expectMcpSuccess(tool.handler, {
        walletAddress: '0xW',
        chain: 8453,
      });
      expect(result).toEqual(info);
    });
  });

  describe('generate_evm_wallet', () => {
    it('should call generateEvmWallet and return address, pk, mnemonic', async () => {
      const wallet = {
        address: '0xNewWallet',
        privateKey: '0xPk',
        mnemonic: 'word1 word2 word3 ...',
      };
      mockSdk.generateEvmWallet.mockResolvedValue(wallet);
      const tool = getTools().get('generate_evm_wallet')!;
      const result = await expectMcpSuccess(tool.handler, {});
      expect(result).toEqual(wallet);
    });

    it('should handle errors', async () => {
      mockSdk.generateEvmWallet.mockRejectedValue(new Error('Entropy source unavailable'));
      const tool = getTools().get('generate_evm_wallet')!;
      await expectMcpError(tool.handler, {}, 'Entropy source unavailable');
    });
  });
});
