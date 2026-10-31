/**
 * Browser-session contract (backend PR #382): origin headers, gdex_session
 * cookie round-trip, and signed GET /v1/user.
 */
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { SigningKey, keccak256, toUtf8Bytes, Signature } from 'ethers';
import { GdexApiClient } from '../../src/client';
import { browserRequestMessage, canonicalJson, sessionCookieFromHeaders } from '../../src/client/browserSession';
import { generateGdexSessionKeyPair } from '../../src/utils/gdexManagedCrypto';

type Sent = { method: string; url: string; headers: Record<string, string>; params?: unknown; data?: unknown };

function recorder(respond: (c: InternalAxiosRequestConfig) => { status: number; data?: unknown; headers?: Record<string, string[] | string> }) {
  const sent: Sent[] = [];
  const adapter: AxiosAdapter = async (config) => {
    sent.push({
      method: (config.method ?? 'get').toUpperCase(),
      url: config.url ?? '',
      headers: { ...(config.headers as unknown as Record<string, string>) },
      params: config.params,
      data: config.data,
    });
    const r = respond(config);
    const response = { data: r.data ?? {}, status: r.status, statusText: '', headers: r.headers ?? {}, config };
    if (r.status >= 400) {
      throw Object.assign(new Error(`status ${r.status}`), { config, response, isAxiosError: true, toJSON: () => ({}) });
    }
    return response;
  };
  return { adapter, sent };
}

function clientWith(adapter: AxiosAdapter): GdexApiClient {
  const client = new GdexApiClient({ apiUrl: 'https://api.test/v1', maxRetries: 0 } as never);
  (client as unknown as { http: { defaults: { adapter: AxiosAdapter } } }).http.defaults.adapter = adapter;
  return client;
}

const COOKIE = 'gdex_session=eyJhbGciOiJIUzI1NiJ9.e30.sig; Max-Age=28800; Path=/v1; HttpOnly; Secure; SameSite=Strict';

describe('browser session contract', () => {
  it('sends X-Gdex-Client and an allow-listed Origin on every request', async () => {
    const { adapter, sent } = recorder(() => ({ status: 200 }));
    await clientWith(adapter).post('/v1/sign_in', { computedData: 'x' });
    expect(sent[0].headers['X-Gdex-Client']).toBe('web');
    expect(sent[0].headers['Origin']).toBe('https://gdex.pro');
  });

  it('captures gdex_session from sign-in and replays it as a Cookie', async () => {
    const { adapter, sent } = recorder((c) =>
      c.url === '/sign_in' ? { status: 200, data: { isSuccess: true }, headers: { 'set-cookie': [COOKIE] } } : { status: 200 }
    );
    const client = clientWith(adapter);
    await client.post('/v1/sign_in', { computedData: 'x' });
    expect(client.getBrowserSession()?.cookie).toBe('eyJhbGciOiJIUzI1NiJ9.e30.sig');
    await client.post('/v1/purchase_v2', { computedData: 'y' });
    expect(sent[1].headers['Cookie']).toBe('gdex_session=eyJhbGciOiJIUzI1NiJ9.e30.sig');
  });

  it('drops the cookie on SESSION_INVALID', async () => {
    const { adapter } = recorder(() => ({ status: 401, data: { code: 'SESSION_INVALID', error: 'Please sign in again' } }));
    const client = clientWith(adapter);
    client.setBrowserSession('stale');
    await expect(client.post('/v1/purchase_v2', {})).rejects.toThrow('Please sign in again');
    expect(client.getBrowserSession()).toBeNull();
  });

  it('signs GET /v1/user so the backend verifier accepts it', async () => {
    const kp = generateGdexSessionKeyPair();
    const { adapter, sent } = recorder(() => ({ status: 200, data: { address: '0xabc', balance: 1 } }));
    const client = clientWith(adapter);
    client.setSessionSigningKey(kp.sessionPrivateKey);
    await client.get('/v1/user', { userId: '0xAbC', data: 'deadbeef', chainId: 42161, skip: undefined });

    const req = sent[0];
    expect(req.params).toBeUndefined();
    expect(req.url).toBe('/user?userId=0xAbC&data=deadbeef&chainId=42161');
    const nonce = req.headers['X-Gdex-Nonce'];
    expect(nonce).toMatch(/^\d{13}:[a-f0-9]{32}$/);
    const sig = req.headers['X-Gdex-Signature'];
    expect(sig).toMatch(/^[a-f0-9]{130}$/);

    // Rebuild the message the way the backend does from req.originalUrl.
    const message = browserRequestMessage('GET', new URL(`/v1${req.url}`, 'http://api.local'), null, nonce);
    const recovered = SigningKey.recoverPublicKey(
      keccak256(toUtf8Bytes(message)),
      Signature.from({ r: `0x${sig.slice(0, 64)}`, s: `0x${sig.slice(64, 128)}`, v: 27 + parseInt(sig.slice(128), 16) })
    );
    expect(SigningKey.computePublicKey(recovered, true)).toBe(kp.sessionKey);
  });

  it('does not sign routes the backend does not verify', async () => {
    const { adapter, sent } = recorder(() => ({ status: 200 }));
    const client = clientWith(adapter);
    client.setSessionSigningKey(generateGdexSessionKeyPair().sessionPrivateKey);
    await client.get('/v1/agents/hl/presets');
    await client.post('/v1/purchase_v2', { computedData: 'x' });
    expect(sent.every((s) => s.headers['X-Gdex-Signature'] === undefined)).toBe(true);
  });

  it('canonicalJson sorts keys recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}');
  });

  it('treats an expired Set-Cookie as cleared', () => {
    expect(sessionCookieFromHeaders(['gdex_session=; Path=/v1; Expires=Thu, 01 Jan 1970 00:00:00 GMT'])).toBeNull();
    expect(sessionCookieFromHeaders(['other=1'])).toBeUndefined();
  });
});
