/**
 * SDK initialization and shared utilities for MCP tools.
 * Creates a GdexSkill instance configured from environment variables.
 */
import { GdexSkill } from '@gemachdao/gdex-skill';

let _sdk: GdexSkill | null = null;

/**
 * Read an env var, treating empty values and unexpanded `${...}` placeholders as unset.
 * Some MCP clients (e.g. Codex installing the Claude Code plugin) pass the plugin's
 * `${user_config.*}` placeholder through literally instead of substituting the user's value.
 */
export function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value || /^\$\{[^}]*\}$/.test(value)) return undefined;
  return value;
}

export function getSdk(): GdexSkill {
  if (!_sdk) {
    const apiUrl = readEnv('GDEX_API_URL') || 'https://trade-api.gemach.io/v1';
    _sdk = new GdexSkill({ apiUrl });

    // Auto-login with API key from env if available
    const apiKey = readEnv('GDEX_API_KEY');
    if (apiKey) {
      _sdk.loginWithApiKey(apiKey);
    }
  }
  return _sdk;
}

/** Whether a failed call could have reached the backend and taken effect. */
export type SubmissionState = 'not_submitted' | 'rejected' | 'unknown';

/** Stable, sanitized error envelope returned (as JSON text) with `isError: true`. */
export interface ToolErrorEnvelope {
  error: {
    code: string;
    message: string;
    /** `unknown` means the request may have been accepted: reconcile, never resubmit blindly. */
    submission: SubmissionState;
    retryable: boolean;
    httpStatus?: number;
    field?: string;
    backendCode?: string | number;
    next: string;
  };
}

type ErrorLike = Error & {
  code?: unknown;
  field?: string;
  statusCode?: number;
  status?: number;
  responseBody?: Record<string, unknown>;
  retryAfter?: number;
};

/** Strip anything that looks like key material (64-hex keys, long hex blobs) from messages. */
function sanitize(text: string): string {
  return text.replace(/(0x)?[0-9a-fA-F]{64,}/g, '[redacted]');
}

/** Map an SDK/backend error to the envelope. Pre-flight validation never reached the backend. */
export function toErrorEnvelope(err: unknown): ToolErrorEnvelope {
  const e = (err instanceof Error ? err : new Error(String(err))) as ErrorLike;
  const message = sanitize(e.message || String(err));
  const code = typeof e.code === 'string' ? e.code : undefined;
  const base = { message };
  switch (e.name) {
    case 'GdexValidationError':
      return { error: { ...base, code: 'VALIDATION_ERROR', submission: 'not_submitted', retryable: false, field: e.field, next: 'Fix the input and call again.' } };
    case 'GdexSubmissionUnknownError':
      return { error: { ...base, code: 'SUBMISSION_UNKNOWN', submission: 'unknown', retryable: false, httpStatus: e.status, next: 'Do not resubmit. Check the operation first (trade status, usdc_get_pending_trades, usdc_get_funding_status, open orders or positions), then decide.' } };
    case 'GdexAuthError':
      return { error: { ...base, code: 'AUTH_FAILED', submission: 'rejected', retryable: true, httpStatus: e.statusCode ?? e.status, next: 'Sign in again (fresh session key), then repeat the call. Reconcile any earlier uncertain write first.' } };
    case 'GdexRateLimitError':
      return { error: { ...base, code: 'RATE_LIMITED', submission: 'rejected', retryable: true, httpStatus: 429, next: `Wait${e.retryAfter ? ` ${e.retryAfter}s` : ''} and call again.` } };
    case 'GdexApiError': {
      const body = e.responseBody ?? {};
      return { error: { ...base, code: e.statusCode === 404 ? 'NOT_FOUND' : 'API_ERROR', submission: 'rejected', retryable: false, httpStatus: e.statusCode, backendCode: body.code as string | number | undefined, next: 'The backend rejected the request; nothing was executed. Adjust the request using the message.' } };
    }
    case 'GdexNetworkError':
      return { error: { ...base, code: code ?? 'NETWORK_ERROR', submission: 'not_submitted', retryable: true, next: 'Network failure on a read; call again.' } };
    default:
      return { error: { ...base, code: code ?? 'ERROR', submission: 'not_submitted', retryable: false, next: 'The request failed before reaching GDEX; fix the cause in the message.' } };
  }
}

/**
 * Wraps an async handler: results become JSON text; failures become an MCP tool
 * error (`isError: true`) carrying a ToolErrorEnvelope. Stacks are only included
 * with GDEX_DEBUG=1.
 */
export async function handleToolCall<T>(
  fn: () => Promise<T>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: true }> {
  try {
    const result = await fn();
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    return { content: [{ type: 'text' as const, text }] };
  } catch (err: unknown) {
    const envelope = toErrorEnvelope(err);
    const debug = readEnv('GDEX_DEBUG') === '1' && err instanceof Error && err.stack ? `\n\n${sanitize(err.stack)}` : '';
    return {
      isError: true,
      content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) + debug }],
    };
  }
}
