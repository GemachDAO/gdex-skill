/**
 * Tests for auth helpers.
 */
import { signEvmMessage, deriveEvmAddress, WalletType } from '../../src/client/auth';

describe('auth', () => {
  // ── signEvmMessage ────────────────────────────────────────────────────────

  describe('signEvmMessage', () => {
    it('should sign a message with an EVM private key', async () => {
      // Use a well-known test private key (Hardhat account 0)
      const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
      const message = 'Sign this nonce: abc123';

      const signature = await signEvmMessage(privateKey, message);

      // Signature should be a hex string starting with 0x, 132 chars (65 bytes = 130 hex + 0x)
      expect(signature).toMatch(/^0x[0-9a-fA-F]{130}$/);
    });

    it('should handle private key without 0x prefix', async () => {
      const privateKey = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
      const message = 'test nonce';

      const signature = await signEvmMessage(privateKey, message);
      expect(signature).toMatch(/^0x[0-9a-fA-F]{130}$/);
    });

    it('should produce consistent signatures for the same key and message', async () => {
      const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
      const message = 'consistent nonce';

      const sig1 = await signEvmMessage(privateKey, message);
      const sig2 = await signEvmMessage(privateKey, message);

      expect(sig1).toBe(sig2);
    });

    it('should produce different signatures for different messages', async () => {
      const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

      const sig1 = await signEvmMessage(privateKey, 'nonce1');
      const sig2 = await signEvmMessage(privateKey, 'nonce2');

      expect(sig1).not.toBe(sig2);
    });
  });

  // ── deriveEvmAddress ──────────────────────────────────────────────────────

  describe('deriveEvmAddress', () => {
    it('should derive the correct address from a private key', async () => {
      // Hardhat account 0: known address
      const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
      const expectedAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

      const address = await deriveEvmAddress(privateKey);

      expect(address).toBe(expectedAddress);
    });

    it('should handle private key without 0x prefix', async () => {
      const privateKey = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
      const expectedAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

      const address = await deriveEvmAddress(privateKey);
      expect(address).toBe(expectedAddress);
    });

    it('should return a checksummed address (EIP-55)', async () => {
      const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
      const address = await deriveEvmAddress(privateKey);

      // Checksummed addresses have mixed case
      expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      // Checksummed form should not be all lowercase (for this specific address)
      expect(address).not.toBe(address.toLowerCase());
    });
  });

  // ── WalletType ────────────────────────────────────────────────────────────

  describe('WalletType', () => {
    it('should be a valid type for evm', () => {
      const type: WalletType = 'evm';
      expect(['evm', 'solana', 'sui'].includes(type)).toBe(true);
    });

    it('should be a valid type for solana', () => {
      const type: WalletType = 'solana';
      expect(['evm', 'solana', 'sui'].includes(type)).toBe(true);
    });
  });
});
