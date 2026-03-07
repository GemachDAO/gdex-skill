/**
 * Wallet generation utilities.
 *
 * Generates a new EVM control wallet locally using cryptographically secure
 * random bytes. The private key is NEVER transmitted over the network — it is
 * only returned to the caller to store securely.
 *
 * ## How wallet generation fits into the Gbot flow
 *
 * 1. Call `generateEvmWallet()` to create your **EVM control wallet**.
 * 2. Authenticate with the Gbot backend using that wallet's address + private key.
 * 3. The backend automatically provisions a full **trading wallet** for you,
 *    which includes a Solana address and any other chain-specific keys — no
 *    additional wallet generation is required on the client side.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A newly generated EVM control wallet.
 */
export interface GeneratedEvmWallet {
  /** Wallet type */
  type: 'evm';
  /** Public address (checksummed, 0x-prefixed) */
  address: string;
  /**
   * Private key (32 bytes, 0x-prefixed hex).
   * Store this securely — it cannot be recovered if lost.
   */
  privateKey: string;
  /**
   * BIP-39 mnemonic phrase (12 words) that can derive this wallet.
   * Store this securely — it can be used to restore the private key.
   */
  mnemonic: string;
  /** Derivation path used for the mnemonic */
  derivationPath: string;
}

// ─── EVM wallet ───────────────────────────────────────────────────────────────

/**
 * Generate a new EVM control wallet (compatible with Ethereum, Base, Arbitrum, BSC, etc.).
 *
 * This is your **control wallet** — authenticate with it and the Gbot backend
 * will automatically provide a full trading wallet (including a Solana address
 * and other chain-specific keys).
 *
 * Uses ethers.js `Wallet.createRandom()` internally, which uses the platform
 * CSPRNG (`crypto.randomBytes`) for key material.
 *
 * @returns A newly generated EVM wallet with address, private key, and mnemonic.
 *
 * @example
 * ```typescript
 * import { GdexSkill, generateEvmWallet, GDEX_API_KEY_PRIMARY } from '@gdexsdk/gdex-skill';
 *
 * // Step 1: generate your EVM control wallet (one-time setup)
 * const wallet = generateEvmWallet();
 * console.log('Address:', wallet.address);
 * // ⚠️  Save wallet.privateKey and wallet.mnemonic somewhere safe!
 *
 * // Step 2: authenticate — the backend will provision your trading wallets
 * const skill = new GdexSkill();
 * await skill.authenticate({ type: 'evm', address: wallet.address, privateKey: wallet.privateKey });
 *
 * // Step 3: trade on any supported chain (Solana, EVM, etc.)
 * const trade = await skill.buyToken({ chain: 'solana', tokenAddress: '...', amount: '0.1' });
 * ```
 */
export function generateEvmWallet(): GeneratedEvmWallet {
  let ethers: typeof import('ethers');
  try {
    ethers = require('ethers');
  } catch {
    throw new Error(
      'ethers is required for generateEvmWallet(). Install it with: npm install ethers'
    );
  }

  const wallet = ethers.Wallet.createRandom();
  const mnemonic = wallet.mnemonic?.phrase ?? '';

  return {
    type: 'evm',
    address: wallet.address,
    privateKey: wallet.privateKey,
    mnemonic,
    derivationPath: "m/44'/60'/0'/0/0",
  };
}
