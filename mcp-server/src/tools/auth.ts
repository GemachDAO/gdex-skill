import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSdk, handleToolCall } from '../sdk.js';

export function registerAuthTools(server: McpServer): void {
  server.tool(
    'auth_login',
    'Authenticate with a GDEX API key. Sets the Bearer token for all subsequent requests.',
    { apiKey: z.string().describe('GDEX API key (UUID format)') },
    async ({ apiKey }) => handleToolCall(async () => {
      const sdk = getSdk();
      sdk.loginWithApiKey(apiKey);
      return { success: true, message: 'Logged in with API key' };
    }),
  );

  server.tool(
    'generate_session_keypair',
    'Advanced/manual signing only: generate a secp256k1 session keypair. Prefer gdex_connect, which signs in and keeps keys on this machine. Returns only the public sessionKey unless revealPrivateKey is true.',
    { revealPrivateKey: z.boolean().optional().describe('Return sessionPrivateKey too (it then appears in the conversation)') },
    async ({ revealPrivateKey }) => handleToolCall(async () => {
      const sdk = getSdk();
      const kp = sdk.generateManagedSessionKeyPair();
      return revealPrivateKey
        ? kp
        : { sessionKey: kp.sessionKey, note: 'Private key withheld. Use gdex_connect for a stored session, or call again with revealPrivateKey: true for manual signing.' };
    }),
  );

  server.tool(
    'managed_sign_in',
    'Sign in to GDEX managed-custody system using encrypted computedData payload.',
    {
      computedData: z.string().describe('AES-256-CBC encrypted sign-in payload'),
      chainId: z.union([z.number(), z.string()]).describe('Chain ID (622112261=Solana, 42161=Arbitrum for HL perps)'),
    },
    async ({ computedData, chainId }) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.signInWithComputedData({ computedData, chainId: Number(chainId) });
    }),
  );

  server.tool(
    'build_sign_in_payload',
    'Build the encrypted sign-in computedData payload from raw credentials. Returns the payload to use with managed_sign_in.',
    {
      apiKey: z.string().describe('GDEX API key'),
      userId: z.string().describe('Control wallet address'),
      sessionKey: z.string().describe('Session public key (0x + 66 hex)'),
      nonce: z.string().describe('Unique nonce string'),
      signature: z.string().describe('EVM/Solana wallet signature of the sign-in message'),
      refSourceCode: z.string().optional().describe('Optional referral code'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.buildManagedSignInComputedData(params);
    }),
  );
}
