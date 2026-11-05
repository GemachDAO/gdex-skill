/**
 * gdex_connect inviteCode: sent only at a new account's first sign-in, only when given,
 * and reported from GDEX's own sign-in response (never assumed).
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { AbiCoder } from 'ethers';

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'gdex-invite-'));
process.env.GDEX_HOME = home;
process.env.GDEX_API_KEY = 'test-api-key';

const CODE = 'TestRefCode123456789';
let referralSource = '';
const signIn = jest.fn(async (_p: { computedData: string }) => ({ address: 'managed', referralSource }));
jest.unstable_mockModule('../src/sdk.js', () => ({
  getSdk: () => ({
    signInWithComputedData: signIn,
    getManagedUser: jest.fn(async () => ({ address: '0xmanaged' })),
    getBrowserSession: () => ({ cookie: 'c', expiresAt: Date.now() + 3_600_000 }),
    setBrowserSession: jest.fn(),
    setSessionSigningKey: jest.fn(),
  }),
  readEnv: (n: string) => process.env[n],
  handleToolCall: async (fn: () => Promise<unknown>) => {
    try { return { content: [{ type: 'text', text: JSON.stringify(await fn()) }] }; } catch (e) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { message: (e as Error).message } }) }] };
    }
  },
}));

const { registerAccountTools } = await import('../src/tools/account.js');
const { decryptGdexComputedData } = await import('@gemachdao/gdex-skill');

function connectTool() {
  const tools = new Map<string, any>();
  registerAccountTools({ tool: (name: string, _d: string, shape: any, handler: any) => tools.set(name, { shape, handler }) } as any);
  return tools.get('gdex_connect')!;
}
const run = async (p: Record<string, unknown>) => {
  const r = await connectTool().handler(p);
  return { isError: r.isError === true, body: JSON.parse(r.content[0].text) };
};

/** Pull refSourceCode back out of the encrypted sign-in payload. */
function refInPayload(computedData: string): string {
  const { data } = JSON.parse(decryptGdexComputedData(computedData, 'test-api-key'));
  const [, , ref] = AbiCoder.defaultAbiCoder().decode(['bytes', 'string', 'string'], `0x${data}`);
  return ref as string;
}

beforeEach(() => { jest.clearAllMocks(); referralSource = ''; });

describe('gdex_connect inviteCode', () => {
  it('attributed when GDEX records the code on the new account', async () => {
    referralSource = CODE;
    const { body } = await run({ create: true, inviteCode: CODE });
    expect(body.invite).toMatchObject({ code: CODE, state: 'attributed' });
    expect(body.invite.note).toMatch(/nothing has been earned yet/);
    expect(refInPayload(signIn.mock.calls[0][0].computedData)).toBe(CODE);
  });

  it('not_attributed when GDEX ignored it (invalid/self/existing) — never claimed as credited', async () => {
    const { body } = await run({ create: true, inviteCode: CODE });
    expect(body.invite.state).toBe('not_attributed');
  });

  it('already_attributed when the account carries another referrer', async () => {
    referralSource = 'zzzzzzzzzzzzzzzzzzzz';
    expect((await run({ create: true, inviteCode: CODE })).body.invite.state).toBe('already_attributed');
  });

  it('is refused for existing accounts and malformed codes; absent → no invite field', async () => {
    const keyFile = path.join(home, 'k.json');
    await fs.writeFile(keyFile, JSON.stringify({ privateKey: '0x' + '11'.repeat(32) }));
    expect((await run({ keyFile, inviteCode: CODE })).isError).toBe(true);
    expect(connectTool().shape.inviteCode.safeParse('https://evil/?ref=x').success).toBe(false);
    const plain = await run({ create: true });
    expect(plain.body.invite).toBeUndefined();
    expect(refInPayload(signIn.mock.calls.at(-1)![0].computedData)).toBe('');
  });
});
