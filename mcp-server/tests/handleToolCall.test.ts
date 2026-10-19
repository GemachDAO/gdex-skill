/**
 * The real handleToolCall (not a per-file mock): MCP error flag and envelope.
 */
import { describe, it, expect } from '@jest/globals';
import { handleToolCall, toErrorEnvelope } from '../src/sdk.js';
import {
  GdexValidationError,
  GdexApiError,
  GdexAuthError,
  GdexSubmissionUnknownError,
} from '@gemachdao/gdex-skill';

const parse = (r: any) => JSON.parse(r.content[0].text);

describe('handleToolCall', () => {
  it('returns JSON text without isError on success', async () => {
    const r = await handleToolCall(async () => ({ ok: 1 }));
    expect(r.isError).toBeUndefined();
    expect(parse(r)).toEqual({ ok: 1 });
  });

  it('marks failures isError with a stable envelope and no stack', async () => {
    const r = await handleToolCall(async () => { throw new GdexValidationError('Invalid amount: 1abc', 'amount'); });
    expect(r.isError).toBe(true);
    const env = parse(r);
    expect(env.error).toMatchObject({ code: 'VALIDATION_ERROR', submission: 'not_submitted', retryable: false, field: 'amount' });
    expect(r.content[0].text).not.toMatch(/Stack|at .*\.js:\d+/);
  });

  it('reports an ambiguous write as submission unknown', () => {
    const env = toErrorEnvelope(new GdexSubmissionUnknownError('POST /purchase_v2 outcome unknown (503)', 'POST', '/purchase_v2', 503));
    expect(env.error).toMatchObject({ code: 'SUBMISSION_UNKNOWN', submission: 'unknown', retryable: false, httpStatus: 503 });
    expect(env.error.next).toMatch(/Do not resubmit/);
  });

  it('maps backend rejections and auth failures', () => {
    expect(toErrorEnvelope(new GdexApiError('missing params (code 101)', 400, { code: 101 })).error)
      .toMatchObject({ code: 'API_ERROR', submission: 'rejected', httpStatus: 400, backendCode: 101 });
    expect(toErrorEnvelope(new GdexAuthError('Unauthorized', 401)).error)
      .toMatchObject({ code: 'AUTH_FAILED', submission: 'rejected', retryable: true });
  });

  it('redacts key-like hex from messages', () => {
    const key = '0x' + 'ab'.repeat(32);
    expect(toErrorEnvelope(new Error(`bad key ${key}`)).error.message).toBe('bad key [redacted]');
  });
});
