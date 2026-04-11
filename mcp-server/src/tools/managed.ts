import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSdk, handleToolCall } from '../sdk.js';

export function registerManagedTools(server: McpServer): void {
  server.tool(
    'managed_purchase',
    'Submit an encrypted managed-custody buy trade via the GDEX backend.',
    {
      computedData: z.string().describe('AES-encrypted trade payload with signed data'),
      chainId: z.union([z.number(), z.string()]).describe('Chain ID for the trade'),
      slippage: z.number().optional().default(1).describe('Max slippage %. Default: 1'),
      tip: z.string().optional().describe('Optional priority fee'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.submitManagedPurchase({
        computedData: params.computedData,
        chainId: Number(params.chainId),
        slippage: params.slippage,
        tip: params.tip,
      } as any);
    }),
  );

  server.tool(
    'managed_sell',
    'Submit an encrypted managed-custody sell trade via the GDEX backend.',
    {
      computedData: z.string().describe('AES-encrypted trade payload with signed data'),
      chainId: z.union([z.number(), z.string()]).describe('Chain ID for the trade'),
      slippage: z.number().optional().default(1).describe('Max slippage %. Default: 1'),
      tip: z.string().optional().describe('Optional priority fee'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.submitManagedSell({
        computedData: params.computedData,
        chainId: Number(params.chainId),
        slippage: params.slippage,
        tip: params.tip,
      } as any);
    }),
  );

  server.tool(
    'managed_trade_status',
    'Poll the status of a managed-custody trade by requestId.',
    {
      requestId: z.string().describe('Request ID returned from purchase/sell submission'),
    },
    async ({ requestId }) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getManagedTradeStatus(requestId);
    }),
  );

  server.tool(
    'build_trade_payload',
    'Build an encrypted managed-custody trade computedData payload from raw credentials.',
    {
      apiKey: z.string().describe('API key for AES encryption'),
      action: z.enum(['purchase', 'sell']).describe('Trade action'),
      userId: z.string().describe('Control wallet address'),
      tokenAddress: z.string().describe('Token contract address'),
      amount: z.string().describe('Trade amount'),
      nonce: z.string().describe('Unique nonce'),
      sessionPrivateKey: z.string().describe('Session private key'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.buildManagedTradeComputedData(params as any);
    }),
  );
}
