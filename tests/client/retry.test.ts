/**
 * Write-safety of the HTTP client: signed writes are never resent automatically,
 * and an ambiguous write failure is reported as SUBMISSION_UNKNOWN.
 */
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { GdexApiClient } from '../../src/client';
import { GdexApiError, GdexSubmissionUnknownError } from '../../src/utils/errors';
import { GdexErrorCode } from '../../src/types/common';

function scripted(responses: Array<{ status: number; data?: unknown } | 'network'>) {
  const calls: string[] = [];
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    calls.push(`${config.method?.toUpperCase()} ${config.url}`);
    const next = responses.shift() ?? { status: 200, data: { ok: true } };
    if (next === 'network') {
      const err = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET', config, isAxiosError: true, toJSON: () => ({}) });
      throw err;
    }
    const response = { data: next.data ?? {}, status: next.status, statusText: '', headers: {}, config };
    if (next.status >= 400) {
      const err = Object.assign(new Error(`Request failed with status code ${next.status}`), {
        config, response, isAxiosError: true, toJSON: () => ({}),
      });
      throw err;
    }
    return response;
  };
  return { adapter, calls };
}

function clientWith(adapter: AxiosAdapter): GdexApiClient {
  const client = new GdexApiClient({ apiUrl: 'https://api.test/v1', maxRetries: 3 } as never);
  (client as unknown as { http: { defaults: { adapter: AxiosAdapter } } }).http.defaults.adapter = adapter;
  return client;
}

describe('GdexApiClient write safety', () => {
  it('does not resend a POST after a 503; reports SUBMISSION_UNKNOWN', async () => {
    const { adapter, calls } = scripted([{ status: 503 }, { status: 200, data: { requestId: 'r1' } }]);
    const client = clientWith(adapter);
    const err = (await client.post('/v1/purchase_v2', { computedData: 'x' }).catch((e) => e)) as GdexSubmissionUnknownError;
    expect(calls).toEqual(['POST /purchase_v2']);
    expect(err).toBeInstanceOf(GdexSubmissionUnknownError);
    expect(err.code).toBe(GdexErrorCode.SUBMISSION_UNKNOWN);
    expect(err.status).toBe(503);
  });

  it('does not resend a POST after a network error', async () => {
    const { adapter, calls } = scripted(['network', { status: 200 }]);
    const err = await clientWith(adapter).post('/v1/usdc/trade/purchase_v2', {}).catch((e) => e);
    expect(calls).toHaveLength(1);
    expect(err).toBeInstanceOf(GdexSubmissionUnknownError);
  });

  it('does not resend a POST after a 429 (definite rejection, not unknown)', async () => {
    const { adapter, calls } = scripted([{ status: 429 }, { status: 200 }]);
    const err = await clientWith(adapter).post('/v1/hl/create_order', {}).catch((e) => e);
    expect(calls).toHaveLength(1);
    expect(err).not.toBeInstanceOf(GdexSubmissionUnknownError);
  });

  it('a 4xx on a write is a definite API error', async () => {
    const { adapter } = scripted([{ status: 400, data: { error: 'missing params', code: 101 } }]);
    const err = await clientWith(adapter).post('/v1/purchase_v2', {}).catch((e) => e);
    expect(err).toBeInstanceOf(GdexApiError);
    expect(err).not.toBeInstanceOf(GdexSubmissionUnknownError);
  });

  it('still retries a GET after a 503', async () => {
    const { adapter, calls } = scripted([{ status: 503 }, { status: 200, data: { ok: true } }]);
    const res = await clientWith(adapter).get('/v1/portfolio');
    expect(res).toEqual({ ok: true });
    expect(calls).toEqual(['GET /portfolio', 'GET /portfolio']);
  }, 20000);
});
