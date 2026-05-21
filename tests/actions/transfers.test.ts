/**
 * Tests for transfer actions.
 *
 * Verifies that both `transferNative` and `transferToken` accept either
 *   - a raw `{ computedData, chainId? }` payload, or
 *   - a structured `{ recipient, amount, managed: {...}, chainId? }` payload
 * and that the wire body sent to the backend always contains exactly
 * `{ computedData, chainId? }` (no leakage of structured-form fields).
 */
import { GdexApiClient } from '../../src/client';
import { transferNative, transferToken } from '../../src/actions/transfers';
import { GdexValidationError } from '../../src/utils/errors';
import {
  decryptGdexComputedData,
  generateGdexSessionKeyPair,
} from '../../src/utils/gdexManagedCrypto';
import { AbiCoder } from 'ethers';

jest.mock('../../src/client');
const MockedClient = GdexApiClient as jest.MockedClass<typeof GdexApiClient>;

const apiKey = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';

describe('transfers', () => {
  let client: jest.Mocked<GdexApiClient>;

  beforeEach(() => {
    client = new MockedClient() as jest.Mocked<GdexApiClient>;
    client.post = jest.fn().mockResolvedValue({ status: 'pending', requestId: 'r1' });
  });

  // ── raw shape ─────────────────────────────────────────────────────────────

  describe('raw {computedData} shape', () => {
    it('transferNative posts exactly {computedData} to /v1/transfer', async () => {
      await transferNative(client, { computedData: 'deadbeef' });
      expect(client.post).toHaveBeenCalledWith('/v1/transfer', { computedData: 'deadbeef' });
    });

    it('transferToken posts exactly {computedData, chainId} to /v1/transfer_token', async () => {
      await transferToken(client, { computedData: 'cafe', chainId: 1 });
      expect(client.post).toHaveBeenCalledWith('/v1/transfer_token', {
        computedData: 'cafe',
        chainId: 1,
      });
    });

    it('throws GdexValidationError when computedData is missing from raw shape', async () => {
      await expect(
        // @ts-expect-error — intentionally invalid for runtime validation
        transferNative(client, {}),
      ).rejects.toBeInstanceOf(GdexValidationError);
      expect(client.post).not.toHaveBeenCalled();
    });
  });

  // ── structured shape ──────────────────────────────────────────────────────

  describe('structured {recipient, amount, managed} shape', () => {
    const pair = generateGdexSessionKeyPair();
    const managed = {
      apiKey,
      walletAddress: '0xAbCd',
      sessionPrivateKey: pair.sessionPrivateKey,
      userId: '0xAbCd',
      nonce: 'n-1',
    };

    it('transferNative builds computedData internally and posts only {computedData} on the wire', async () => {
      await transferNative(client, {
        recipient: '0xRecipient',
        amount: '1000000',
        managed,
      });

      expect(client.post).toHaveBeenCalledTimes(1);
      const [path, body] = (client.post as jest.Mock).mock.calls[0];
      expect(path).toBe('/v1/transfer');

      const bodyObj = body as Record<string, unknown>;
      expect(Object.keys(bodyObj).sort()).toEqual(['computedData']);
      expect(typeof bodyObj.computedData).toBe('string');
      expect(bodyObj.computedData).toMatch(/^[0-9a-f]+$/);

      // Round-trip decode the computedData
      const parsed = JSON.parse(
        decryptGdexComputedData(bodyObj.computedData as string, apiKey),
      ) as { userId: string; data: string; signature: string };
      expect(parsed.userId).toBe('0xAbCd');
      const [recipient, amount, nonce] = AbiCoder.defaultAbiCoder().decode(
        ['string', 'string', 'string'],
        '0x' + parsed.data,
      );
      expect(recipient).toBe('0xRecipient');
      expect(amount).toBe('1000000');
      expect(nonce).toBe('n-1');
    });

    it('transferToken structured form passes chainId through but does not leak recipient/amount/managed', async () => {
      await transferToken(client, {
        recipient: '0xRecipient',
        amount: '42',
        managed,
        chainId: '622112261',
      });

      const [path, body] = (client.post as jest.Mock).mock.calls[0];
      expect(path).toBe('/v1/transfer_token');

      const bodyObj = body as Record<string, unknown>;
      expect(Object.keys(bodyObj).sort()).toEqual(['chainId', 'computedData']);
      expect(bodyObj.chainId).toBe('622112261');
      expect(bodyObj).not.toHaveProperty('recipient');
      expect(bodyObj).not.toHaveProperty('amount');
      expect(bodyObj).not.toHaveProperty('managed');
    });

    it('validates required managed fields', async () => {
      await expect(
        transferNative(client, {
          recipient: '0xR',
          amount: '1',
          managed: { apiKey, walletAddress: '0x', sessionPrivateKey: '0x', userId: '' },
        }),
      ).rejects.toBeInstanceOf(GdexValidationError);
      expect(client.post).not.toHaveBeenCalled();
    });
  });
});
