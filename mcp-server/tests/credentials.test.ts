/**
 * Local account store + accountRef wrapper: secrets come from disk, not tool arguments.
 */
import { jest, describe, it, expect, beforeAll } from '@jest/globals';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'gdex-home-'));
process.env.GDEX_HOME = home;

const signIn = jest.fn(async () => ({ address: 'managed' }));
const setBrowserSession = jest.fn();
const getUser = jest.fn(async ({ chainId }: { chainId: number }) => ({ address: chainId === 42161 ? '0xmanagedevm' : 'ManagedSol' }));
jest.unstable_mockModule('../src/sdk.js', () => ({
  getSdk: () => ({
    signInWithComputedData: signIn,
    getManagedUser: getUser,
    getBrowserSession: () => ({ cookie: `jwt-${signIn.mock.calls.length}`, expiresAt: Date.now() + 8 * 3600_000 }),
    setBrowserSession,
    setSessionSigningKey: jest.fn(),
  }),
  readEnv: (n: string) => process.env[n],
  handleToolCall: async (fn: () => Promise<unknown>) => {
    try { return { content: [{ type: 'text', text: JSON.stringify(await fn()) }] }; } catch (e) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { message: (e as Error).message } }) }] };
    }
  },
}));

const cred = await import('../src/credentials.js');
const { registerAccountTools } = await import('../src/tools/account.js');
const KEY = '0x' + '11'.repeat(32);

function fakeServer() {
  const tools = new Map<string, { shape: Record<string, z.ZodTypeAny>; handler: (p: any) => Promise<any> }>();
  const server: any = { tool: (name: string, _d: string, shape: any, handler: any) => tools.set(name, { shape, handler }) };
  return { server, tools };
}

describe('account store', () => {
  let ref: string;
  beforeAll(async () => {
    const keyFile = path.join(home, 'wallet.json');
    await fs.writeFile(keyFile, JSON.stringify({ control: { address: 'x', privateKey: KEY } }));
    const { server, tools } = fakeServer();
    registerAccountTools(server);
    const r = await tools.get('gdex_connect')!.handler({ keyFile });
    const out = JSON.parse(r.content[0].text);
    ref = out.accountRef;
    expect(r.content[0].text).not.toContain(KEY.slice(2));
    expect(out.managedWallets).toEqual({ evm: '0xmanagedevm', solana: 'ManagedSol' });
  });

  it('stores the account 0600 in a 0700 dir and lists it without secrets', async () => {
    const st = await fs.stat(path.join(home, 'accounts', `${ref}.json`));
    expect(st.mode & 0o777).toBe(0o600);
    expect((await fs.stat(path.join(home, 'accounts'))).mode & 0o777).toBe(0o700);
    const list = await cred.listAccounts();
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toMatch(/[0-9a-f]{64}/);
  });

  it('accountRef fills credential fields; explicit values win', async () => {
    const shape = { sessionPrivateKey: z.string(), walletAddress: z.string(), apiKey: z.string(), coin: z.string() };
    const filled = await cred.applyAccountRef({ accountRef: ref, coin: 'BTC' }, shape);
    expect(filled.walletAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(filled.sessionPrivateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(filled).not.toHaveProperty('accountRef');
    expect((await cred.applyAccountRef({ accountRef: ref, apiKey: 'mine' }, shape)).apiKey).toBe('mine');
  });

  it('enableAccountRefs relaxes credential fields but still requires them without accountRef', async () => {
    const { server, tools } = fakeServer();
    cred.enableAccountRefs(server);
    const seen: any[] = [];
    server.tool('t', 'd', { sessionPrivateKey: z.string(), walletAddress: z.string(), coin: z.string() }, async (p: any) => { seen.push(p); return { content: [{ type: 'text', text: '{}' }] }; });
    const t = tools.get('t')!;
    expect(t.shape.accountRef).toBeDefined();
    expect(t.shape.sessionPrivateKey.isOptional()).toBe(true);
    await t.handler({ accountRef: ref, coin: 'ETH' });
    expect(seen[0].sessionPrivateKey).toMatch(/^0x/);
    const r = await t.handler({ coin: 'ETH' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/sessionPrivateKey or accountRef is required/);
    expect(seen).toHaveLength(1);
  });

  it('leaves tools without credential fields untouched', () => {
    const { server, tools } = fakeServer();
    cred.enableAccountRefs(server);
    server.tool('plain', 'd', { coin: z.string() }, async () => ({}));
    expect(tools.get('plain')!.shape.accountRef).toBeUndefined();
  });

  it('refresh re-signs in; disconnect forgets the account', async () => {
    const { server, tools } = fakeServer();
    registerAccountTools(server);
    const before = signIn.mock.calls.length;
    await tools.get('gdex_connect')!.handler({ accountRef: ref });
    expect(signIn.mock.calls.length).toBe(before + 1);
    const r = await tools.get('gdex_disconnect')!.handler({ accountRef: ref });
    expect(JSON.parse(r.content[0].text)).toEqual({ removed: true });
    expect(await cred.listAccounts()).toHaveLength(0);
  });

  it('rejects malformed refs (no path traversal)', async () => {
    await expect(cred.loadAccount('../../etc/passwd')).rejects.toThrow(/Invalid accountRef/);
  });

  it('restores the session cookie, and signs in again once it has idled out', async () => {
    const { accountRef: ref } = await cred.connectAccount({ controlPrivateKey: KEY, source: 'key_file' });
    const shape = { sessionPrivateKey: z.string() };
    const before = signIn.mock.calls.length;
    await cred.applyAccountRef({ accountRef: ref }, shape);
    expect(signIn.mock.calls.length).toBe(before);
    expect(setBrowserSession).toHaveBeenLastCalledWith(expect.objectContaining({ cookie: `jwt-${before}` }));

    const file = path.join(home, 'accounts', `${ref}.json`);
    const stored = JSON.parse(await fs.readFile(file, 'utf8'));
    await fs.writeFile(file, JSON.stringify({ ...stored, sessionUsedAt: Date.now() - 31 * 60_000 }));
    const filled = await cred.applyAccountRef({ accountRef: ref }, shape);
    expect(signIn.mock.calls.length).toBe(before + 1);
    expect(filled.sessionPrivateKey).not.toBe(stored.sessionPrivateKey);
    expect(setBrowserSession).toHaveBeenLastCalledWith(expect.objectContaining({ cookie: `jwt-${before + 1}` }));
  });
});
