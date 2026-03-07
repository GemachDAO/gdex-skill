/**
 * Wallet generation utilities.
 *
 * Generates new wallets locally using cryptographically secure random bytes.
 * Private keys are NEVER transmitted over the network — they are only returned
 * to the caller to store securely.
 *
 * Supported wallet types:
 * - **EVM** (Ethereum, Base, Arbitrum, BNB, etc.) via secp256k1 + ethers.js
 * - **Solana** via ed25519 using Node.js built-in `crypto`
 */

import { randomBytes } from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A newly generated EVM wallet.
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

/**
 * A newly generated Solana wallet.
 */
export interface GeneratedSolanaWallet {
  /** Wallet type */
  type: 'solana';
  /** Public key (base58-encoded) */
  address: string;
  /**
   * Full 64-byte keypair encoded as base58.
   * This is the format used by Phantom, Solflare, and the Solana CLI.
   * Store this securely — it cannot be recovered if lost.
   */
  privateKey: string;
  /**
   * Secret key as a hex string (64 bytes = 128 hex chars).
   * Alternative encoding of the same key material.
   */
  secretKeyHex: string;
}

/**
 * Union type covering all supported generated wallet types.
 */
export type GeneratedWallet = GeneratedEvmWallet | GeneratedSolanaWallet;

// ─── EVM wallet ───────────────────────────────────────────────────────────────

/**
 * Generate a new EVM wallet (compatible with Ethereum, Base, Arbitrum, BSC, etc.).
 *
 * Uses ethers.js `Wallet.createRandom()` internally, which uses the platform
 * CSPRNG (`crypto.randomBytes`) for key material.
 *
 * @returns A newly generated EVM wallet with address, private key, and mnemonic.
 *
 * @example
 * ```typescript
 * import { generateEvmWallet } from '@gdexsdk/gdex-skill';
 *
 * const wallet = generateEvmWallet();
 * console.log('Address:', wallet.address);
 * // Store wallet.privateKey securely (e.g., in an env variable)
 *
 * const skill = new GdexSkill();
 * await skill.authenticate({ type: 'evm', address: wallet.address, privateKey: wallet.privateKey });
 * ```
 */
export function generateEvmWallet(): GeneratedEvmWallet {
  // Dynamically require ethers to keep Solana-only users from having to install it.
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

// ─── Solana wallet ────────────────────────────────────────────────────────────

/**
 * Generate a new Solana wallet using a cryptographically secure random ed25519 keypair.
 *
 * Uses Node.js's built-in `crypto.randomBytes` for key material — no optional
 * dependencies required. The public key is base58-encoded to match the format
 * expected by Phantom, Solflare, and the Solana web3.js library.
 *
 * @returns A newly generated Solana wallet with address and private key.
 *
 * @example
 * ```typescript
 * import { generateSolanaWallet } from '@gdexsdk/gdex-skill';
 *
 * const wallet = generateSolanaWallet();
 * console.log('Address:', wallet.address);
 * // Store wallet.privateKey securely
 *
 * const skill = new GdexSkill();
 * await skill.authenticate({ type: 'solana', address: wallet.address, privateKey: wallet.privateKey });
 * ```
 */
export function generateSolanaWallet(): GeneratedSolanaWallet {
  // Generate a 32-byte random seed for ed25519
  const seed = randomBytes(32);

  // Derive ed25519 keypair from seed using Node.js crypto (available since Node 15)
  const { publicKey, privateKey: nodePrivateKey } = generateEd25519KeypairFromSeed(seed);

  // The Solana "secret key" convention is [32-byte seed || 32-byte public key] = 64 bytes
  const secretKey = Buffer.concat([seed, publicKey]);

  return {
    type: 'solana',
    address: base58Encode(publicKey),
    privateKey: base58Encode(secretKey),
    secretKeyHex: secretKey.toString('hex'),
  };
}

// ─── Unified generateWallet helper ───────────────────────────────────────────

/**
 * Generate a new wallet for the specified chain type.
 *
 * - `'evm'` — Generates an Ethereum/EVM-compatible wallet (secp256k1).
 * - `'solana'` — Generates a Solana wallet (ed25519).
 *
 * @param type - Wallet type: `'evm'` or `'solana'`
 * @returns A newly generated wallet object.
 *
 * @example
 * ```typescript
 * import { generateWallet } from '@gdexsdk/gdex-skill';
 *
 * const evmWallet = generateWallet('evm');
 * const solWallet = generateWallet('solana');
 * ```
 */
export function generateWallet(type: 'evm'): GeneratedEvmWallet;
export function generateWallet(type: 'solana'): GeneratedSolanaWallet;
export function generateWallet(type: 'evm' | 'solana'): GeneratedWallet {
  if (type === 'solana') {
    return generateSolanaWallet();
  }
  return generateEvmWallet();
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Derive an ed25519 keypair from a 32-byte seed using Node.js `crypto`.
 * Returns raw 32-byte public key and private key buffers.
 */
function generateEd25519KeypairFromSeed(seed: Buffer): { publicKey: Buffer; privateKey: Buffer } {
  // Node.js crypto.generateKeyPairSync supports ed25519 since Node 15.
  // We use the private key DER and extract the raw 32-byte seed + public key.
  const { createPrivateKey, createPublicKey } = require('crypto');

  // Build an ed25519 private key from the seed via RFC 8032 / PKCS#8 DER encoding
  // PKCS#8 header for ed25519 seed: 302e020100300506032b657004220420 (16 bytes) + 32-byte seed
  const pkcs8Header = Buffer.from('302e020100300506032b657004220420', 'hex');
  const pkcs8Der = Buffer.concat([pkcs8Header, seed]);

  const privateKeyObj = createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });
  const publicKeyObj = createPublicKey(privateKeyObj);

  // Export raw 32-byte public key (SubjectPublicKeyInfo DER has a 12-byte header)
  const pubDer = publicKeyObj.export({ format: 'der', type: 'spki' }) as Buffer;
  const publicKey = pubDer.slice(12); // last 32 bytes are the raw public key

  return { publicKey, privateKey: seed };
}

/**
 * Encode a Buffer as a base58 string (Bitcoin alphabet).
 * Implemented without dependencies using the standard base58 alphabet.
 */
function base58Encode(input: Buffer): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  let num = BigInt('0x' + input.toString('hex'));
  const base = BigInt(58);
  const digits: number[] = [];

  while (num > 0n) {
    const remainder = num % base;
    num = num / base;
    digits.push(Number(remainder));
  }

  // Add leading '1' characters for each leading zero byte
  let leadingOnes = 0;
  for (const byte of input) {
    if (byte === 0) leadingOnes++;
    else break;
  }

  const result = ALPHABET[0].repeat(leadingOnes) + digits.reverse().map(d => ALPHABET[d]).join('');
  return result;
}
