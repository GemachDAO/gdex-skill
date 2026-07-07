import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSdk, handleToolCall } from '../sdk.js';

export function registerForensicsTools(server: McpServer): void {
  server.tool(
    'reverse_engineer_winners',
    'Reverse-engineer skill-proven on-chain HyperLiquid wallets into size-invariant forensic patterns — skill-vs-luck scorecards, hold-time/leverage/sizing asymmetry, and prevalence-gated aggregate edges. Read-only. Optional watchlist of wallet addresses to force into the universe.',
    {
      watchlist: z.array(z.string()).optional().describe('Curated wallet addresses to force into the universe (bypass board filters)'),
      max: z.number().optional().describe('Cap on wallets pulled (board survivors + watchlist). Default 12.'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.reverseEngineerWinners(params);
    }),
  );
}
