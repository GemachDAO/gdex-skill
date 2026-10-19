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

  // Backend ServiceCopyTrade.update: isDelete deletes the CopyTradeSetting row only;
  // isChangeStatus TOGGLES isActive (not delete). The copier mirrors only
  // isActive:true settings. Neither closes positions or cancels their TP/SL orders.
  server.tool(
    'update_copy_trade',
    'Low-level Solana copy trade update (prefer update_copy_trade_settings / pause_copy_trade / resume_copy_trade / delete_copy_trade). '
      + 'Every field is rewritten from this payload, so pass the full current config. '
      + 'isDelete=true permanently deletes the configuration; positions it opened are NOT sold and their TP/SL limit orders are NOT cancelled. '
      + 'isChangeStatus=true TOGGLES active/paused relative to the stored state (sending it twice resumes). isDelete and isChangeStatus cannot both be true.',
    {
      apiKey: z.string().describe('API key'),
      userId: z.string().describe('Control wallet address'),
      sessionPrivateKey: z.string().describe('Session private key'),
      copyTradeId: z.string().describe('Copy trade ID to modify'),
      traderWallet: z.string().describe('Trader wallet address'),
      copyTradeName: z.string().optional().describe('Label'),
      chainId: z.number().describe('Must be 622112261 (Solana)'),
      gasPrice: z.string().optional().describe('Priority fee setting (default "0")'),
      buyMode: z.number().describe('1 = fixed SOL amount, 2 = percentage of trader amount'),
      copyBuyAmount: z.string().describe('SOL amount (mode 1) or percentage 0-100 (mode 2)'),
      lossPercent: z.string().describe('Stop-loss % (> 0, < 100)'),
      profitPercent: z.string().describe('Take-profit % (> 0)'),
      copySell: z.boolean().optional().default(false).describe('Also copy sells'),
      isBuyExistingToken: z.boolean().optional().default(false).describe('Buy tokens the trader already holds'),
      excludedDexNumbers: z.array(z.number()).optional().describe('DEX numbers to exclude'),
      isDelete: z.boolean().optional().default(false).describe('Permanently delete the configuration (positions stay open)'),
      isChangeStatus: z.boolean().optional().default(false).describe('Toggle active/paused relative to the stored state'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.updateCopyTrade(params as any);
    }),
  );

  const controlShape = {
    apiKey: z.string().describe('API key'),
    userId: z.string().describe('Control wallet address'),
    sessionPrivateKey: z.string().describe('Session private key'),
    copyTradeId: z.string().describe('Copy trade ID (from get_copy_trade_list)'),
  };

  server.tool(
    'update_copy_trade_settings',
    'Change settings of an existing Solana copy trade. Never deletes and never pauses/resumes. '
      + 'Reads the current config first; omitted fields keep their current values. Open positions are not resized.',
    {
      ...controlShape,
      traderWallet: z.string().optional().describe('New trader wallet to follow'),
      copyTradeName: z.string().optional().describe('New label'),
      gasPrice: z.string().optional().describe('Priority fee setting'),
      buyMode: z.union([z.literal(1), z.literal(2)]).optional().describe('1 = fixed SOL amount, 2 = percentage'),
      copyBuyAmount: z.string().optional().describe('Required when buyMode changes'),
      lossPercent: z.string().optional().describe('Stop-loss % (> 0, < 100)'),
      profitPercent: z.string().optional().describe('Take-profit % (> 0)'),
      copySell: z.boolean().optional().describe('Also copy sells'),
      isBuyExistingToken: z.boolean().optional().describe('Buy tokens the trader already holds'),
      excludedDexNumbers: z.array(z.number()).optional().describe('DEX numbers to exclude'),
    },
    async (params) => handleToolCall(async () => getSdk().updateCopyTradeSettings(params as any)),
  );

  server.tool(
    'pause_copy_trade',
    'Pause a Solana copy trade (isActive=false) WITHOUT deleting it. Reads the current state first and is a no-op if already paused. '
      + 'While paused the copier mirrors neither buys nor sells; positions it opened stay open and their TP/SL orders stay in place. '
      + 'Errors: PAUSE_STATE_UNVERIFIED (state could not be confirmed, nothing sent), PAUSE_UNSUPPORTED (stored config invalid; explains the alternative), COPY_TRADE_NOT_FOUND.',
    controlShape,
    async (params) => handleToolCall(async () => getSdk().pauseCopyTrade(params as any)),
  );

  server.tool(
    'resume_copy_trade',
    'Resume a paused Solana copy trade (isActive=true). No-op if already active. Trades made while paused are not replayed.',
    controlShape,
    async (params) => handleToolCall(async () => getSdk().resumeCopyTrade(params as any)),
  );

  server.tool(
    'delete_copy_trade',
    'PERMANENTLY delete a Solana copy trade configuration. Does NOT sell the positions it opened and does NOT cancel their TP/SL limit orders; '
      + 'manage those separately. Cannot be undone. To stop copying temporarily use pause_copy_trade instead.',
    controlShape,
    async (params) => handleToolCall(async () => getSdk().deleteCopyTrade(params as any)),
  );
}
