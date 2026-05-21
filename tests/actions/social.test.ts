/**
 * Tests for social / community write actions.
 *
 * Verifies that `addComment`, `voteSentiment`, `changeWatchList`, and
 * `importToken` post PLAIN JSON to the backend with NO `computedData` key.
 *
 * Backend (`ServiceMain`, v1.1.0) does not call `serverDecryptData` on any of
 * these endpoints — they rely on the standard session header for auth.
 */
import { GdexApiClient } from '../../src/client';
import {
  addComment,
  voteSentiment,
  changeWatchList,
  importToken,
} from '../../src/actions/social';

jest.mock('../../src/client');
const MockedClient = GdexApiClient as jest.MockedClass<typeof GdexApiClient>;

describe('social writes — plain JSON (no computedData)', () => {
  let client: jest.Mocked<GdexApiClient>;

  beforeEach(() => {
    client = new MockedClient() as jest.Mocked<GdexApiClient>;
    client.post = jest.fn().mockResolvedValue({ ok: true });
  });

  it('addComment POST body has no computedData key', async () => {
    await addComment(client, {
      tokenAddress: '0xToken',
      chain: 1,
      message: 'hello',
      userId: '0xUser',
    });
    expect(client.post).toHaveBeenCalledTimes(1);
    const [path, body] = (client.post as jest.Mock).mock.calls[0];
    expect(path).toBe('/v1/add_comment');
    expect(body as Record<string, unknown>).not.toHaveProperty('computedData');
  });

  it('voteSentiment POST body has no computedData key', async () => {
    await voteSentiment(client, {
      tokenAddress: '0xToken',
      chain: 1,
      sentiment: 'bullish',
      userId: '0xUser',
    });
    const [path, body] = (client.post as jest.Mock).mock.calls[0];
    expect(path).toBe('/v1/vote_sentiment');
    expect(body as Record<string, unknown>).not.toHaveProperty('computedData');
  });

  it('changeWatchList POST body has no computedData key', async () => {
    await changeWatchList(client, {
      tokenAddress: '0xToken',
      chain: 1,
      action: 'add',
      userId: '0xUser',
    });
    const [path, body] = (client.post as jest.Mock).mock.calls[0];
    expect(path).toBe('/v1/change_watch_list');
    expect(body as Record<string, unknown>).not.toHaveProperty('computedData');
  });

  it('importToken POST body has no computedData key', async () => {
    await importToken(client, {
      tokenAddress: '0xToken',
      chain: 1,
      symbol: 'TKN',
      userId: '0xUser',
    });
    const [path, body] = (client.post as jest.Mock).mock.calls[0];
    expect(path).toBe('/v1/import_token');
    expect(body as Record<string, unknown>).not.toHaveProperty('computedData');
  });
});
