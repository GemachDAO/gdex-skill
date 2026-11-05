import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { handleToolCall } from '../sdk.js';
import { features } from '../features.js';
import { INVITE_CODE_RE } from '../practice/capsule.js';
import {
  connectAccount,
  connectGeneratedWallet,
  listAccounts,
  loadAccount,
  readKeyFile,
  removeAccount,
  summarize,
} from '../credentials.js';

/** What happened to an invite the user asked to use, from the sign-in response itself. */
function inviteOutcome(code: string, referralSource: string | null | undefined) {
  if (referralSource === code) return { code, state: 'attributed', note: 'GDEX recorded this invite on the new account. Referral rewards accrue later from eligible fees; nothing has been earned yet.' };
  if (referralSource) return { code, state: 'already_attributed', note: 'This account was already attributed to a different invite; GDEX does not change it.' };
  return { code, state: 'not_attributed', note: 'GDEX did not record the invite. Invites count only on a brand-new account\'s first sign-in, with a valid code that is not the account\'s own.' };
}

export function registerAccountTools(server: McpServer): void {
  const invites = features().invites;
  server.tool(
    'gdex_connect',
    'Connect a GDEX trading account without putting any secret in the conversation. Signs in from a control-wallet key file on this machine (keyFile), or creates a new local wallet (create: true), or refreshes an existing accountRef. Returns an accountRef plus public addresses; pass accountRef to any trading tool instead of sessionPrivateKey/privateKey. Never ask the user to paste a private key or seed phrase.',
    {
      keyFile: z.string().optional().describe('Path to a local JSON key file ({ privateKey } or { control: { privateKey } })'),
      create: z.boolean().optional().describe('Create and store a new local control wallet (it starts unfunded)'),
      accountRef: z.string().optional().describe('Refresh the session of an already connected account'),
      ...(invites ? { inviteCode: z.string().regex(INVITE_CODE_RE).optional().describe('Only with create: true, and only when the user explicitly chose to use someone\'s GDEX invite. Counts only for a brand-new account.') } : {}),
    },
    async ({ keyFile, create, accountRef, inviteCode }: { keyFile?: string; create?: boolean; accountRef?: string; inviteCode?: string }) => handleToolCall(async () => {
      const chosen = [keyFile, create, accountRef].filter((v) => v !== undefined && v !== false).length;
      if (chosen !== 1) throw new Error('Pass exactly one of keyFile, create: true, or accountRef');
      if (inviteCode && !create) throw new Error('inviteCode only applies to a new account (create: true); an existing account keeps its attribution');
      const account = keyFile
        ? await connectAccount({ controlPrivateKey: await readKeyFile(keyFile), source: 'key_file' })
        : create
          ? await connectGeneratedWallet(undefined, inviteCode)
          : await (async () => {
            const a = await loadAccount(accountRef as string);
            return connectAccount({ controlPrivateKey: a.controlPrivateKey, source: a.source, apiKey: a.apiKey });
          })();
      return {
        ...summarize(account),
        ...(inviteCode ? { invite: inviteOutcome(inviteCode, (account as { signIn?: { referralSource: string | null } }).signIn?.referralSource) } : {}),
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
