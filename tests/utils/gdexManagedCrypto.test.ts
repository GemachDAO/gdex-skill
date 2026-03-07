/**
 * Tests for managed-custody crypto helpers.
 */
import {
  buildEncryptedGdexPayload,
  buildGdexManagedTradeComputedData,
  buildGdexSignInComputedData,
  buildGdexSignInMessage,
  buildGdexTradeSignatureMessage,
  buildGdexUserSessionData,
  decryptGdexComputedData,
  encryptGdexComputedData,
  generateGdexSessionKeyPair,
  signGdexTradeMessageWithSessionKey,
} from '../../src/utils/gdexManagedCrypto';

describe('gdexManagedCrypto', () => {
  const apiKey = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';

  it('should roundtrip encrypt/decrypt payload text', () => {
    const plaintext = JSON.stringify({ hello: 'world' });
    const encrypted = encryptGdexComputedData(plaintext, apiKey);
    expect(encrypted).toMatch(/^[0-9a-f]+$/);

    const decrypted = decryptGdexComputedData(encrypted, apiKey);
    expect(decrypted).toBe(plaintext);
  });

  it('should generate a valid session keypair', () => {
    const pair = generateGdexSessionKeyPair();
    expect(pair.sessionPrivateKey).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(pair.sessionKey).toMatch(/^0x[0-9a-f]{66}$/i);
  });

  it('should build expected sign-in message format', () => {
    const msg = buildGdexSignInMessage('0xAbCd', '12345', '0x02aa');
    expect(msg).toContain('By signing, you agree to GDEX Trading Terms of Use and Privacy Policy.');
    expect(msg).toContain('0xabcd 12345 02aa');
  });

  it('should sign trade messages with 130-char hex signature', () => {
    const pair = generateGdexSessionKeyPair();
    const sig = signGdexTradeMessageWithSessionKey(
      'purchase',
      '0xabc',
      '0x1234',
      pair.sessionPrivateKey
    );
    expect(sig).toMatch(/^[0-9a-f]{130}$/i);
  });

  it('should build encrypted /v1/user data from session key', () => {
    const sessionKey = '0x02' + '11'.repeat(32);
    const data = buildGdexUserSessionData(sessionKey, apiKey);
    const decrypted = decryptGdexComputedData(data, apiKey);
    expect(decrypted).toBe(sessionKey.slice(2));
  });

  it('should build sign_in computedData payload', () => {
    const result = buildGdexSignInComputedData({
      apiKey,
      userId: '0xabc',
      sessionKey: '0x02' + '11'.repeat(32),
      nonce: '123',
      refSourceCode: '',
      signature: '0x' + 'aa'.repeat(65),
    });

    expect(result.computedData).toMatch(/^[0-9a-f]+$/);
    expect(result.data.startsWith('0x')).toBe(true);
    expect(result.signature).toMatch(/^0x[0-9a-f]{130}$/i);

    const decrypted = decryptGdexComputedData(result.computedData, apiKey);
    const parsed = JSON.parse(decrypted) as { userId: string; data: string; signature: string };
    expect(parsed.userId).toBe('0xabc');
    expect(parsed.data).toBe(result.data);
    expect(parsed.signature).toBe(result.signature);
  });

  it('should build managed trade computedData payload', () => {
    const pair = generateGdexSessionKeyPair();
    const built = buildGdexManagedTradeComputedData({
      apiKey,
      action: 'purchase',
      userId: '0xabc',
      tokenAddress: 'So11111111111111111111111111111111111111112',
      amount: '1000000',
      nonce: 'n-1',
      sessionPrivateKey: pair.sessionPrivateKey,
    });

    expect(built.signature).toMatch(/^[0-9a-f]{130}$/i);
    expect(built.data.startsWith('0x')).toBe(true);
    expect(built.computedData).toMatch(/^[0-9a-f]+$/);

    const msg = buildGdexTradeSignatureMessage('purchase', '0xabc', built.data);
    expect(msg).toBe(`purchase-0xabc-${built.data}`);
  });

  it('should encrypt generic payload objects', () => {
    const encrypted = buildEncryptedGdexPayload({
      apiKey,
      userId: '0xabc',
      data: '0x1234',
      signature: 'abcd',
    });
    const parsed = JSON.parse(decryptGdexComputedData(encrypted, apiKey)) as {
      userId: string;
      data: string;
      signature: string;
    };
    expect(parsed).toEqual({
      userId: '0xabc',
      data: '0x1234',
      signature: 'abcd',
    });
  });
});
