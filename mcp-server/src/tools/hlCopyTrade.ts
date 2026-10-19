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
    'Get account state (positions, margin) on a HyperLiquid DEX. No auth. Builder/HIP-3 positions (e.g. xyz:NVDA) live under their own dex — pass `dex` ("xyz") to see them. The default query does NOT show builder positions; an open builder position will look empty without `dex`.',
    {
      userAddress: z.string().describe('EVM wallet address'),
      dex: z.string().optional().describe('Builder/HIP-3 dex prefix, e.g. "xyz". Omit for the default USDC dex.'),
    },
    async ({ userAddress, dex }) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getHlClearinghouseState(dex ? { userAddress, dex } : userAddress);
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

  // Backend ServiceHyperLiquid.update: isDelete deletes the HLFuturesCopySetting
  // row only; isChangeStatus TOGGLES isActive (not delete). Neither closes
  // positions or cancels their TP/SL orders.
  server.tool(
    'update_hl_copy_trade',
    'Low-level HL perp copy trade update (prefer update_hl_copy_trade_settings / pause_hl_copy_trade / resume_hl_copy_trade / delete_hl_copy_trade). '
      + 'Every field is rewritten from this payload, so pass the full current config. '
      + 'isDelete=true permanently deletes the configuration; perp positions it opened are NOT closed and their TP/SL orders are NOT cancelled. '
      + 'isChangeStatus=true TOGGLES active/paused relative to the stored state. isDelete and isChangeStatus cannot both be true.',
    {
      apiKey: z.string().describe('API key'),
      userId: z.string().describe('Control wallet address'),
      sessionPrivateKey: z.string().describe('Session private key'),
      copyTradeId: z.string().describe('Copy trade ID to modify'),
      traderWallet: z.string().describe('Trader wallet address'),
      copyTradeName: z.string().describe('Label'),
      copyMode: z.number().describe('1 = fixed USD per order, 2 = proportion'),
      fixedAmountCostPerOrder: z.string().describe('USD amount (mode 1) or ratio (mode 2)'),
      lossPercent: z.string().describe('Stop-loss % (> 0, < 100)'),
      profitPercent: z.string().describe('Take-profit % (> 0)'),
      oppositeCopy: z.boolean().optional().default(false).describe('Trade opposite to the trader'),
      isDelete: z.boolean().optional().default(false).describe('Permanently delete the configuration (positions stay open)'),
      isChangeStatus: z.boolean().optional().default(false).describe('Toggle active/paused relative to the stored state'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.updateHlCopyTrade(params as any);
    }),
  );

  const controlShape = {
    apiKey: z.string().describe('API key'),
    userId: z.string().describe('Control wallet address'),
    sessionPrivateKey: z.string().describe('Session private key'),
    copyTradeId: z.string().describe('Copy trade ID (from get_hl_copy_trade_list)'),
  };

  server.tool(
    'update_hl_copy_trade_settings',
    'Change settings of an existing HL perp copy trade. Never deletes and never pauses/resumes. '
      + 'Reads the current config first; omitted fields keep their current values. '
      + 'Configs created by SDK <= 4.12 may hold an invalid copyMode (e.g. 416/480) and oppositeCopy=true; pass copyMode, fixedAmountCostPerOrder and oppositeCopy explicitly to repair them.',
    {
      ...controlShape,
      traderWallet: z.string().optional().describe('New trader wallet to follow'),
      copyTradeName: z.string().optional().describe('New label'),
      copyMode: z.union([z.literal(1), z.literal(2)]).optional().describe('1 = fixed USD per order, 2 = proportion'),
      fixedAmountCostPerOrder: z.string().optional().describe('USD amount (mode 1) or ratio (mode 2)'),
      lossPercent: z.string().optional().describe('Stop-loss % (> 0, < 100)'),
      profitPercent: z.string().optional().describe('Take-profit % (> 0)'),
      oppositeCopy: z.boolean().optional().describe('Trade opposite to the trader'),
    },
    async (params) => handleToolCall(async () => getSdk().updateHlCopyTradeSettings(params as any)),
  );

  server.tool(
    'pause_hl_copy_trade',
    'Pause an HL perp copy trade (isActive=false) WITHOUT deleting it. Reads the current state first and is a no-op if already paused. '
      + "While paused the copier mirrors neither opens nor closes, so copied positions stay open and will NOT follow the trader's exits; their TP/SL orders stay in place. "
      + 'Errors: PAUSE_STATE_UNVERIFIED (nothing sent), PAUSE_UNSUPPORTED (stored config invalid; explains the alternative), COPY_TRADE_NOT_FOUND.',
    controlShape,
    async (params) => handleToolCall(async () => getSdk().pauseHlCopyTrade(params as any)),
  );

  server.tool(
    'resume_hl_copy_trade',
    'Resume a paused HL perp copy trade (isActive=true). No-op if already active. Fills made while paused are not replayed.',
    controlShape,
    async (params) => handleToolCall(async () => getSdk().resumeHlCopyTrade(params as any)),
  );

  server.tool(
    'delete_hl_copy_trade',
    'PERMANENTLY delete an HL perp copy trade configuration. Does NOT close the perp positions it opened and does NOT cancel their TP/SL orders; '
      + 'close them with the perp tools if wanted. Cannot be undone. To stop copying temporarily use pause_hl_copy_trade instead.',
    controlShape,
    async (params) => handleToolCall(async () => getSdk().deleteHlCopyTrade(params as any)),
  );
}
