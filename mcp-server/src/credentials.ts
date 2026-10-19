/**
 * Local account store: keeps wallet and session secrets on this machine so they
 * never pass through the agent conversation.
 *
 * `gdex_connect` signs in from a key file on disk (or a newly generated wallet)
 * and returns an opaque `accountRef`. Every tool that takes `sessionPrivateKey`,
 * `privateKey` or `data` also accepts `accountRef`; the server fills those
 * fields from the store. Advanced callers can still pass raw values.
 *
 * Storage: `$GDEX_HOME/accounts/<ref>.json` (default `~/.gdex`), directory 0700,
 * files 0600, plain JSON. Protect it like an SSH key.
 */
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { Wallet } from 'ethers';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  GDEX_API_KEY_PRIMARY,
  GdexValidationError,
  buildGdexSignInComputedData,
  buildGdexSignInMessage,
  buildGdexUserSessionData,
  generateGdexNonce,
  generateGdexSessionKeyPair,
} from '@gemachdao/gdex-skill';
import { getSdk, readEnv } from './sdk.js';

const SOLANA_CHAIN_ID = 622112261;

export interface StoredAccount {
  version: 1;
  accountRef: string;
  /** Control wallet (the GDEX userId). */
  walletAddress: string;
  controlPrivateKey: string;
  sessionPrivateKey: string;
  sessionKey: string;
  apiKey: string;
  source: 'generated' | 'key_file';
  createdAt: number;
  sessionAt: number;
  managed?: { evm?: string; solana?: string };
}

/** Public view of an account: never contains key material. */
export interface AccountSummary {
  accountRef: string;
  walletAddress: string;
  managedWallets?: { evm?: string; solana?: string };
  source: StoredAccount['source'];
  sessionAgeMinutes: number;
}

export function gdexHome(): string {
  return readEnv('GDEX_HOME') ?? path.join(os.homedir(), '.gdex');
}

function accountsDir(): string {
  return path.join(gdexHome(), 'accounts');
}

function refFor(address: string): string {
  return 'acct_' + createHash('sha256').update(address.toLowerCase()).digest('hex').slice(0, 12);
}

function assertRef(ref: string): void {
  if (!/^acct_[0-9a-f]{12}$/.test(ref)) throw new GdexValidationError(`Invalid accountRef: ${ref}`, 'accountRef');
}

export function summarize(a: StoredAccount): AccountSummary {
  return {
    accountRef: a.accountRef,
    walletAddress: a.walletAddress,
    managedWallets: a.managed,
    source: a.source,
    sessionAgeMinutes: Math.round((Date.now() - a.sessionAt) / 60000),
  };
}

async function save(a: StoredAccount): Promise<void> {
  await fs.mkdir(accountsDir(), { recursive: true, mode: 0o700 });
  await fs.chmod(accountsDir(), 0o700);
  const file = path.join(accountsDir(), `${a.accountRef}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(a, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
}

export async function loadAccount(ref: string): Promise<StoredAccount> {
  assertRef(ref);
  try {
    return JSON.parse(await fs.readFile(path.join(accountsDir(), `${ref}.json`), 'utf8')) as StoredAccount;
  } catch {
    throw new GdexValidationError(`Unknown accountRef ${ref}: connect it with gdex_connect first`, 'accountRef');
  }
}

export async function listAccounts(): Promise<AccountSummary[]> {
  const names = await fs.readdir(accountsDir()).catch(() => [] as string[]);
  const out: AccountSummary[] = [];
  for (const n of names.filter((f) => /^acct_[0-9a-f]{12}\.json$/.test(f))) {
    out.push(summarize(await loadAccount(n.replace(/\.json$/, ''))));
  }
  return out;
}

export async function removeAccount(ref: string): Promise<boolean> {
  assertRef(ref);
  return fs.rm(path.join(accountsDir(), `${ref}.json`)).then(() => true, () => false);
}

/**
 * Read a control-wallet private key from a local JSON file. Accepts
 * `{ privateKey }`, `{ control: { privateKey } }` (the GDEX test-wallet layout)
 * or a bare 0x-hex key file.
 */
export async function readKeyFile(file: string): Promise<string> {
  const resolved = path.resolve(file.replace(/^~(?=$|\/)/, os.homedir()));
  const text = (await fs.readFile(resolved, 'utf8')).trim();
  let key: unknown = text;
  if (text.startsWith('{')) {
    const j = JSON.parse(text) as { privateKey?: string; control?: { privateKey?: string } };
    key = j.control?.privateKey ?? j.privateKey;
  }
  if (typeof key !== 'string' || !/^(0x)?[0-9a-fA-F]{64}$/.test(key)) {
    throw new GdexValidationError(`No EVM private key found in ${resolved}`, 'keyFile');
  }
  return key.startsWith('0x') ? key : `0x${key}`;
}

/** Sign in a control wallet with a fresh session key and store (or refresh) the account. */
export async function connectAccount(input: {
  controlPrivateKey: string;
  source: StoredAccount['source'];
  apiKey?: string;
}): Promise<StoredAccount> {
  const wallet = new Wallet(input.controlPrivateKey);
  const apiKey = input.apiKey ?? readEnv('GDEX_API_KEY') ?? GDEX_API_KEY_PRIMARY;
  const sdk = getSdk();
  const kp = generateGdexSessionKeyPair();
  const nonce = generateGdexNonce().toString();
  const signature = await wallet.signMessage(buildGdexSignInMessage(wallet.address, nonce, kp.sessionKey));
  const payload = buildGdexSignInComputedData({
    apiKey,
    userId: wallet.address,
    sessionKey: kp.sessionKey,
    nonce,
    signature: signature.replace(/^0x/, ''),
  });
  await sdk.signInWithComputedData({ computedData: payload.computedData, chainId: SOLANA_CHAIN_ID });

  const data = buildGdexUserSessionData(kp.sessionKey, apiKey);
  const managed: StoredAccount['managed'] = {};
  for (const [k, chainId] of [['evm', 42161], ['solana', SOLANA_CHAIN_ID]] as const) {
    const u = await sdk.getManagedUser({ userId: wallet.address, data, chainId }).catch(() => undefined);
    if (u && typeof u.address === 'string') managed[k] = u.address;
  }

  const ref = refFor(wallet.address);
  const existing = await loadAccount(ref).catch(() => undefined);
  const account: StoredAccount = {
    version: 1,
    accountRef: ref,
    walletAddress: wallet.address,
    controlPrivateKey: input.controlPrivateKey,
    sessionPrivateKey: kp.sessionPrivateKey,
    sessionKey: kp.sessionKey,
    apiKey,
    source: existing?.source ?? input.source,
    createdAt: existing?.createdAt ?? Date.now(),
    sessionAt: Date.now(),
    managed,
  };
  await save(account);
  return account;
}

/** Create a new control wallet locally and connect it. */
export async function connectGeneratedWallet(apiKey?: string): Promise<StoredAccount> {
  return connectAccount({ controlPrivateKey: Wallet.createRandom().privateKey, source: 'generated', apiKey });
}

/** Credential fields `accountRef` can supply. */
const SECRET_FIELDS = ['sessionPrivateKey', 'privateKey', 'data'] as const;
const IDENTITY_FIELDS = ['walletAddress', 'userId', 'apiKey'] as const;
/** Filled from the account when present in the schema but never relaxed or required. */
const CONTEXT_FIELDS = ['positionAddress'] as const;

const ACCOUNT_REF_SCHEMA = z
  .string()
  .optional()
  .describe('Connected account from gdex_connect. Supplies session key, wallet address, API key and session data so no secret is passed in chat');

/** Fill credential fields of `params` from the stored account. Explicit values win. */
export async function applyAccountRef(params: Record<string, unknown>, shape: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ref = params.accountRef;
  const { accountRef: _omit, ...rest } = params;
  if (typeof ref !== 'string' || !ref) {
    for (const [f, t] of Object.entries(shape)) {
      if (rest[f] === undefined && !isOptional(t)) {
        throw new GdexValidationError(`${f} or accountRef is required`, f);
      }
    }
    return rest;
  }
  const a = await loadAccount(ref);
  const fill: Record<string, unknown> = {
    sessionPrivateKey: a.sessionPrivateKey,
    privateKey: a.controlPrivateKey,
    walletAddress: a.walletAddress,
    userId: a.walletAddress,
    apiKey: a.apiKey,
    data: buildGdexUserSessionData(a.sessionKey, a.apiKey),
    // Hyperliquid positions live on the managed EVM wallet, not the control wallet.
    positionAddress: a.managed?.evm,
  };
  const out: Record<string, unknown> = { ...rest };
  for (const f of [...SECRET_FIELDS, ...IDENTITY_FIELDS, ...CONTEXT_FIELDS]) {
    if (f in shape && out[f] === undefined && fill[f] !== undefined) out[f] = fill[f];
  }
  return out;
}

/** Fields the wrapper relaxed to optional, remembered so a missing value is still rejected. */
const REQUIRED_MARK = Symbol('gdexRequiredUnlessAccountRef');

function isOptional(t: unknown): boolean {
  if ((t as Record<symbol, unknown>)?.[REQUIRED_MARK]) return false;
  return typeof (t as { isOptional?: () => boolean })?.isOptional === 'function'
    ? (t as { isOptional: () => boolean }).isOptional()
    : true;
}

/**
 * Wrap `server.tool` so every tool taking credential fields also accepts
 * `accountRef`, with those fields optional when it is given.
 */
export function enableAccountRefs(server: McpServer): void {
  const original = server.tool.bind(server) as (...args: unknown[]) => unknown;
  (server as unknown as { tool: (...args: unknown[]) => unknown }).tool = (...args: unknown[]) => {
    const shapeIdx = args.findIndex((a, i) => i > 0 && a !== null && typeof a === 'object' && !Array.isArray(a));
    const handlerIdx = args.length - 1;
    const shape = shapeIdx > 0 ? (args[shapeIdx] as Record<string, z.ZodTypeAny>) : undefined;
    if (!shape || !SECRET_FIELDS.some((f) => f in shape) || 'accountRef' in shape) return original(...args);

    const relaxed: Record<string, z.ZodTypeAny> = { accountRef: ACCOUNT_REF_SCHEMA };
    const declared: Record<string, unknown> = {};
    for (const [k, t] of Object.entries(shape)) {
      const credential = (SECRET_FIELDS as readonly string[]).includes(k) || (IDENTITY_FIELDS as readonly string[]).includes(k);
      if (credential && !t.isOptional()) {
        const opt = t.optional();
        Object.defineProperty(opt, REQUIRED_MARK, { value: true });
        relaxed[k] = opt;
        declared[k] = opt;
      } else {
        relaxed[k] = t;
        declared[k] = t;
      }
    }
    const handler = args[handlerIdx] as (params: Record<string, unknown>, extra: unknown) => unknown;
    const wrapped = async (params: Record<string, unknown>, extra: unknown) => {
      try {
        return await handler(await applyAccountRef(params, declared), extra);
      } catch (err) {
        const { handleToolCall } = await import('./sdk.js');
        return handleToolCall(async () => { throw err; });
      }
    };
    const next = [...args];
    next[shapeIdx] = relaxed;
    next[handlerIdx] = wrapped;
    return original(...next);
  };
}
