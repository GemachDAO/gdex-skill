import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSdk, handleToolCall } from '../sdk.js';

const hlCredentials = {
  apiKey: z.string().describe('GDEX API key for AES encryption'),
  walletAddress: z.string().describe('Control wallet address'),
  sessionPrivateKey: z.string().describe('Session private key from sign-in'),
};

export function registerPerpTradeTools(server: McpServer): void {

  // --- Write Operations (Managed Custody) ---

  server.tool(
    'open_perp_position',
    'Open a perpetual futures position on HyperLiquid with leverage, TP/SL. Supports market and limit orders.',
    {
      ...hlCredentials,
      coin: z.string().describe("Asset symbol, e.g. 'BTC', 'ETH', 'SOL'"),
      isLong: z.boolean().describe('True for long, false for short'),
      price: z.string().describe('Price in USD'),
      size: z.string().describe('Position size in contracts'),
      reduceOnly: z.boolean().optional().default(false).describe('Reduce-only order'),
      tpPrice: z.string().optional().default('').describe("Take-profit price in USD, '' to skip"),
      slPrice: z.string().optional().default('').describe("Stop-loss price in USD, '' to skip"),
      isMarket: z.boolean().optional().default(true).describe('True for market order, false for limit'),
      leverage: z.number().optional().describe('Leverage 1-50 (sent top-level; HL defaults to 20x if omitted)'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.hlCreateOrder(params as any);
    }),
  );

  server.tool(
    'place_perp_order',
    'Place a simple perp order on HyperLiquid without TP/SL. isMarket=true (default) is sent via ' +
      '/hl/create_order as a market order; isMarket=false sends a limit order at `price` via ' +
      '/hl/place_order, which the backend currently accepts only with reduceOnly=true.',
    {
      ...hlCredentials,
      coin: z.string().describe('Asset symbol'),
      isLong: z.boolean().describe('True for long, false for short'),
      price: z.string().describe("Price in USD ('0' with isMarket=true uses the mark price)"),
      size: z.string().describe('Position size in contracts'),
      reduceOnly: z.boolean().optional().default(false),
      isMarket: z.boolean().optional().default(true).describe('True for market (via create_order), false for limit'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      const { isMarket, ...rest } = params as any;
      // hl_place_order has no isMarket field — route market intent through
      // hl_create_order (empty TP/SL) so it is never silently dropped.
      if (isMarket !== false) {
        return sdk.hlCreateOrder({ ...rest, isMarket: true, tpPrice: '', slPrice: '' });
      }
      return sdk.hlPlaceOrder(rest);
    }),
  );

  server.tool(
    'close_perp_position',
    'Close (fully or partially) one perp position with a reduce-only market order. The side is read ' +
      'from the live HL position: a long is closed with a sell, a short with a buy. Rejects when the ' +
      'position is flat/missing, when size exceeds it, or when a bare coin is open on several builder DEXes.',
    {
      ...hlCredentials,
      coin: z.string().describe("Asset symbol to close; builder-DEX assets as 'dex:ASSET', e.g. 'xyz:TSLA'"),
      dex: z.string().optional().describe("Builder DEX for a bare coin, e.g. 'xyz' (omit for the default dex)"),
      size: z.string().optional().describe('Size to close as a decimal string; omit to close the whole position'),
      price: z.string().optional().describe("Close price; omit or '0' to use the mark price"),
      positionAddress: z.string().optional().describe(
        'Address whose HL account holds the position — normally the MANAGED wallet from sign-in. Defaults to walletAddress.',
      ),
      szDecimals: z.number().optional().describe('Market size decimals (HL meta szDecimals); rejects a size with more decimals'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.closePerpPosition(params as any);
    }),
  );

  server.tool(
    'close_all_positions',
    'Close all open perpetual positions on HyperLiquid. Known unreliable: the backend endpoint frequently ' +
      'returns TIMEOUT or 400 / JSON parse errors. Prefer close_perp_position per coin.',
    {
      ...hlCredentials,
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.hlCloseAll(params as any);
    }),
  );

  server.tool(
    'cancel_perp_order',
    'Cancel a specific open perp order on HyperLiquid.',
    {
      ...hlCredentials,
      coin: z.string().describe('Asset symbol'),
      orderId: z.string().describe('Order ID to cancel'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.hlCancelOrder(params as any);
    }),
  );

  server.tool(
    'cancel_all_perp_orders',
    'Cancel all open perp orders on HyperLiquid.',
    {
      ...hlCredentials,
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.hlCancelAllOrders(params as any);
    }),
  );

  server.tool(
    'set_leverage',
    'Set leverage for a specific asset on HyperLiquid. Known broken: /hl/update_leverage has returned 404 ' +
      'in live tests. Pass `leverage` on open_perp_position instead (sent with the order).',
    {
      ...hlCredentials,
      coin: z.string().describe('Asset symbol'),
      leverage: z.number().describe('Leverage multiplier (1-50)'),
      isCross: z.boolean().optional().default(true).describe('True for cross margin, false for isolated'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.hlUpdateLeverage(params as any);
    }),
  );

  server.tool(
    'perp_deposit',
    'Deposit USDC into the HyperLiquid perpetual account from Arbitrum.',
    {
      ...hlCredentials,
      tokenAddress: z.string().describe('USDC token address on Arbitrum'),
      amount: z.string().describe("USDC amount to deposit, e.g. '100'. Min 10 USDC."),
      chainId: z.number().optional().default(42161).describe('Chain ID (must be 42161 = Arbitrum)'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.perpDeposit(params as any);
    }),
  );

  server.tool(
    'perp_withdraw',
    'Withdraw USDC from the HyperLiquid perpetual account.',
    {
      ...hlCredentials,
      amount: z.string().describe('USDC amount to withdraw'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.perpWithdraw(params as any);
    }),
  );
}
