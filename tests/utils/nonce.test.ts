import { generateGdexNonce } from '../../src/utils/gdexManagedCrypto';

describe('generateGdexNonce', () => {
  it('returns strictly increasing, unique values for rapid sequential calls', () => {
    const n = 5000;
    const seen = new Set<number>();
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const nonce = generateGdexNonce();
      expect(nonce).toBeGreaterThan(prev);
      expect(seen.has(nonce)).toBe(false);
      seen.add(nonce);
      prev = nonce;
    }
    expect(seen.size).toBe(n);
  });

  it('is based on a millisecond timestamp', () => {
    const before = Date.now();
    const nonce = generateGdexNonce();
    expect(nonce).toBeGreaterThanOrEqual(before);
  });
});
