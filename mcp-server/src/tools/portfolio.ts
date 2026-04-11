import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSdk, handleToolCall } from '../sdk.js';

export function registerPortfolioTools(server: McpServer): void {
  server.tool(
    'get_portfolio',
    'Fetch the full cross-chain portfolio for a wallet — all token balances with USD values and perp positions.',
    {
      walletAddress: z.string().describe('Wallet address to query'),
      chain: z.union([z.string(), z.number()]).optional().describe('Optional chain filter'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getPortfolio(params as any);
    }),
  );

  server.tool(
    'get_balances',
    'Get token balances for a wallet on a specific chain.',
    {
      walletAddress: z.string().describe('Wallet address'),
      chain: z.union([z.string(), z.number()]).describe('Chain identifier'),
      tokenAddress: z.string().optional().describe('Optional token filter'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getBalances(params as any);
    }),
  );

  server.tool(
    'get_trade_history',
    'Get historical trades for a wallet with pagination and time filters.',
    {
      walletAddress: z.string().describe('Wallet address'),
      chain: z.union([z.string(), z.number()]).optional().describe('Optional chain filter'),
      page: z.number().optional().default(1),
      limit: z.number().optional().default(20),
      startTime: z.number().optional().describe('Start Unix timestamp'),
      endTime: z.number().optional().describe('End Unix timestamp'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getTradeHistory(params as any);
    }),
  );

  server.tool(
    'get_token_details',
    'Get detailed token info: price, market cap, liquidity, DEX pools, social links, security info. No auth.',
    {
      tokenAddress: z.string().describe('Token contract address'),
      chain: z.union([z.string(), z.number()]).describe('Chain identifier'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getTokenDetails(params as any);
    }),
  );

  server.tool(
    'get_trending_tokens',
    'Get trending tokens sorted by volume and price change. No auth.',
    {
      chain: z.union([z.string(), z.number()]).optional().describe('Optional chain filter'),
      period: z.enum(['1h', '6h', '24h', '7d']).optional().default('24h'),
      limit: z.number().optional().default(20),
      minLiquidity: z.number().optional().describe('Minimum liquidity in USD'),
      minVolume: z.number().optional().describe('Minimum volume in USD'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getTrendingTokens(params as any);
    }),
  );

  server.tool(
    'get_ohlcv',
    'Get OHLCV candlestick data for a token. No auth.',
    {
      tokenAddress: z.string().describe('Token contract address'),
      chain: z.union([z.string(), z.number()]).describe('Chain identifier'),
      resolution: z.enum(['1', '5', '15', '30', '60', '240', 'D', 'W']).describe('Candle resolution'),
      from: z.number().optional().describe('Start Unix timestamp'),
      to: z.number().optional().describe('End Unix timestamp'),
      limit: z.number().optional().describe('Number of candles'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getOHLCV(params as any);
    }),
  );

  server.tool(
    'get_top_traders',
    'Get top performing trader wallets ranked by P&L, win rate, volume, or trade count.',
    {
      chain: z.union([z.string(), z.number()]).optional(),
      period: z.enum(['1d', '7d', '30d', 'all']).optional().default('7d'),
      limit: z.number().optional().default(10),
      sortBy: z.enum(['pnl', 'winRate', 'volume', 'tradeCount']).optional().default('pnl'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getTopTraders(params as any);
    }),
  );

  server.tool(
    'get_wallet_info',
    'Get wallet information including native token balance.',
    {
      walletAddress: z.string().describe('Wallet address'),
      chain: z.union([z.string(), z.number()]).describe('Chain identifier'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getWalletInfo(params as any);
    }),
  );

  server.tool(
    'generate_evm_wallet',
    'Generate a new EVM wallet offline (no network call). Returns address, privateKey, and mnemonic.',
    {},
    async () => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.generateEvmWallet();
    }),
  );
}
