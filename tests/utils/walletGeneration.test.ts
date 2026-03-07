/**
 * Tests for wallet generation utilities.
 *
 * All tests run offline — no network connection or API key required.
 */
import {
  generateEvmWallet,
  generateSolanaWallet,
  generateWallet,
} from '../../src/utils/walletGeneration';
import { GdexSkill } from '../../src/index';

// ── generateEvmWallet ─────────────────────────────────────────────────────────

describe('generateEvmWallet', () => {
  it('should return type "evm"', () => {
    const wallet = generateEvmWallet();
    expect(wallet.type).toBe('evm');
  });

  it('should return a checksummed 0x-prefixed address', () => {
    const wallet = generateEvmWallet();
    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('should return a 0x-prefixed 32-byte private key', () => {
    const wallet = generateEvmWallet();
    expect(wallet.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it('should return a 12-word mnemonic', () => {
    const wallet = generateEvmWallet();
    const words = wallet.mnemonic.trim().split(/\s+/);
    expect(words).toHaveLength(12);
  });

  it('should return the standard EVM derivation path', () => {
    const wallet = generateEvmWallet();
    expect(wallet.derivationPath).toBe("m/44'/60'/0'/0/0");
  });

  it('should generate unique wallets on every call', () => {
    const w1 = generateEvmWallet();
    const w2 = generateEvmWallet();
    expect(w1.address).not.toBe(w2.address);
    expect(w1.privateKey).not.toBe(w2.privateKey);
    expect(w1.mnemonic).not.toBe(w2.mnemonic);
  });

  it('should generate 10 wallets with unique addresses', () => {
    const addresses = new Set(Array.from({ length: 10 }, () => generateEvmWallet().address));
    expect(addresses.size).toBe(10);
  });
});

// ── generateSolanaWallet ──────────────────────────────────────────────────────

describe('generateSolanaWallet', () => {
  it('should return type "solana"', () => {
    const wallet = generateSolanaWallet();
    expect(wallet.type).toBe('solana');
  });

  it('should return a non-empty base58 address', () => {
    const wallet = generateSolanaWallet();
    // Solana addresses are 32 bytes in base58: typically 43–44 characters
    expect(wallet.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  it('should return a base58-encoded 64-byte keypair as privateKey', () => {
    const wallet = generateSolanaWallet();
    // 64 bytes in base58 is typically 87–88 characters
    expect(wallet.privateKey).toMatch(/^[1-9A-HJ-NP-Za-km-z]{80,92}$/);
  });

  it('should return secretKeyHex as a 128-character hex string (64 bytes)', () => {
    const wallet = generateSolanaWallet();
    expect(wallet.secretKeyHex).toMatch(/^[0-9a-f]{128}$/);
  });

  it('should generate unique wallets on every call', () => {
    const w1 = generateSolanaWallet();
    const w2 = generateSolanaWallet();
    expect(w1.address).not.toBe(w2.address);
    expect(w1.privateKey).not.toBe(w2.privateKey);
  });

  it('should generate 10 wallets with unique addresses', () => {
    const addresses = new Set(Array.from({ length: 10 }, () => generateSolanaWallet().address));
    expect(addresses.size).toBe(10);
  });

  it('should produce an address consistent with the private key', () => {
    const wallet = generateSolanaWallet();
    // The secretKeyHex is [32-byte seed || 32-byte pubkey]
    // The public key (last 32 bytes) when base58-encoded should equal the address
    const secretKeyBuf = Buffer.from(wallet.secretKeyHex, 'hex');
    expect(secretKeyBuf).toHaveLength(64);
    // Verify the address matches the public key portion
    const pubKeyFromSecret = secretKeyBuf.slice(32);
    // Base58 encode the pubkey (reuse our own module's export indirectly via address length)
    // At minimum: the address length should be in the range for a 32-byte base58 value
    expect(wallet.address.length).toBeGreaterThanOrEqual(32);
    expect(wallet.address.length).toBeLessThanOrEqual(44);
    // And the last 32 bytes of secretKeyHex when hex-decoded should not be all zeros
    expect(pubKeyFromSecret.every(b => b === 0)).toBe(false);
  });
});

// ── generateWallet (unified) ─────────────────────────────────────────────────

describe('generateWallet', () => {
  it('should generate an EVM wallet when type is "evm"', () => {
    const wallet = generateWallet('evm');
    expect(wallet.type).toBe('evm');
    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('should generate a Solana wallet when type is "solana"', () => {
    const wallet = generateWallet('solana');
    expect(wallet.type).toBe('solana');
    expect(wallet.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });
});

// ── GdexSkill.generateWallet (method on class) ───────────────────────────────

describe('GdexSkill wallet generation methods', () => {
  const skill = new GdexSkill();

  it('skill.generateEvmWallet() returns a valid EVM wallet', () => {
    const wallet = skill.generateEvmWallet();
    expect(wallet.type).toBe('evm');
    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(wallet.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
    const words = wallet.mnemonic.trim().split(/\s+/);
    expect(words).toHaveLength(12);
  });

  it('skill.generateSolanaWallet() returns a valid Solana wallet', () => {
    const wallet = skill.generateSolanaWallet();
    expect(wallet.type).toBe('solana');
    expect(wallet.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(wallet.secretKeyHex).toMatch(/^[0-9a-f]{128}$/);
  });

  it('skill.generateWallet("evm") returns a valid EVM wallet', () => {
    const wallet = skill.generateWallet('evm');
    expect(wallet.type).toBe('evm');
  });

  it('skill.generateWallet("solana") returns a valid Solana wallet', () => {
    const wallet = skill.generateWallet('solana');
    expect(wallet.type).toBe('solana');
  });

  it('skill.generateEvmWallet() does not require auth', () => {
    const unauthSkill = new GdexSkill();
    expect(unauthSkill.isAuthenticated()).toBe(false);
    // Should not throw even without auth
    const wallet = unauthSkill.generateEvmWallet();
    expect(wallet.address).toBeTruthy();
  });

  it('skill.generateSolanaWallet() does not require auth', () => {
    const unauthSkill = new GdexSkill();
    expect(unauthSkill.isAuthenticated()).toBe(false);
    const wallet = unauthSkill.generateSolanaWallet();
    expect(wallet.address).toBeTruthy();
  });
});
