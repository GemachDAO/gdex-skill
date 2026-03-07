/**
 * Tests for wallet generation utilities.
 *
 * All tests run offline — no network connection or API key required.
 */
import {
  generateEvmWallet,
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

// ── GdexSkill.generateEvmWallet (method on class) ────────────────────────────

describe('GdexSkill.generateEvmWallet', () => {
  const skill = new GdexSkill();

  it('skill.generateEvmWallet() returns a valid EVM control wallet', () => {
    const wallet = skill.generateEvmWallet();
    expect(wallet.type).toBe('evm');
    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(wallet.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
    const words = wallet.mnemonic.trim().split(/\s+/);
    expect(words).toHaveLength(12);
  });

  it('skill.generateEvmWallet() does not require auth', () => {
    const unauthSkill = new GdexSkill();
    expect(unauthSkill.isAuthenticated()).toBe(false);
    // Should not throw even without auth
    const wallet = unauthSkill.generateEvmWallet();
    expect(wallet.address).toBeTruthy();
  });

  it('skill.generateEvmWallet() returns unique wallets on each call', () => {
    const w1 = skill.generateEvmWallet();
    const w2 = skill.generateEvmWallet();
    expect(w1.address).not.toBe(w2.address);
    expect(w1.privateKey).not.toBe(w2.privateKey);
  });
});
