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
    'Place a simple perp order on HyperLiquid without TP/SL.',
    {
      ...hlCredentials,
      coin: z.string().describe('Asset symbol'),
      isLong: z.boolean().describe('True for long, false for short'),
      price: z.string().describe('Price in USD'),
      size: z.string().describe('Position size in contracts'),
      reduceOnly: z.boolean().optional().default(false),
      isMarket: z.boolean().optional().default(true),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.hlPlaceOrder(params as any);
    }),
  );

  server.tool(
    'close_perp_position',
    'Close a specific perp position with a reduce-only market order. Direction and size '
      + 'are resolved from the open position, so closing a SHORT correctly submits a buy.',
    {
      ...hlCredentials,
      coin: z.string().describe('Asset symbol to close'),
      size: z.string().optional().describe('Size to close; defaults to the full open position'),
      price: z.string().optional().describe('Limit price; omit for a market close'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      // Resolve the live position: a reduce-only order to close a LONG is a SELL (isLong
      // false) and to close a SHORT is a BUY (isLong true). Hardcoding isLong:false made
      // close_perp_position silently fail for every short position.
      const positions = await sdk.getPerpPositions({
        walletAddress: params.walletAddress,
        coin: params.coin,
      });
      const pos = positions.find((p) => p.coin.toUpperCase() === params.coin.toUpperCase());
      if (!pos) {
        throw new Error(`no open ${params.coin} position to close`);
      }
      return sdk.hlCreateOrder({
        apiKey: params.apiKey,
        walletAddress: params.walletAddress,
        sessionPrivateKey: params.sessionPrivateKey,
        coin: params.coin,
        size: params.size ?? pos.size,
        price: params.price ?? '',
        isLong: pos.side === 'short',
        reduceOnly: true,
        isMarket: true,
        tpPrice: '',
        slPrice: '',
      } as any);
    }),
  );

  server.tool(
    'close_all_positions',
    'Close all open perpetual positions on HyperLiquid. Note: may be unreliable — prefer closing per-coin.',
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
    'Set leverage for a specific asset on HyperLiquid. Supports cross and isolated margin modes.',
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
