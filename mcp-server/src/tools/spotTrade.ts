import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSdk, handleToolCall } from '../sdk.js';

/** Plain positive decimal, e.g. '0.1' or '100' (no sign, exponent or units). */
const DECIMAL_AMOUNT = /^\d+(\.\d+)?$/;
/** Plain decimal or a percentage of the holding, e.g. '100' or '50%'. */
const DECIMAL_OR_PERCENT_AMOUNT = /^\d+(\.\d+)?%?$/;

/**
 * Managed-custody credentials. Spot trades are session-signed (purchase_v2 /
 * sell_v2 require computedData), so these are required unless accountRef
 * supplies them (see credentials.ts enableAccountRefs).
 */
const tradeCredentials = {
  walletAddress: z.string().describe('Control wallet address (the GDEX userId)'),
  sessionPrivateKey: z.string().describe('Session private key from sign-in'),
  apiKey: z.string().describe('GDEX API key used to encrypt the signed trade'),
};

/** Options the backend reads outside the signature; validated by the SDK before signing. */
const tradeOptions = {
  slippage: z.number().optional().describe('Slippage percent, Solana and Sui only (sent as bps, max 50). Rejected on EVM, where the account\'s stored slippage applies. Omit to use the stored setting.'),
  priorityFee: z.number().int().optional().describe('Solana priority fee in lamports (integer, max 50000000 = 0.05 SOL). Solana only.'),
  dex: z.string().optional().describe('Not supported: the backend picks the route. Rejected when set.'),
  referrer: z.string().optional().describe('Not supported by purchase_v2/sell_v2. Rejected when set.'),
};

const NEXT = 'Call wait_for_trade with this requestId for the result. Never resubmit a trade that returned a requestId.';

export function registerSpotTradeTools(server: McpServer): void {
  server.tool(
    'buy_token',
    'Buy a token with the chain\'s native token from the managed GDEX wallet (session-signed purchase_v2). Chains: Ethereum 1, Optimism 10, BSC 56, Sonic 146, Fraxtal 252, Robinhood 4663, Base 8453, Arbitrum 42161, Solana. Returns a requestId; follow it with wait_for_trade. To pay with USDC use usdc_buy.',
    {
      chain: z.union([z.string(), z.number()]).describe("Chain: 'solana', 'base', or a chain id (8453=Base, 42161=Arbitrum)"),
      tokenAddress: z.string().describe('Contract address (mint on Solana) of the token to buy'),
      amount: z.string().regex(DECIMAL_AMOUNT, 'amount must be a plain decimal like "0.1"').describe("Native token to spend, e.g. '0.1' for 0.1 SOL; converted exactly to native decimals"),
      inputToken: z.string().optional().describe('Omit, or the chain\'s native token. Anything else is rejected (use usdc_buy for USDC).'),
      ...tradeOptions,
      ...tradeCredentials,
    },
    async (params) => handleToolCall(async () => {
      const result = await getSdk().buyToken(params as any);
      return { ...result, next: NEXT };
    }),
  );

  server.tool(
    'sell_token',
    "Sell a token for the chain's native token from the managed GDEX wallet (session-signed sell_v2). Amount is a token amount ('100') or a percentage of the held balance ('50%', '100%'), resolved from the managed holdings. Returns a requestId; follow it with wait_for_trade. To receive USDC use usdc_sell.",
    {
      chain: z.union([z.string(), z.number()]).describe('Chain identifier'),
      tokenAddress: z.string().describe('Contract address of the token to sell'),
      amount: z.string().regex(DECIMAL_OR_PERCENT_AMOUNT, 'amount must be a plain decimal like "100" or a percentage like "50%"').describe("Amount to sell, e.g. '100' or '50%'"),
      outputToken: z.string().optional().describe('Omit, or the chain\'s native token. Anything else is rejected (use usdc_sell for USDC).'),
      tokenDecimals: z.number().int().optional().describe('Only for an absolute amount of a token missing from the managed holdings'),
      ...tradeOptions,
      ...tradeCredentials,
    },
    async (params) => handleToolCall(async () => {
      const result = await getSdk().sellToken(params as any);
      return { ...result, next: NEXT };
    }),
  );

  server.tool(
    'wait_for_trade',
    'Follow a buy_token / sell_token requestId to its result by polling /v1/trade-status. outcome: filled, failed, not_found (expired id) or pending (still running at the timeout: never resubmit).',
    {
      requestId: z.string().describe('requestId returned by buy_token or sell_token'),
      timeoutSec: z.number().optional().describe('Max seconds to wait, default 120'),
    },
    async ({ requestId, timeoutSec }) => handleToolCall(async () =>
      getSdk().waitForTrade({ requestId, timeoutMs: timeoutSec !== undefined ? timeoutSec * 1000 : undefined })),
  );
}
