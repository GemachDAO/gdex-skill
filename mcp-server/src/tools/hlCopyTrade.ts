import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSdk, handleToolCall } from '../sdk.js';

export function registerHlCopyTradeTools(server: McpServer): void {
  // --- Discovery (No Auth, Cached) ---

  server.tool(
    'get_hl_top_traders',
    'Get top HyperLiquid perp traders by volume, trade count, or deposit. No auth. Cached 15 min.',
    {
      sort: z.string().optional().default('volume').describe("Sort by: 'volume', 'tradeCount', or 'deposit'"),
    },
    async ({ sort }) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getHlTopTraders(sort);
    }),
  );

  server.tool(
    'get_hl_top_traders_by_pnl',
    'Get top 30 HyperLiquid perp traders ranked by PnL. Data by day/week/month. No auth. Cached 15 min.',
    {},
    async () => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getHlTopTradersByPnl();
    }),
  );

  server.tool(
    'get_hl_user_stats',
    'Get detailed trading stats for an HL user: daily PnL, volumes, trade counts, win rates. No auth. Cached 1 hr.',
    {
      userAddress: z.string().describe('EVM wallet address (managed wallet, not control wallet)'),
    },
    async ({ userAddress }) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getHlUserStats(userAddress);
    }),
  );

  server.tool(
    'get_hl_perp_dexes',
    'Get available perpetual DEX list on HyperLiquid. No auth.',
    {},
    async () => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getHlPerpDexes();
    }),
  );

  server.tool(
    'get_hl_all_assets',
    'Get all tradeable assets on HyperLiquid with max leverage info. No auth.',
    {},
    async () => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getHlAllAssets();
    }),
  );

  server.tool(
    'get_hl_clearinghouse_state',
    'Get account state (positions, margin) on a specific HyperLiquid DEX. No auth.',
    {
      userAddress: z.string().describe('EVM wallet address'),
    },
    async ({ userAddress }) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getHlClearinghouseState(userAddress);
    }),
  );

  server.tool(
    'get_hl_meta_and_asset_ctxs',
    'Get market metadata and asset contexts from HyperLiquid. No auth.',
    {},
    async () => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getHlMetaAndAssetCtxs();
    }),
  );

  server.tool(
    'get_hl_deposit_tokens',
    'Get supported deposit tokens for HyperLiquid. No auth.',
    {},
    async () => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getHlDepositTokens();
    }),
  );

  // --- User Operations (Session-Key Auth) ---

  server.tool(
    'get_hl_copy_trade_list',
    "List all HL perp copy trade configurations for a user. Requires session-key auth.",
    {
      userId: z.string().describe('Control wallet address'),
      data: z.string().describe('AES-encrypted session key'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getHlCopyTradeList(params as any);
    }),
  );

  server.tool(
    'get_hl_copy_trade_tx_list',
    'Get HL copy trade fill history. Supports pagination (max 100 per page). Session-key auth. Cached 15s.',
    {
      userId: z.string().describe('Control wallet address'),
      data: z.string().describe('AES-encrypted session key'),
      page: z.string().optional().default('1').describe('Page number'),
      limit: z.string().optional().default('10').describe('Results per page (max 100)'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getHlCopyTradeTxList(params as any);
    }),
  );

  // --- Write Operations (ComputedData Auth) ---

  server.tool(
    'create_hl_copy_trade',
    "Create a new HL perp copy trade. Copies a trader's long/short perpetual positions.",
    {
      apiKey: z.string().describe('API key for AES encryption'),
      userId: z.string().describe('Control wallet address'),
      sessionPrivateKey: z.string().describe('Session private key from sign-in'),
      traderWallet: z.string().describe('EVM address of the trader to copy'),
      copyTradeName: z.string().describe('Human-readable label'),
      copyMode: z.number().describe('1 = Fixed USD per order, 2 = Proportion of trader size'),
      fixedAmountCostPerOrder: z.string().describe('USD amount (mode 1) or ratio (mode 2)'),
      lossPercent: z.string().describe('Stop-loss percentage (> 0, < 100)'),
      profitPercent: z.string().describe('Take-profit percentage (> 0)'),
      oppositeCopy: z.boolean().optional().default(false).describe('Short when trader goes long'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.createHlCopyTrade(params as any);
    }),
  );

  server.tool(
    'update_hl_copy_trade',
    'Update or delete an HL perp copy trade. WARNING: Both isDelete and isChangeStatus permanently delete.',
    {
      apiKey: z.string().describe('API key'),
      userId: z.string().describe('Control wallet address'),
      sessionPrivateKey: z.string().describe('Session private key'),
      copyTradeId: z.string().describe('Copy trade ID to modify'),
      traderWallet: z.string().describe('Trader wallet address'),
      copyTradeName: z.string().describe('Label'),
      copyMode: z.number().describe('1 = fixed, 2 = proportion'),
      fixedAmountCostPerOrder: z.string().describe('Amount or ratio'),
      lossPercent: z.string().describe('Stop-loss %'),
      profitPercent: z.string().describe('Take-profit %'),
      oppositeCopy: z.boolean().optional().default(false),
      isDelete: z.boolean().optional().default(false).describe('Permanently delete'),
      isChangeStatus: z.boolean().optional().default(false).describe('WARNING: Also permanently deletes'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.updateHlCopyTrade(params as any);
    }),
  );
}
