/**
 * GdexApiClient — HTTP client for communicating with the Gbot backend API.
 *
 * Features:
 * - Configurable base URL and timeout
 * - Automatic retry on transient failures
 * - Auth session management (nonce → sign → token)
 * - Request/response interceptors for logging and error normalization
 */

import axios, { AxiosHeaders, AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import axiosRetry from 'axios-retry';
import { GdexSkillConfig, GdexErrorCode } from '../types';
import {
  GdexError,
  GdexAuthError,
  GdexApiError,
  GdexNetworkError,
  GdexRateLimitError,
} from '../utils/errors';
import { AuthCredentials, AuthSession, signEvmMessage, signSolanaMessage } from './auth';
import * as Endpoints from './endpoints';

/** Default SDK User-Agent — whitelisted by the backend */
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 GdexSkill/1.0.0';

/** Default API base URL */
const DEFAULT_API_URL = 'https://trade-api.gemach.io/v1';

/** Default request timeout (30s) */
const DEFAULT_TIMEOUT = 30_000;

/** Default max retries */
const DEFAULT_MAX_RETRIES = 3;

/**
 * Low-level HTTP client for the Gbot backend API.
 */
export class GdexApiClient {
  private readonly http: AxiosInstance;
  private readonly config: Required<GdexSkillConfig>;
  private session: AuthSession | null = null;
  private credentials: AuthCredentials | null = null;

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
    };

    this.http = axios.create({
      baseURL: this.config.apiUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': this.config.userAgent,
        ...(this.config.apiKey ? { 'X-API-Key': this.config.apiKey } : {}),
      },
    });

    // Configure automatic retry on transient errors
    axiosRetry(this.http, {
      retries: this.config.maxRetries,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (err) => {
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
        if (this.config.debug) {
          console.debug(`[GdexSkill] ← ${response.status} ${response.config.url}`);
        }
        return response;
      },
      async (error: unknown) => {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          const message: string =
            (error.response?.data as { message?: string })?.message ??
            error.message;

          if (status === 401 || status === 403) {
            // Try to refresh session once
            if (this.credentials && status === 401) {
              try {
                await this.authenticate(this.credentials);
                // Retry the original request
                if (error.config) {
                  if (this.session?.token) {
                    if (!error.config.headers) {
                      error.config.headers = new AxiosHeaders();
                    }
                    error.config.headers['Authorization'] = `Bearer ${this.session.token}`;
                  }
                  return this.http.request(error.config);
                }
              } catch {
                // Auth refresh failed — clear session
                this.session = null;
              }
            }
            return Promise.reject(new GdexAuthError(message, status));
          }

          if (status === 429) {
            const retryAfter = error.response?.headers['retry-after'];
            return Promise.reject(new GdexRateLimitError(message, retryAfter ? Number(retryAfter) : undefined));
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
   * Set credentials and authenticate with the backend via wallet signing.
   * The client will automatically re-authenticate on 401 responses.
   *
   * @param credentials - Wallet credentials for signing
   */
  async authenticate(credentials: AuthCredentials): Promise<AuthSession> {
    this.credentials = credentials;

    // 1. Get nonce from backend
    const nonceResp = await this.http.post<{ nonce: string }>(Endpoints.AUTH_NONCE, {
      address: credentials.address,
      type: credentials.type,
    });
    const { nonce } = nonceResp.data;

    // 2. Sign the nonce
    let signature: string;
    if (credentials.signer) {
      signature = await credentials.signer(nonce);
    } else if (credentials.privateKey) {
      if (credentials.type === 'evm') {
        signature = await signEvmMessage(credentials.privateKey, nonce);
      } else if (credentials.type === 'solana') {
        signature = await signSolanaMessage(credentials.privateKey, nonce);
      } else {
        throw new GdexAuthError(`Unsupported wallet type for automatic signing: ${credentials.type}`);
      }
    } else {
      throw new GdexAuthError(
        'Either privateKey or signer function must be provided in AuthCredentials'
      );
    }

    // 3. Exchange signature for session token
    const loginResp = await this.http.post<{ token: string; expiresAt: number }>(
      Endpoints.AUTH_LOGIN,
      {
        address: credentials.address,
        type: credentials.type,
        nonce,
        signature,
      }
    );

    this.session = {
      token: loginResp.data.token,
      expiresAt: loginResp.data.expiresAt,
      address: credentials.address,
      type: credentials.type,
    };

    return this.session;
  }

  /**
   * Clear the current auth session.
   */
  logout(): void {
    this.session = null;
    this.credentials = null;
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
