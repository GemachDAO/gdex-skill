import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSdk, handleToolCall } from '../sdk.js';

/** Plain positive decimal, e.g. '0.1' or '100' (no sign, exponent or units). */
const DECIMAL_AMOUNT = /^\d+(\.\d+)?$/;
/** Plain decimal or a percentage of the holding, e.g. '100' or '50%'. */
const DECIMAL_OR_PERCENT_AMOUNT = /^\d+(\.\d+)?%?$/;

export function registerSpotTradeTools(server: McpServer): void {
  server.tool(
    'buy_token',
    'Buy a token on any supported chain (Solana, Sui, Ethereum, Base, Arbitrum, BSC, etc.) using the best DEX route.',
    {
      chain: z.union([z.string(), z.number()]).describe("Chain: 'solana', 'sui', or ChainId number (1=ETH, 8453=Base, 42161=Arbitrum)"),
      tokenAddress: z.string().describe('Contract address of the token to buy'),
      amount: z.string().regex(DECIMAL_AMOUNT, 'amount must be a plain decimal like "0.1"').describe("Amount of native token to spend, e.g. '0.1' for 0.1 SOL"),
      slippage: z.number().optional().default(1).describe('Max slippage tolerance in percent. Default: 1'),
      dex: z.string().optional().describe('Preferred DEX (raydium, orca, uniswap-v3, cetus, odos, etc.)'),
      walletAddress: z.string().optional().describe('Wallet address to trade from'),
      referrer: z.string().optional().describe('Referral address'),
      priorityFee: z.number().optional().describe('Solana priority fee in lamports (integer, Solana only)'),
      inputToken: z.string().optional().describe('Override input token address (default: native)'),
      sessionPrivateKey: z.string().optional().describe('Managed-custody session private key (from sign-in). Required for EVM managed swaps — routes through the session-signed purchase_v2 flow.'),
      apiKey: z.string().optional().describe('GDEX API key for managed-custody buys (with sessionPrivateKey).'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.buyToken(params as any);
    }),
  );

  server.tool(
    'sell_token',
    "Sell a token on any supported chain. Amount can be absolute ('100') or percentage ('50%').",
    {
      chain: z.union([z.string(), z.number()]).describe('Chain identifier'),
      tokenAddress: z.string().describe('Contract address of the token to sell'),
      amount: z.string().regex(DECIMAL_OR_PERCENT_AMOUNT, 'amount must be a plain decimal like "100" or a percentage like "50%"').describe("Amount to sell, e.g. '100' or '50%'"),
      slippage: z.number().optional().default(1).describe('Max slippage tolerance in percent'),
      dex: z.string().optional().describe('Preferred DEX'),
      walletAddress: z.string().optional().describe('Wallet address to trade from'),
      referrer: z.string().optional().describe('Referral address'),
      priorityFee: z.number().optional().describe('Solana priority fee in lamports (integer, Solana only)'),
      outputToken: z.string().optional().describe('Override output token address'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.sellToken(params as any);
    }),
  );
}
