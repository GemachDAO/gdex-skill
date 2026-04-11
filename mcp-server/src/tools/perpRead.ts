import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSdk, handleToolCall } from '../sdk.js';

export function registerPerpReadTools(server: McpServer): void {
  server.tool(
    'get_account_state',
    'Get full HyperLiquid account state: positions, margin, balance, withdrawable amount. No auth required.',
    {
      walletAddress: z.string().describe('Wallet address to query'),
    },
    async ({ walletAddress }) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getHlAccountState(walletAddress);
    }),
  );

  server.tool(
    'get_perp_positions',
    'Get all open perpetual positions for a wallet on HyperLiquid. No auth required.',
    {
      walletAddress: z.string().describe('Wallet address to query'),
      coin: z.string().optional().describe("Optional filter to specific asset, e.g. 'BTC'"),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getPerpPositions(params);
    }),
  );

  server.tool(
    'get_mark_price',
    'Get the current mark price for a HyperLiquid asset. No auth required.',
    {
      coin: z.string().describe("Asset symbol, e.g. 'BTC', 'ETH'"),
    },
    async ({ coin }) => handleToolCall(async () => {
      const sdk = getSdk();
      const price = await sdk.getHlMarkPrice(coin);
      return { coin, markPrice: price };
    }),
  );

  server.tool(
    'get_all_mid_prices',
    'Get all current mid prices across all HyperLiquid assets. No auth required.',
    {},
    async () => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getHlAllMids();
    }),
  );

  server.tool(
    'get_usdc_balance',
    'Get USDC balance on HyperLiquid for a wallet. No auth required.',
    {
      walletAddress: z.string().describe('Wallet address to query'),
    },
    async ({ walletAddress }) => handleToolCall(async () => {
      const sdk = getSdk();
      const balance = await sdk.getHlUsdcBalance(walletAddress);
      return { walletAddress, usdcBalance: balance };
    }),
  );

  server.tool(
    'get_hl_open_orders',
    'Get all open orders on HyperLiquid for a wallet. No auth required.',
    {
      walletAddress: z.string().describe('Wallet address to query'),
    },
    async ({ walletAddress }) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getHlOpenOrders(walletAddress);
    }),
  );

  server.tool(
    'get_hl_trade_history',
    'Get trade history on HyperLiquid for a wallet. No auth required.',
    {
      walletAddress: z.string().describe('Wallet address to query'),
    },
    async ({ walletAddress }) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getHlTradeHistory(walletAddress);
    }),
  );

  server.tool(
    'get_hl_spot_state',
    'Get HyperLiquid spot trading state for a wallet. No auth required.',
    {
      walletAddress: z.string().describe('Wallet address to query'),
    },
    async ({ walletAddress }) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getHlSpotState(walletAddress);
    }),
  );

  server.tool(
    'get_trader_leverage',
    'Get the active leverage setting a trader uses for a specific coin on HyperLiquid.',
    {
      traderWallet: z.string().describe('Trader wallet address'),
      coin: z.string().describe('Asset symbol'),
    },
    async ({ traderWallet, coin }) => handleToolCall(async () => {
      const sdk = getSdk();
      const leverage = await sdk.getHlTraderLeverageContext(traderWallet, coin);
      return { traderWallet, coin, leverage };
    }),
  );
}
