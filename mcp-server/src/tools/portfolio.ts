import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSdk, handleToolCall } from '../sdk.js';

/**
 * Managed-account read credentials. walletAddress is the control wallet; give
 * the session as data or sessionPrivateKey + apiKey, or pass accountRef
 * (credentials.ts enableAccountRefs fills all of them).
 */
const managedRead = {
  walletAddress: z.string().describe('Control wallet address (the GDEX userId), not the managed trading wallet'),
  sessionPrivateKey: z.string().optional().describe('Session private key from sign-in (with apiKey)'),
  apiKey: z.string().optional().describe('GDEX API key (with sessionPrivateKey)'),
  data: z.string().optional().describe('Encrypted session data, instead of sessionPrivateKey + apiKey'),
};

export function registerPortfolioTools(server: McpServer): void {
  server.tool(
    'get_portfolio',
    'Token holdings of the managed GDEX wallet on one chain (/v1/portfolio): exact raw and decimal balances, price, native value and P&L per token. Needs the session (accountRef). Errors instead of returning an empty portfolio when the read fails.',
    {
      ...managedRead,
      chain: z.union([z.string(), z.number()]).describe('Chain to read (holdings are per chain)'),
    },
    async (params) => handleToolCall(async () => getSdk().getPortfolio(params as any)),
  );

  server.tool(
    'get_balances',
    'Token balances of the managed GDEX wallet on one chain, optionally one token. [] means the backend reported no holdings; a failed read errors. Native balance: get_trading_funds.',
    {
      ...managedRead,
      chain: z.union([z.string(), z.number()]).describe('Chain identifier'),
      tokenAddress: z.string().optional().describe('Optional token filter'),
    },
    async (params) => handleToolCall(async () => getSdk().getBalances(params as any)),
  );

  server.tool(
    'get_trading_funds',
    'Native balance the managed GDEX wallet can trade with on one chain (/v1/user), plus the managed wallet address per chain family. The value is approximate (backend float). Cross-chain USDC: usdc_get_balances.',
    {
      ...managedRead,
      chain: z.union([z.string(), z.number()]).describe('Chain identifier'),
    },
    async (params) => handleToolCall(async () => getSdk().getTradingFunds(params as any)),
  );

  server.tool(
    'get_trade_history',
    'Successful spot trades of a GDEX account on one chain, newest first (/v1/user_history, keyed by the control wallet). Page with limit (max 50) and cursor = nextCursor of the previous page.',
    {
      walletAddress: z.string().describe('Control wallet address (the GDEX userId)'),
      chain: z.union([z.string(), z.number()]).describe('Chain identifier'),
      limit: z.number().int().optional().describe('Trades per page, 1-50 (default 50)'),
      cursor: z.number().optional().describe('nextCursor from the previous page'),
      sessionPrivateKey: z.string().optional().describe('Not needed (history is keyed by the control wallet); present so accountRef can fill walletAddress'),
    },
    async (params) => handleToolCall(async () => {
      const { sessionPrivateKey: _unused, ...rest } = params as Record<string, unknown>;
      return getSdk().getTradeHistory(rest as any);
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
    'Generate a new EVM wallet offline (no network call). To trade with it, use gdex_connect { create: true } instead, which stores it locally. Returns only the address unless revealSecrets is true.',
    { revealSecrets: z.boolean().optional().describe('Return privateKey and mnemonic too (they then appear in the conversation)') },
    async ({ revealSecrets }) => handleToolCall(async () => {
      const sdk = getSdk();
      const w = sdk.generateEvmWallet();
      return revealSecrets
        ? w
        : { address: w.address, note: 'Secrets withheld and not stored. Use gdex_connect { create: true } for a stored trading wallet.' };
    }),
  );
}
