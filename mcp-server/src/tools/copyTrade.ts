import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSdk, handleToolCall } from '../sdk.js';

export function registerCopyTradeTools(server: McpServer): void {
  // --- Discovery (No Auth) ---

  server.tool(
    'get_copy_trade_wallets',
    'Get top 300 wallets ranked by totalPnl for Solana spot copy trade leaderboard. No auth. Cached 2 min.',
    {},
    async () => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getCopyTradeWallets();
    }),
  );

  server.tool(
    'get_copy_trade_custom_wallets',
    'Get top 300 wallets ranked by net received. No auth. Cached 2 min.',
    {},
    async () => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getCopyTradeCustomWallets();
    }),
  );

  server.tool(
    'get_copy_trade_gems',
    'Get hot new tokens heavily traded by top wallets. No auth. Cached 20s.',
    {},
    async () => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getCopyTradeGems();
    }),
  );

  server.tool(
    'get_copy_trade_dexes',
    'List supported DEXes for a chain (e.g. Raydium, Pumpfun on Solana). No auth.',
    {
      chainId: z.number().describe('Chain ID (622112261 for Solana)'),
    },
    async ({ chainId }) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getCopyTradeDexes(chainId);
    }),
  );

  // --- User Operations (Session-Key Auth) ---

  server.tool(
    'get_copy_trade_list',
    "List all copy trade configurations for a user. Requires session-key auth.",
    {
      userId: z.string().describe('Control wallet address'),
      data: z.string().describe('AES-encrypted session key'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getCopyTradeList(params as any);
    }),
  );

  server.tool(
    'get_copy_trade_tx_list',
    'List copy trade transaction history with PnL. Requires session-key auth.',
    {
      userId: z.string().describe('Control wallet address'),
      data: z.string().describe('AES-encrypted session key'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getCopyTradeTxList(params as any);
    }),
  );

  // --- Write Operations (ComputedData Auth) ---

  server.tool(
    'create_copy_trade',
    "Create a new copy trade to auto-mirror a Solana trader's buys/sells. Solana only.",
    {
      apiKey: z.string().describe('API key for AES encryption'),
      userId: z.string().describe('Control wallet address'),
      sessionPrivateKey: z.string().describe('Session private key from sign-in'),
      traderWallet: z.string().describe('Solana wallet address of trader to copy'),
      copyTradeName: z.string().describe('Human-readable label'),
      chainId: z.number().describe('Must be 622112261 (Solana)'),
      buyMode: z.number().describe('1 = fixed SOL amount, 2 = percentage of trader amount'),
      copyBuyAmount: z.string().describe('SOL amount (mode 1) or percentage 0-100 (mode 2)'),
      lossPercent: z.string().describe('Stop-loss percentage (> 0, < 100)'),
      profitPercent: z.string().describe('Take-profit percentage (> 0)'),
      copySell: z.boolean().optional().default(false).describe('Also copy sell trades'),
      isBuyExistingToken: z.boolean().optional().default(false).describe('Buy tokens already held by trader'),
      excludedDexNumbers: z.array(z.number()).optional().describe('DEX numbers to exclude'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.createCopyTrade(params as any);
    }),
  );

  server.tool(
    'update_copy_trade',
    'Update or delete a Solana copy trade. WARNING: Both isDelete and isChangeStatus permanently delete.',
    {
      apiKey: z.string().describe('API key'),
      userId: z.string().describe('Control wallet address'),
      sessionPrivateKey: z.string().describe('Session private key'),
      copyTradeId: z.string().describe('Copy trade ID to modify'),
      traderWallet: z.string().describe('Trader wallet address'),
      copyTradeName: z.string().optional().describe('Updated label'),
      chainId: z.number().describe('Must be 622112261 (Solana)'),
      buyMode: z.number().describe('1 = fixed, 2 = percentage'),
      copyBuyAmount: z.string().describe('Amount or percentage'),
      lossPercent: z.string().describe('Stop-loss %'),
      profitPercent: z.string().describe('Take-profit %'),
      isDelete: z.boolean().optional().default(false).describe('Permanently delete the copy trade'),
      isChangeStatus: z.boolean().optional().default(false).describe('WARNING: Also permanently deletes'),
      excludedProgramIds: z.array(z.string()).optional().describe('Program IDs to exclude'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.updateCopyTrade(params as any);
    }),
  );
}
