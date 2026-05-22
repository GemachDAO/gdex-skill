/**
 * Tests for social / community write actions.
 *
 * Verifies that `addComment` and `voteSentiment` post PLAIN JSON to the
 * backend with NO `computedData` key (they do not invoke
 * `serverDecryptData` in `ServiceMain`), while `changeWatchList` and
 * `importToken` DO go through managed custody and post
 * `{ computedData, chainId? }` matching the ABI decoded by
 * `serverDecryptData`.
 */
import { GdexApiClient } from '../../src/client';
import {
  addComment,
  voteSentiment,
  changeWatchList,
  importToken,
} from '../../src/actions/social';
import {
  decryptGdexComputedData,
  generateGdexSessionKeyPair,
} from '../../src/utils/gdexManagedCrypto';
import { AbiCoder } from 'ethers';

jest.mock('../../src/client');
const MockedClient = GdexApiClient as jest.MockedClass<typeof GdexApiClient>;

const apiKey = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';

describe('social writes', () => {
  let client: jest.Mocked<GdexApiClient>;

  beforeEach(() => {
    client = new MockedClient() as jest.Mocked<GdexApiClient>;
    client.post = jest.fn().mockResolvedValue({ ok: true });
  });

  describe('plain JSON (no computedData)', () => {
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
  });

  describe('managed-custody (computedData)', () => {
    it('changeWatchList structured request posts computedData that decodes to [tokenAddress, chainId, isAdded, nonce]', async () => {
      const pair = generateGdexSessionKeyPair();
      await changeWatchList(client, {
        tokenAddress: '0xToken',
        chainId: 1,
        action: 'add',
        managed: {
          apiKey,
          walletAddress: '0xUser',
          sessionPrivateKey: pair.sessionPrivateKey,
          userId: '0xUser',
          nonce: 'n-1',
        },
      });
      const [path, body] = (client.post as jest.Mock).mock.calls[0];
      expect(path).toBe('/v1/change_watch_list');
      const wire = body as Record<string, unknown>;
      expect(wire).toHaveProperty('computedData');
      expect(wire.chainId).toBe(1);
      // Should NOT leak the raw managed signing inputs to the wire.
      expect(wire).not.toHaveProperty('managed');
      expect(wire).not.toHaveProperty('tokenAddress');

      const decrypted = decryptGdexComputedData(wire.computedData as string, apiKey);
      const parsed = JSON.parse(decrypted) as { userId: string; data: string; signature: string };
      expect(parsed.userId).toBe('0xUser');
      expect(parsed.signature).toMatch(/^[0-9a-f]{130}$/i);
      const abi = AbiCoder.defaultAbiCoder();
      const [tokenAddress, chainId, isAdded, nonce] = abi.decode(
        ['string', 'string', 'bool', 'string'],
        '0x' + parsed.data,
      );
      expect(tokenAddress).toBe('0xToken');
      expect(chainId).toBe('1');
      expect(isAdded).toBe(true);
      expect(nonce).toBe('n-1');
    });

    it('changeWatchList raw request forwards pre-built computedData unchanged', async () => {
      await changeWatchList(client, { computedData: 'deadbeef', chainId: 56 });
      const [path, body] = (client.post as jest.Mock).mock.calls[0];
      expect(path).toBe('/v1/change_watch_list');
      expect(body).toEqual({ computedData: 'deadbeef', chainId: 56 });
    });

    it('importToken structured request posts computedData that decodes to [tokenAddress, chainId, nonce]', async () => {
      const pair = generateGdexSessionKeyPair();
      await importToken(client, {
        tokenAddress: '0xToken',
        chainId: 8453,
        managed: {
          apiKey,
          walletAddress: '0xUser',
          sessionPrivateKey: pair.sessionPrivateKey,
          userId: '0xUser',
          nonce: 'n-2',
        },
      });
      const [path, body] = (client.post as jest.Mock).mock.calls[0];
      expect(path).toBe('/v1/import_token');
      const wire = body as Record<string, unknown>;
      expect(wire).toHaveProperty('computedData');
      expect(wire.chainId).toBe(8453);
      expect(wire).not.toHaveProperty('managed');
      expect(wire).not.toHaveProperty('tokenAddress');

      const decrypted = decryptGdexComputedData(wire.computedData as string, apiKey);
      const parsed = JSON.parse(decrypted) as { userId: string; data: string; signature: string };
      expect(parsed.userId).toBe('0xUser');
      expect(parsed.signature).toMatch(/^[0-9a-f]{130}$/i);
      const abi = AbiCoder.defaultAbiCoder();
      const [tokenAddress, chainId, nonce] = abi.decode(
        ['string', 'string', 'string'],
        '0x' + parsed.data,
      );
      expect(tokenAddress).toBe('0xToken');
      expect(chainId).toBe('8453');
      expect(nonce).toBe('n-2');
    });

    it('importToken raw request forwards pre-built computedData unchanged', async () => {
      await importToken(client, { computedData: 'cafebabe' });
      const [path, body] = (client.post as jest.Mock).mock.calls[0];
      expect(path).toBe('/v1/import_token');
      expect(body).toEqual({ computedData: 'cafebabe' });
    });
  });
});
