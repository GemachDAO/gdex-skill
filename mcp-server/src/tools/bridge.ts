import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSdk, handleToolCall } from '../sdk.js';

export function registerBridgeTools(server: McpServer): void {
  server.tool(
    'estimate_bridge',
    'Get a cross-chain bridge quote without executing. Returns estimated output, provider, and time.',
    {
      fromChainId: z.number().describe('Source chain ID'),
      toChainId: z.number().describe('Destination chain ID'),
      amount: z.string().describe('Amount in raw units'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.estimateBridge(params as any);
    }),
  );

  server.tool(
    'execute_bridge',
    'Execute a cross-chain bridge transaction. Requires managed-custody auth.',
    {
      fromChainId: z.number().describe('Source chain ID'),
      toChainId: z.number().describe('Destination chain ID'),
      amount: z.string().describe('Amount in raw units'),
      userId: z.string().describe('Control wallet address'),
      sessionPrivateKey: z.string().describe('Session private key'),
      apiKey: z.string().describe('API key for AES encryption'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.requestBridge(params as any);
    }),
  );

  server.tool(
    'get_bridge_orders',
    'Get bridge order history for a user. Requires session-key auth.',
    {
      userId: z.string().describe('Control wallet address'),
      data: z.string().describe('Encrypted session key'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.getBridgeOrders(params as any);
    }),
  );
}
