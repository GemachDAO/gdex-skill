import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSdk, handleToolCall } from '../sdk.js';

export function registerLimitOrderTools(server: McpServer): void {
  server.tool(
    'limit_buy',
    'Create a limit buy order — buy a token when price drops to target. Uses ABI-encoded + AES-encrypted computedData.',
    {
      apiKey: z.string().describe('API key for AES encryption'),
      userId: z.string().describe('Control wallet address (NOT managed wallet)'),
      sessionPrivateKey: z.string().describe('Session private key from sign-in'),
      chainId: z.number().describe('Numeric chain ID (e.g. 622112261 for Solana)'),
      tokenAddress: z.string().describe('Token address to buy'),
      amount: z.string().describe('Native token to spend in raw units (wei/lamports)'),
      triggerPrice: z.string().describe('USD price at which to trigger the buy'),
      profitPercent: z.string().optional().default('0').describe("Take-profit % above trigger (e.g. '50'), '0' to skip"),
      lossPercent: z.string().optional().default('0').describe("Stop-loss % below trigger (e.g. '25'), '0' to skip"),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.limitBuy(params as any);
    }),
  );

  server.tool(
    'limit_sell',
    'Create a limit sell order — sell a token when price reaches target. Auto-classifies as TP or SL.',
    {
      apiKey: z.string().describe('API key for AES encryption'),
      userId: z.string().describe('Control wallet address'),
      sessionPrivateKey: z.string().describe('Session private key from sign-in'),
      chainId: z.number().describe('Numeric chain ID'),
      tokenAddress: z.string().describe('Token address to sell'),
      amount: z.string().describe('Token amount in raw units'),
      triggerPrice: z.string().describe('USD price at which to trigger the sell'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.limitSell(params as any);
    }),
  );

  server.tool(
    'update_order',
    'Update or delete an existing limit order. Set isDelete=true to cancel.',
    {
      apiKey: z.string().describe('API key for AES encryption'),
      userId: z.string().describe('Control wallet address'),
      sessionPrivateKey: z.string().describe('Session private key from sign-in'),
      chainId: z.number().describe('Numeric chain ID'),
      orderId: z.string().describe('64-char hex order ID from get_limit_orders'),
      amount: z.string().optional().describe('New amount in raw units'),
      triggerPrice: z.string().optional().describe('New trigger price in USD'),
      profitPercent: z.string().optional().describe('New TP % (buy orders only)'),
      lossPercent: z.string().optional().describe('New SL % (buy orders only)'),
      isDelete: z.boolean().optional().default(false).describe('Set true to cancel the order'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.updateOrder(params as any);
    }),
  );

  server.tool(
    'get_limit_orders',
    'List active limit orders for a user on a specific chain. Requires session-key auth.',
    {
      userId: z.string().describe('Control wallet address'),
      data: z.string().describe('Encrypted session key from buildGdexUserSessionData()'),
      chainId: z.number().describe('Numeric chain ID'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getLimitOrders(params as any);
    }),
  );
}
