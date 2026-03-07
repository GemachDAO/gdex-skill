/**
 * Authentication helpers for signing requests to the Gbot backend.
 *
 * The backend supports three signature types:
 * - EVM (secp256k1): Sign a nonce with an Ethereum wallet
 * - Solana (ed25519): Sign a nonce with a Solana wallet
 * - Sui: Sign a nonce with a Sui wallet
 */

/**
 * Supported wallet / signature types for authentication.
 */
export type WalletType = 'evm' | 'solana' | 'sui';

/**
 * Auth credentials for a specific wallet.
 */
export interface AuthCredentials {
  /** Wallet type */
  type: WalletType;
  /** Public wallet address */
  address: string;
  /**
   * Private key (hex for EVM, base58 for Solana).
   * Should only be provided in trusted environments.
   */
  privateKey?: string;
  /**
   * Custom signer function — provide this if you want to handle signing externally
   * (e.g., through a browser wallet or hardware wallet).
   *
   * @param message - The message to sign (typically a nonce string)
   * @returns The signature as a hex string or base58 string
   */
  signer?: (message: string) => Promise<string>;
}

/**
 * Auth session data returned after successful authentication.
 */
export interface AuthSession {
  /** Session / JWT token */
  token: string;
  /** Token expiry timestamp (Unix ms) */
  expiresAt: number;
  /** Authenticated wallet address */
  address: string;
  /** Wallet type */
  type: WalletType;
}

/**
 * Sign a nonce message using an EVM wallet (secp256k1).
 *
 * Uses ethers.js Wallet to sign a personal message.
 *
 * @param privateKey - EVM private key (hex, with or without 0x prefix)
 * @param message - The message (nonce) to sign
 * @returns Hex signature string
 */
export async function signEvmMessage(privateKey: string, message: string): Promise<string> {
  try {
    const { ethers } = await import('ethers');
    const wallet = new ethers.Wallet(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
    return await wallet.signMessage(message);
  } catch {
    throw new Error('ethers package is required for EVM signing. Install it with: npm install ethers');
  }
}

/**
 * Sign a nonce message using a Solana wallet (ed25519).
 *
 * Uses tweetnacl for signing.
 *
 * @param privateKey - Solana private key (base58 encoded 64-byte keypair)
 * @param message - The message (nonce) to sign
 * @returns Base58-encoded signature
 */
export async function signSolanaMessage(privateKey: string, message: string): Promise<string> {
  try {
    const bs58 = await importBs58();
    const nacl = await importNacl();
    const keypairBytes = bs58.decode(privateKey);
    const secretKey = keypairBytes.slice(0, 64);
    const msgBytes = new TextEncoder().encode(message);
    const signature = nacl.sign.detached(msgBytes, secretKey);
    return bs58.encode(signature);
  } catch {
    throw new Error(
      'bs58 and tweetnacl packages are required for Solana signing. ' +
        'Install them with: npm install bs58 tweetnacl'
    );
  }
}

/**
 * Dynamically import bs58 for base58 encoding/decoding.
 */
async function importBs58(): Promise<{ encode: (buf: Uint8Array) => string; decode: (str: string) => Uint8Array }> {
  const mod = require('bs58');
  return mod.default ?? mod;
}

/**
 * Dynamically import tweetnacl for ed25519 signing.
 */
async function importNacl(): Promise<{
  sign: { detached: (msg: Uint8Array, sk: Uint8Array) => Uint8Array };
}> {
  const mod = require('tweetnacl');
  return mod.default ?? mod;
}

/**
 * Derive the EVM wallet address from a private key.
 *
 * @param privateKey - EVM private key (hex)
 * @returns Checksummed wallet address
 */
export async function deriveEvmAddress(privateKey: string): Promise<string> {
  const { ethers } = await import('ethers');
  const wallet = new ethers.Wallet(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
  return wallet.address;
}

/**
 * Derive the Solana wallet address (public key) from a private key.
 *
 * @param privateKey - Solana private key (base58 encoded)
 * @returns Base58 public key string
 */
export async function deriveSolanaAddress(privateKey: string): Promise<string> {
  const bs58 = await importBs58();
  const keypairBytes = bs58.decode(privateKey);
  const publicKeyBytes = keypairBytes.slice(32, 64);
  return bs58.encode(publicKeyBytes);
}
