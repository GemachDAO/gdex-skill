/**
 * GdexApiClient — HTTP client for communicating with the Gbot backend API.
 *
 * Features:
 * - Configurable base URL and timeout
 * - Automatic retry on transient failures
 * - Auth session management (nonce → sign → token)
 * - Request/response interceptors for logging and error normalization
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import axiosRetry from 'axios-retry';
import { GdexSkillConfig, GdexErrorCode } from '../types';
import {
  GdexError,
  GdexAuthError,
  GdexApiError,
  GdexNetworkError,
  GdexRateLimitError,
  GdexSubmissionUnknownError,
} from '../utils/errors';
import { AuthCredentials, AuthSession } from './auth';
import * as Endpoints from './endpoints';
import {
  BrowserSessionState,
  DEFAULT_CLIENT_ORIGIN,
  SESSION_COOKIE,
  browserRequestMessage,
  browserRequestNonce,
  requiresSignedRequest,
  sessionCookieFromHeaders,
  signBrowserRequest,
} from './browserSession';

/** Default SDK User-Agent — must match browser UA to pass Cloudflare / backend validation */
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

/** Default API base URL */
const DEFAULT_API_URL = 'https://trade-api.gemach.io/v1';

/** Default request timeout (30s) */
const DEFAULT_TIMEOUT = 30_000;

/** Default max retries */
const DEFAULT_MAX_RETRIES = 3;

/** Methods that are safe to resend automatically. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isSafeMethod(method: string | undefined): boolean {
  return SAFE_METHODS.has((method ?? 'get').toUpperCase());
}

/**
 * Low-level HTTP client for the Gbot backend API.
 */
export class GdexApiClient {
  private readonly http: AxiosInstance;
  private readonly config: Required<GdexSkillConfig>;
  private session: AuthSession | null = null;
  private credentials: AuthCredentials | null = null;
  private browserSession: BrowserSessionState | null = null;
  private sessionSigningKey: string | null = null;

  /**
   * Normalize endpoint path so users can configure apiUrl with or without `/v1`.
   */
  private normalizeEndpoint(endpoint: string): string {
    const basePath = (() => {
      try {
        return new URL(this.config.apiUrl).pathname.replace(/\/+$/, '');
      } catch {
        return '';
      }
    })();

    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

    if (basePath.endsWith('/v1') && normalizedEndpoint.startsWith('/v1/')) {
      return normalizedEndpoint.slice(3);
    }

    return normalizedEndpoint;
  }

  constructor(config: GdexSkillConfig = {}) {
    this.config = {
      apiUrl: config.apiUrl ?? DEFAULT_API_URL,
      apiKey: config.apiKey ?? '',
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      debug: config.debug ?? false,
      userAgent: config.userAgent ?? DEFAULT_USER_AGENT,
      origin: config.origin ?? DEFAULT_CLIENT_ORIGIN,
    };

    this.http = axios.create({
      baseURL: this.config.apiUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': this.config.userAgent,
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        // Required on every login, write and private read since backend PR #382.
        'Origin': this.config.origin,
        'Referer': `${this.config.origin}/`,
        'X-Gdex-Client': 'web',
        ...(this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {}),
      },
    });

    // Configure automatic retry on transient errors. Only safe reads are retried:
    // resending a signed write after a timeout or 503 could execute it twice.
    axiosRetry(this.http, {
      retries: this.config.maxRetries,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (err) => {
        if (!isSafeMethod(err.config?.method)) return false;
        return (
          axiosRetry.isNetworkOrIdempotentRequestError(err) ||
          err.response?.status === 429 ||
          err.response?.status === 503
        );
      },
    });

    // Request interceptor — attach auth token
    this.http.interceptors.request.use(
      (reqConfig: InternalAxiosRequestConfig) => {
        if (this.session?.token) {
          reqConfig.headers['Authorization'] = `Bearer ${this.session.token}`;
        }
        if (this.browserSession) {
          reqConfig.headers['Cookie'] = `${SESSION_COOKIE}=${this.browserSession.cookie}`;
        }
        this.signIfRequired(reqConfig);
        if (this.config.debug) {
          console.debug(`[GdexSkill] → ${reqConfig.method?.toUpperCase()} ${reqConfig.url}`);
        }
        return reqConfig;
      },
      (error: unknown) => Promise.reject(error)
    );

    // Response interceptor — normalize errors
    this.http.interceptors.response.use(
      (response: AxiosResponse) => {
        this.captureSessionCookie(response.headers?.['set-cookie']);
        if (this.config.debug) {
          console.debug(`[GdexSkill] ← ${response.status} ${response.config.url}`);
        }
        return response;
      },
      async (error: unknown) => {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          const body = error.response?.data as
            | { message?: string; error?: string; code?: number }
            | undefined;
          // Backend errors use `error` (and sometimes `code`); fall back to axios's
          // generic message only when neither is present.
          const detail = body?.message ?? body?.error ?? error.message;
          const message: string =
            body?.code !== undefined ? `${detail} (code ${body.code})` : detail;

          this.captureSessionCookie(error.response?.headers?.['set-cookie']);
          if (status === 401 && (body?.code as unknown) === 'SESSION_INVALID') {
            this.browserSession = null;
          }

          if (status === 401 || status === 403) {
            // No automatic re-auth on v1.1.0 — wallet-signing nonce/login is gone.
            // Clear stale session so callers re-authenticate via setApiKey /
            // oauthLogin / managed sign-in.
            if (status === 401) this.session = null;
            return Promise.reject(new GdexAuthError(message, status));
          }

          if (status === 429) {
            const retryAfter = error.response?.headers['retry-after'];
            return Promise.reject(new GdexRateLimitError(message, retryAfter ? Number(retryAfter) : undefined));
          }

          // A write with no definite answer may already be executing.
          const method = (error.config?.method ?? 'get').toUpperCase();
          if (!isSafeMethod(method) && (status === undefined || status >= 500)) {
            return Promise.reject(
              new GdexSubmissionUnknownError(
                `${method} ${error.config?.url ?? ''} outcome unknown (${status ?? error.code ?? 'no response'}): ${message}. ` +
                  'It may have been accepted; check its status before retrying.',
                method,
                error.config?.url ?? '',
                status
              )
            );
          }

          if (status !== undefined) {
            return Promise.reject(
              new GdexApiError(message, status, error.response?.data as Record<string, unknown>)
            );
          }

          if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            return Promise.reject(new GdexNetworkError(`Request timed out: ${message}`, GdexErrorCode.TIMEOUT));
          }

          return Promise.reject(new GdexNetworkError(message, GdexErrorCode.NETWORK_ERROR));
        }

        return Promise.reject(
          new GdexError(String(error), GdexErrorCode.UNKNOWN)
        );
      }
    );
  }

  // ── Auth ────────────────────────────────────────────────────────────────────

  /**
   * Authenticate using a pre-configured API key.
   *
   * This is the simplest way for AI agents to authenticate — pass one of the
   * shared API keys and the SDK will use it as a Bearer token for all requests.
   *
   * @param apiKey - API key (use one of the GDEX_API_KEYS constants)
   */
  loginWithApiKey(apiKey: string): void {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new GdexAuthError('apiKey must be a non-empty string');
    }
    // Validate UUID format (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(apiKey)) {
      throw new GdexAuthError('apiKey must be a valid UUID format (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)');
    }
    // Store as a synthetic session that never expires
    this.session = {
      token: apiKey,
      expiresAt: Number.MAX_SAFE_INTEGER,
      address: 'api-key-auth',
      type: 'evm',
    };
  }

  /**
   * Authenticate with the backend.
   *
   * @deprecated The wallet-signing nonce/login flow (`/v1/auth/nonce`,
   * `/v1/auth/login`) does not exist on backend v1.1.0. Use one of the
   * supported flows instead:
   *   - API key:        `client.setApiKey(apiKey)`
   *   - Google OAuth:   `oauthLogin(client, { idToken })`
   *   - Managed sign-in: `POST /v1/sign_in` via `buildGdexSignInComputedData`
   *
   * This method is preserved for binary compatibility but always throws.
   *
   * @param credentials - Wallet credentials (unused, kept for signature compat)
   */
  async authenticate(_credentials: AuthCredentials): Promise<AuthSession> {
    throw new GdexAuthError(
      'GdexApiClient.authenticate() is no longer supported — the backend ' +
        'removed the /v1/auth/nonce + /v1/auth/login wallet-signing endpoints ' +
        'in v1.1.0. Use setApiKey(apiKey), oauthLogin({ idToken }), or the ' +
        'managed-custody /v1/sign_in flow (buildGdexSignInComputedData) instead.',
    );
  }

  /**
   * Clear the current auth session.
   */
  logout(): void {
    this.session = null;
    this.credentials = null;
    this.browserSession = null;
    this.sessionSigningKey = null;
  }

  // ── Browser session (backend PR #382) ───────────────────────────────────────

  /**
   * Current `gdex_session` cookie, captured automatically from the last login.
   * Persist it with the session key so another process can reuse the session;
   * it idles out after 30 minutes unused and expires 8 hours after login.
   */
  getBrowserSession(): BrowserSessionState | null {
    return this.browserSession;
  }

  /** Restore a cookie saved by `getBrowserSession()`; `null` clears it. */
  setBrowserSession(state: BrowserSessionState | string | null): void {
    this.browserSession = typeof state === 'string' ? { cookie: state } : state;
  }

  /**
   * Session private key used to sign `GET /v1/user` and private `/v1/agents/*`
   * requests. It never leaves this process.
   */
  setSessionSigningKey(sessionPrivateKey: string | null): void {
    this.sessionSigningKey = sessionPrivateKey;
  }

  private captureSessionCookie(setCookie: unknown): void {
    const found = sessionCookieFromHeaders(setCookie);
    if (found !== undefined) this.browserSession = found;
  }

  /**
   * Add `X-Gdex-Nonce`/`X-Gdex-Signature`. Query params are folded into the
   * URL first so the bytes on the wire are exactly the ones signed.
   */
  private signIfRequired(reqConfig: InternalAxiosRequestConfig): void {
    const base = (reqConfig.baseURL ?? this.config.apiUrl).replace(/\/+$/, '');
    const url = new URL(`${base}${reqConfig.url ?? ''}`);
    if (!requiresSignedRequest(url.pathname) || !this.sessionSigningKey) return;
    for (const [key, value] of Object.entries((reqConfig.params ?? {}) as Record<string, unknown>)) {
      if (value !== undefined && value !== null) url.searchParams.append(key, String(value));
    }
    reqConfig.params = undefined;
    reqConfig.url = `${url.pathname.slice(new URL(base).pathname.length)}${url.search}`;
    const method = (reqConfig.method ?? 'get').toUpperCase();
    const body = isSafeMethod(method) || reqConfig.data === undefined
      ? null
      : JSON.parse(JSON.stringify(reqConfig.data));
    const nonce = browserRequestNonce();
    reqConfig.headers['X-Gdex-Nonce'] = nonce;
    reqConfig.headers['X-Gdex-Signature'] = signBrowserRequest(
      browserRequestMessage(method, url, body, nonce),
      this.sessionSigningKey
    );
  }

  /**
   * Get the current auth session (or null if not authenticated).
   */
  getSession(): AuthSession | null {
    return this.session;
  }

  /**
   * Check whether the client has a valid (non-expired) session.
   */
  isAuthenticated(): boolean {
    if (!this.session) return false;
    // Consider expired if within 60s of expiry
    return Date.now() < this.session.expiresAt - 60_000;
  }

  // ── HTTP Helpers ────────────────────────────────────────────────────────────

  /**
   * Perform a GET request.
   */
  async get<T = unknown>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    const resp = await this.http.get<T>(this.normalizeEndpoint(endpoint), { params });
    return resp.data;
  }

  /**
   * Perform a POST request.
   */
  async post<T = unknown>(endpoint: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const resp = await this.http.post<T>(this.normalizeEndpoint(endpoint), data, config);
    return resp.data;
  }

  /**
   * Perform a PUT request.
   */
  async put<T = unknown>(endpoint: string, data?: unknown): Promise<T> {
    const resp = await this.http.put<T>(this.normalizeEndpoint(endpoint), data);
    return resp.data;
  }

  /**
   * Perform a DELETE request.
   */
  async delete<T = unknown>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    const resp = await this.http.delete<T>(this.normalizeEndpoint(endpoint), { params });
    return resp.data;
  }

  /**
   * Perform a PATCH request.
   */
  async patch<T = unknown>(endpoint: string, data?: unknown): Promise<T> {
    const resp = await this.http.patch<T>(this.normalizeEndpoint(endpoint), data);
    return resp.data;
  }

  /**
   * Get the configured base URL.
   */
  getBaseUrl(): string {
    return this.config.apiUrl;
  }
}
