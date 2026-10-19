/**
 * E2E tests for portfolio tools (portfolio.ts)
 * Tools: get_portfolio, get_balances, get_trading_funds, get_trade_history, get_token_details, get_trending_tokens,
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
    it('should register all 10 portfolio tools', () => {
      const tools = getTools();
      const expectedTools = [
        'get_portfolio', 'get_balances', 'get_trading_funds', 'get_trade_history', 'get_token_details',
        'get_trending_tokens', 'get_ohlcv', 'get_top_traders', 'get_wallet_info',
        'generate_evm_wallet',
      ];
      for (const name of expectedTools) {
        expect(tools.has(name)).toBe(true);
      }
      expect(tools.size).toBe(10);
    });
  });

  const session = { walletAddress: '0xControl', sessionPrivateKey: '0x' + '11'.repeat(32), apiKey: 'key' };

  it('managed reads declare session fields (accountRef applies) and history does too', () => {
    for (const name of ['get_portfolio', 'get_balances', 'get_trading_funds']) {
      const schema = getTools().get(name)!.schema as Record<string, unknown>;
      for (const f of ['walletAddress', 'sessionPrivateKey', 'apiKey', 'data', 'chain']) expect(schema[f]).toBeDefined();
    }
    expect((getTools().get('get_trade_history')!.schema as Record<string, unknown>).sessionPrivateKey).toBeDefined();
  });

  describe('get_portfolio', () => {
    it('passes session and chain to getPortfolio and returns the normalized shape', async () => {
      const portfolio = { status: 'ok', mode: 'managed', userId: '0xControl', chainId: 8453, holdings: [{ tokenAddress: '0xT', rawBalance: '1', balance: '0.000001' }] };
      mockSdk.getPortfolio.mockResolvedValue(portfolio);
      const tool = getTools().get('get_portfolio')!;
      const params = { ...session, chain: 8453 };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(mockSdk.getPortfolio).toHaveBeenCalledWith(params);
      expect(result).toEqual(portfolio);
    });

    it('surfaces a failed read as an error, not an empty portfolio', async () => {
      mockSdk.getPortfolio.mockRejectedValue(new Error('Malformed /v1/portfolio response'));
      await expectMcpError(getTools().get('get_portfolio')!.handler, { ...session, chain: 8453 }, 'Malformed');
    });
  });

  describe('get_balances', () => {
    it('should call getBalances', async () => {
      const balances = [{ tokenAddress: '0xUSDC', symbol: 'USDC', rawBalance: '5000000000', balance: '5000' }];
      mockSdk.getBalances.mockResolvedValue(balances);
      const tool = getTools().get('get_balances')!;
      const result = await expectMcpSuccess(tool.handler, { ...session, chain: 42161 });
      expect(result).toEqual(balances);
    });
  });

  describe('get_trading_funds', () => {
    it('should call getTradingFunds', async () => {
      const funds = { status: 'ok', nativeBalance: '0.01', nativeSymbol: 'ETH', precision: 'approximate' };
      mockSdk.getTradingFunds.mockResolvedValue(funds);
      const params = { ...session, chain: 8453 };
      expect(await expectMcpSuccess(getTools().get('get_trading_funds')!.handler, params)).toEqual(funds);
      expect(mockSdk.getTradingFunds).toHaveBeenCalledWith(params);
    });
  });

  describe('get_trade_history', () => {
    it('should call getTradeHistory with limit and cursor, without the session key', async () => {
      const history = { status: 'ok', trades: [], nextCursor: null };
      mockSdk.getTradeHistory.mockResolvedValue(history);
      const tool = getTools().get('get_trade_history')!;
      const params = { walletAddress: '0xW', chain: 'solana', limit: 20, cursor: 1700000000 };
      const result = await expectMcpSuccess(tool.handler, { ...params, sessionPrivateKey: '0xsecret' });
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
    it('returns only the address by default', async () => {
      mockSdk.generateEvmWallet.mockReturnValue({ address: '0xNewWallet', privateKey: '0xPk', mnemonic: 'word1 word2 word3 ...' });
      const result = await expectMcpSuccess(getTools().get('generate_evm_wallet')!.handler, {});
      expect(result.address).toBe('0xNewWallet');
      expect(result).not.toHaveProperty('privateKey');
      expect(result).not.toHaveProperty('mnemonic');
    });

    it('returns secrets only with revealSecrets', async () => {
      const wallet = { address: '0xNewWallet', privateKey: '0xPk', mnemonic: 'word1 word2 word3 ...' };
      mockSdk.generateEvmWallet.mockReturnValue(wallet);
      expect(await expectMcpSuccess(getTools().get('generate_evm_wallet')!.handler, { revealSecrets: true })).toEqual(wallet);
    });

    it('should handle errors', async () => {
      mockSdk.generateEvmWallet.mockImplementation(() => { throw new Error('Entropy source unavailable'); });
      await expectMcpError(getTools().get('generate_evm_wallet')!.handler, {}, 'Entropy source unavailable');
    });
  });
});
