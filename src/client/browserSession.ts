/**
 * Client half of the backend's browser-session contract (backend PR #382,
 * `src/api/middleware/browserSession.ts` + `signedBrowserRequest.ts`).
 *
 * Since 2026-10-28 every login, write and credential-bearing read must carry
 * `X-Gdex-Client: web` and an allow-listed `Origin`, or it is refused with
 * 403 SESSION_ORIGIN_DENIED. A successful login sets the HttpOnly
 * `gdex_session` cookie, which every later private call must send back; it is
 * bound to the session key, idles out after 30 minutes and expires after 8 hours.
 * `GET /v1/user` and private `/v1/agents/*` routes additionally need a nonce
 * signed with the session private key.
 */

import { randomBytes } from 'crypto';
import { SigningKey, keccak256, toUtf8Bytes } from 'ethers';

export const SESSION_COOKIE = 'gdex_session';

/** Origin the backend allow-lists (`src/api/utils/corsOrigin.ts`). */
export const DEFAULT_CLIENT_ORIGIN = 'https://gdex.pro';

/** Session cookie as returned by login; persist it next to the session key. */
export interface BrowserSessionState {
  /** Raw `gdex_session` cookie value (a JWT). Secret: treat like the session key. */
  cookie: string;
  /** Absolute expiry in ms, when the server reported one. */
  expiresAt?: number;
}

/** Canonical JSON: object keys sorted recursively, as the backend verifies it. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function browserRequestMessage(method: string, url: URL, body: unknown, nonce: string): string {
  const query: Record<string, string> = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (Object.prototype.hasOwnProperty.call(query, key)) throw new Error('Duplicate query parameter');
    query[key] = value;
  }
  return ['gdex-request-v1', method.toUpperCase(), url.pathname,
    canonicalJson({ query, body: body ?? null }), nonce].join('\n');
}

export function browserRequestNonce(now = Date.now()): string {
  return `${now}:${randomBytes(16).toString('hex')}`;
}

/** Raw keccak256/secp256k1 signature, 130 hex chars r+s+v without 0x. */
export function signBrowserRequest(message: string, sessionPrivateKey: string): string {
  const sig = new SigningKey(sessionPrivateKey).sign(keccak256(toUtf8Bytes(message)));
  return `${sig.r.slice(2)}${sig.s.slice(2)}${sig.yParity.toString(16).padStart(2, '0')}`;
}

/** Routes that verify a signed nonce on top of the session cookie. */
export function requiresSignedRequest(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '').toLowerCase();
  return path === '/v1/user' || (path.startsWith('/v1/agents/') && path !== '/v1/agents/hl/presets');
}

/**
 * Read `gdex_session` from Set-Cookie headers. Returns `null` when the server
 * cleared it, `undefined` when it was not mentioned.
 */
export function sessionCookieFromHeaders(setCookie: unknown): BrowserSessionState | null | undefined {
  const lines = Array.isArray(setCookie) ? setCookie : typeof setCookie === 'string' ? [setCookie] : [];
  for (const line of lines as string[]) {
    const [pair, ...attrs] = line.split(';').map((s) => s.trim());
    if (!pair.startsWith(`${SESSION_COOKIE}=`)) continue;
    const cookie = pair.slice(SESSION_COOKIE.length + 1);
    let expiresAt: number | undefined;
    for (const attr of attrs) {
      const [k, v] = attr.split('=');
      if (k.toLowerCase() === 'max-age') expiresAt = Date.now() + Number(v) * 1000;
      else if (k.toLowerCase() === 'expires' && expiresAt === undefined) expiresAt = Date.parse(v);
    }
    if (!cookie || (expiresAt !== undefined && expiresAt <= Date.now())) return null;
    return { cookie, expiresAt };
  }
  return undefined;
}
