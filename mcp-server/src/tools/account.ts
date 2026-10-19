import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { handleToolCall } from '../sdk.js';
import {
  connectAccount,
  connectGeneratedWallet,
  listAccounts,
  loadAccount,
  readKeyFile,
  removeAccount,
  summarize,
} from '../credentials.js';

export function registerAccountTools(server: McpServer): void {
  server.tool(
    'gdex_connect',
    'Connect a GDEX trading account without putting any secret in the conversation. Signs in from a control-wallet key file on this machine (keyFile), or creates a new local wallet (create: true), or refreshes an existing accountRef. Returns an accountRef plus public addresses; pass accountRef to any trading tool instead of sessionPrivateKey/privateKey. Never ask the user to paste a private key or seed phrase.',
    {
      keyFile: z.string().optional().describe('Path to a local JSON key file ({ privateKey } or { control: { privateKey } })'),
      create: z.boolean().optional().describe('Create and store a new local control wallet (it starts unfunded)'),
      accountRef: z.string().optional().describe('Refresh the session of an already connected account'),
    },
    async ({ keyFile, create, accountRef }) => handleToolCall(async () => {
      const chosen = [keyFile, create, accountRef].filter((v) => v !== undefined && v !== false).length;
      if (chosen !== 1) throw new Error('Pass exactly one of keyFile, create: true, or accountRef');
      const account = keyFile
        ? await connectAccount({ controlPrivateKey: await readKeyFile(keyFile), source: 'key_file' })
        : create
          ? await connectGeneratedWallet()
          : await (async () => {
            const a = await loadAccount(accountRef as string);
            return connectAccount({ controlPrivateKey: a.controlPrivateKey, source: a.source, apiKey: a.apiKey });
          })();
      return {
        ...summarize(account),
        next: 'Pass this accountRef to trading tools. Fund the managed wallets (not the control wallet) to trade.',
      };
    }),
  );

  server.tool(
    'gdex_accounts',
    'List accounts connected on this machine (accountRef, control wallet, managed wallets, session age). No secrets are returned.',
    {},
    async () => handleToolCall(async () => ({ accounts: await listAccounts() })),
  );

  server.tool(
    'gdex_disconnect',
    'Forget a connected account on this machine (deletes its stored keys). Funds are not affected; reconnect later with gdex_connect and the key file.',
    { accountRef: z.string().describe('Account to forget') },
    async ({ accountRef }) => handleToolCall(async () => ({ removed: await removeAccount(accountRef) })),
  );
}
