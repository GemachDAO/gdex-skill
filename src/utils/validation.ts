/**
 * Input validation utilities.
 */
import { SupportedChain, ChainId } from '../types/common';
import { GdexValidationError } from './errors';

/** EVM address regex */
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Solana address regex (base58, 32–44 chars) */
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Sui wallet address regex (0x + 64 hex chars) */
const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Sui Move type / coin identifier regex.
 * Matches strings like: 0x2::sui::SUI, 0xabc...def::module::COIN
 * Format: <hex-address>::<module>::<type>
 *
 * Note: Sui uses shortened hex addresses in Move type strings (e.g. "0x2" for the
 * system package, not the zero-padded 64-char form). Both shortened and full-length
 * hex prefixes are valid in coin type identifiers, so we accept one or more hex chars.
 */
const SUI_COIN_TYPE_RE = /^0x[0-9a-fA-F]+::[a-zA-Z_][a-zA-Z0-9_]*::[a-zA-Z_][a-zA-Z0-9_]*$/;

/** All supported EVM chain IDs */
const SUPPORTED_EVM_CHAIN_IDS = new Set(Object.values(ChainId).filter((v): v is number => typeof v === 'number'));

/**
 * Validate a token or wallet address for the given chain.
 *
 * @throws {GdexValidationError} if the address format is invalid
 */
export function validateAddress(address: string, chain: SupportedChain, fieldName = 'address'): void {
  if (!address || typeof address !== 'string') {
    throw new GdexValidationError(`${fieldName} must be a non-empty string`, fieldName);
  }

  if (chain === 'solana') {
    if (!SOLANA_ADDRESS_RE.test(address)) {
      throw new GdexValidationError(
        `Invalid Solana address format for ${fieldName}: "${address}"`,
        fieldName
      );
    }
    return;
  }

  if (chain === 'sui') {
    if (!SUI_ADDRESS_RE.test(address)) {
      throw new GdexValidationError(
        `Invalid Sui address format for ${fieldName}: "${address}"`,
        fieldName
      );
    }
    return;
  }

  // EVM chains
  if (!EVM_ADDRESS_RE.test(address)) {
    throw new GdexValidationError(
      `Invalid EVM address format for ${fieldName}: "${address}"`,
      fieldName
    );
  }
}

/**
 * Validate a token address, accepting native token placeholders and Sui Move coin types.
 * Native token placeholders:
 * - EVM: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" (ETH/BNB/MATIC etc.)
 * - Solana: "So11111111111111111111111111111111111111112" (wSOL)
 * - Sui: "0x2::sui::SUI" and all other Move coin type strings (e.g. "0xabc::module::COIN")
 */
export function validateTokenAddress(address: string, chain: SupportedChain, fieldName = 'tokenAddress'): void {
  if (!address || typeof address !== 'string') {
    throw new GdexValidationError(`${fieldName} must be a non-empty string`, fieldName);
  }

  // Sui accepts both full wallet addresses (0x + 64 hex) AND Move coin type strings
  // (e.g. "0x2::sui::SUI", "0xabc::module::COIN")
  if (chain === 'sui') {
    if (SUI_ADDRESS_RE.test(address) || SUI_COIN_TYPE_RE.test(address)) return;
    throw new GdexValidationError(
      `Invalid Sui token address for ${fieldName}: "${address}". ` +
        'Expected a 0x-prefixed 64-char hex address or a Move coin type (e.g. "0x2::module::COIN").',
      fieldName
    );
  }

  // Allow Solana native wSOL mint
  if (chain === 'solana' && address === 'So11111111111111111111111111111111111111112') return;

  validateAddress(address, chain, fieldName);
}

/**
 * Validate a numeric amount string.
 *
 * Accepts:
 * - Positive decimal strings like "1.5", "100", "0.001"
 * - Percentage strings like "50%" (for sell amounts)
 *
 * @throws {GdexValidationError} if the amount is invalid
 */
export function validateAmount(amount: string, fieldName = 'amount', allowPercent = false): void {
  if (!amount || typeof amount !== 'string') {
    throw new GdexValidationError(`${fieldName} must be a non-empty string`, fieldName);
  }

  // Allow percentage strings
  if (allowPercent && amount.endsWith('%')) {
    const pct = parseFloat(amount.slice(0, -1));
    if (isNaN(pct) || pct <= 0 || pct > 100) {
      throw new GdexValidationError(
        `${fieldName} percentage must be between 0 and 100 (exclusive/inclusive), got "${amount}"`,
        fieldName
      );
    }
    return;
  }

  const num = parseFloat(amount);
  if (isNaN(num) || num <= 0) {
    throw new GdexValidationError(
      `${fieldName} must be a positive number, got "${amount}"`,
      fieldName
    );
  }
}

/**
 * Validate a chain ID or chain name.
 *
 * @throws {GdexValidationError} if the chain is not supported
 */
export function validateChain(chain: SupportedChain): void {
  if (chain === 'solana' || chain === 'sui') return;

  if (typeof chain === 'number' && SUPPORTED_EVM_CHAIN_IDS.has(chain)) return;

  throw new GdexValidationError(
    `Unsupported chain: "${chain}". Use a ChainId enum value or 'solana' / 'sui'.`,
    'chain'
  );
}

/**
 * Validate slippage value.
 *
 * @throws {GdexValidationError} if slippage is out of valid range
 */
export function validateSlippage(slippage: number): void {
  if (typeof slippage !== 'number' || isNaN(slippage) || slippage < 0 || slippage > 100) {
    throw new GdexValidationError(
      `slippage must be a number between 0 and 100, got ${slippage}`,
      'slippage'
    );
  }
}

/**
 * Validate leverage value for perpetual trading.
 *
 * @throws {GdexValidationError} if leverage is out of valid range
 */
export function validateLeverage(leverage: number): void {
  if (typeof leverage !== 'number' || isNaN(leverage) || leverage < 1 || leverage > 100) {
    throw new GdexValidationError(
      `leverage must be a number between 1 and 100, got ${leverage}`,
      'leverage'
    );
  }
}

/**
 * Validate a HyperLiquid coin symbol.
 * Must be a non-empty uppercase string.
 */
export function validateCoin(coin: string): void {
  if (!coin || typeof coin !== 'string' || coin.trim().length === 0) {
    throw new GdexValidationError('coin must be a non-empty string', 'coin');
  }
}

/**
 * Validate that a required string field is present.
 *
 * @throws {GdexValidationError} if the field is missing or empty
 */
export function validateRequired(value: unknown, fieldName: string): void {
  if (value === null || value === undefined || value === '') {
    throw new GdexValidationError(`${fieldName} is required`, fieldName);
  }
}
