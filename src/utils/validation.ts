/**
 * Input validation utilities.
 */
import { parseUnits } from 'ethers';
import { SupportedChain } from '../types/common';
import { normalizeChain } from '../config/chains';
import { GdexValidationError } from './errors';

/** EVM address regex */
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Base58 alphabet (Bitcoin/Solana) */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

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

/** Solana wrapped-SOL mint (native placeholder) */
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * Strict base58 decode. Returns the decoded byte length, or -1 if the string
 * contains a non-base58 character.
 */
function base58DecodedLength(value: string): number {
  let n = 0n;
  for (const ch of value) {
    const digit = BASE58_ALPHABET.indexOf(ch);
    if (digit < 0) return -1;
    n = n * 58n + BigInt(digit);
  }
  let bytes = 0;
  while (n > 0n) {
    n >>= 8n;
    bytes++;
  }
  // Each leading '1' encodes a leading zero byte.
  let leadingZeros = 0;
  while (leadingZeros < value.length && value[leadingZeros] === '1') leadingZeros++;
  return bytes + leadingZeros;
}

/** True when `value` is a base58 string that decodes to exactly 32 bytes (a Solana public key). */
function isSolanaPublicKey(value: string): boolean {
  if (value.length < 32 || value.length > 44) return false;
  return base58DecodedLength(value) === 32;
}

/**
 * Validate a token or wallet address for the given chain.
 * The chain may be a ChainId number or name; 'solana' and 622112261 behave the same.
 *
 * @throws {GdexValidationError} if the chain is unknown or the address format is invalid
 */
export function validateAddress(address: string, chain: SupportedChain, fieldName = 'address'): void {
  if (!address || typeof address !== 'string') {
    throw new GdexValidationError(`${fieldName} must be a non-empty string`, fieldName);
  }

  const { family } = normalizeChain(chain);

  if (family === 'solana') {
    if (!isSolanaPublicKey(address)) {
      throw new GdexValidationError(
        `Invalid Solana address format for ${fieldName}: "${address}"`,
        fieldName
      );
    }
    return;
  }

  if (family === 'sui') {
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

  const { family } = normalizeChain(chain);

  // Sui accepts both full wallet addresses (0x + 64 hex) AND Move coin type strings
  // (e.g. "0x2::sui::SUI", "0xabc::module::COIN")
  if (family === 'sui') {
    if (SUI_ADDRESS_RE.test(address) || SUI_COIN_TYPE_RE.test(address)) return;
    throw new GdexValidationError(
      `Invalid Sui token address for ${fieldName}: "${address}". ` +
        'Expected a 0x-prefixed 64-char hex address or a Move coin type (e.g. "0x2::module::COIN").',
      fieldName
    );
  }

  // Allow Solana native wSOL mint
  if (family === 'solana' && address === WSOL_MINT) return;

  validateAddress(address, chain, fieldName);
}

/** Plain decimal string: digits with an optional fractional part ("1", "0.5", "100.25"). */
const DECIMAL_RE = /^\d+(\.\d+)?$/;

/**
 * Validate a numeric amount string.
 *
 * Accepts:
 * - Positive decimal strings like "1.5", "100", "0.001"
 * - Percentage strings like "50%" (for sell amounts), only when `allowPercent` is set;
 *   the value must be in (0, 100]
 *
 * Rejects signs, exponents ("1e3"), "Infinity", trailing garbage ("1abc"), and zero.
 *
 * @throws {GdexValidationError} if the amount is invalid
 */
export function validateAmount(amount: string, fieldName = 'amount', allowPercent = false): void {
  if (!amount || typeof amount !== 'string') {
    throw new GdexValidationError(`${fieldName} must be a non-empty string`, fieldName);
  }

  // Allow percentage strings
  if (allowPercent && amount.endsWith('%')) {
    const body = amount.slice(0, -1);
    if (!DECIMAL_RE.test(body)) {
      throw new GdexValidationError(
        `${fieldName} percentage must be a plain decimal followed by "%", got "${amount}"`,
        fieldName
      );
    }
    const [intPart, fracPart = ''] = body.split('.');
    const intValue = BigInt(intPart);
    const fracNonZero = /[1-9]/.test(fracPart);
    if ((intValue === 0n && !fracNonZero) || intValue > 100n || (intValue === 100n && fracNonZero)) {
      throw new GdexValidationError(
        `${fieldName} percentage must be greater than 0 and at most 100, got "${amount}"`,
        fieldName
      );
    }
    return;
  }

  if (!DECIMAL_RE.test(amount) || !/[1-9]/.test(amount) || !Number.isFinite(Number(amount))) {
    throw new GdexValidationError(
      `${fieldName} must be a positive decimal number (e.g. "1.5"), got "${amount}"`,
      fieldName
    );
  }
}

/**
 * Convert a human-readable decimal amount to an integer in the token's smallest
 * unit, exactly (no floating point). Validates with {@link validateAmount} first.
 *
 * @example parseAmountUnits('1.5', 6) // 1500000n
 * @throws {GdexValidationError} if the amount is invalid or has more decimal
 *   places than `decimals` (it is never rounded)
 */
export function parseAmountUnits(amount: string, decimals: number, fieldName = 'amount'): bigint {
  validateAmount(amount, fieldName);
  const fraction = amount.split('.')[1] ?? '';
  if (fraction.replace(/0+$/, '').length > decimals) {
    throw new GdexValidationError(
      `${fieldName} has more than ${decimals} decimal places, got "${amount}"`,
      fieldName
    );
  }
  return parseUnits(amount, decimals);
}

/** Plain non-negative integer string ("0", "1000000"). */
const INTEGER_RE = /^\d+$/;

/**
 * Validate an amount already in the token's smallest unit (wei, lamports,
 * micro-USDC) and return it as a bigint. Only a plain positive integer string
 * is accepted: no decimal point, sign, exponent, whitespace or trailing
 * characters, and not zero.
 *
 * @example parseRawAmount('1500000') // 1500000n
 * @throws {GdexValidationError} if the amount is not a positive integer string
 */
export function parseRawAmount(amount: string, fieldName = 'amount'): bigint {
  if (typeof amount !== 'string' || !INTEGER_RE.test(amount)) {
    throw new GdexValidationError(
      `${fieldName} must be a positive integer in raw base units (e.g. "1000000"), got ${JSON.stringify(amount)}`,
      fieldName
    );
  }
  const raw = BigInt(amount);
  if (raw === 0n) {
    throw new GdexValidationError(`${fieldName} must be greater than 0, got "${amount}"`, fieldName);
  }
  return raw;
}

/**
 * Validate a whole-number percentage (an ABI `uint64` slot) and return it as a
 * canonical decimal string. `max` is inclusive unless `maxExclusive` is set.
 *
 * @throws {GdexValidationError} if the value is not an integer in range
 */
export function parseIntegerPercent(
  value: string | number,
  fieldName: string,
  opts: { min?: number; max?: number; maxExclusive?: boolean } = {}
): string {
  const str = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof str !== 'string' || !INTEGER_RE.test(str)) {
    throw new GdexValidationError(
      `${fieldName} must be a whole-number percentage (e.g. "25"), got ${JSON.stringify(value)}`,
      fieldName
    );
  }
  const n = BigInt(str);
  const min = BigInt(opts.min ?? 0);
  if (n < min) {
    throw new GdexValidationError(`${fieldName} must be at least ${min}, got "${str}"`, fieldName);
  }
  if (opts.max !== undefined) {
    const max = BigInt(opts.max);
    if (opts.maxExclusive ? n >= max : n > max) {
      throw new GdexValidationError(
        `${fieldName} must be ${opts.maxExclusive ? 'below' : 'at most'} ${max}, got "${str}"`,
        fieldName
      );
    }
  }
  return n.toString();
}

/** Hyperliquid MAX_DECIMALS for prices: 6 on perps, 8 on spot. */
const HL_MAX_PRICE_DECIMALS = { perp: 6, spot: 8 } as const;

/** Count of fractional digits, ignoring trailing zeros ("0.50" -> 1). */
function significantDecimals(value: string): number {
  return (value.split('.')[1] ?? '').replace(/0+$/, '').length;
}

function checkSzDecimals(szDecimals: number | undefined): void {
  if (szDecimals !== undefined && (!Number.isInteger(szDecimals) || szDecimals < 0 || szDecimals > 8)) {
    throw new GdexValidationError(`szDecimals must be an integer from 0 to 8, got ${szDecimals}`, 'szDecimals');
  }
}

/**
 * Validate a Hyperliquid order price. Always: a positive plain decimal (no sign,
 * exponent or trailing characters). With `szDecimals` (the market's HL meta
 * value) it also applies Hyperliquid's tick rule: at most 5 significant
 * figures and at most `MAX_DECIMALS - szDecimals` decimals (6 on perps, 8 on
 * spot); integer prices are always allowed. Nothing is rounded.
 *
 * @throws {GdexValidationError} if the price is malformed or too precise
 */
export function validateHlPrice(
  price: string,
  fieldName = 'price',
  szDecimals?: number,
  market: 'perp' | 'spot' = 'perp'
): void {
  validateAmount(price, fieldName);
  checkSzDecimals(szDecimals);
  if (szDecimals === undefined) return;
  const decimals = significantDecimals(price);
  if (decimals === 0) return;
  const maxDecimals = HL_MAX_PRICE_DECIMALS[market] - szDecimals;
  if (decimals > maxDecimals) {
    throw new GdexValidationError(
      `${fieldName} ${price} has ${decimals} decimals; this market allows at most ${maxDecimals} (${HL_MAX_PRICE_DECIMALS[market]} - szDecimals ${szDecimals})`,
      fieldName
    );
  }
  const [whole, frac = ''] = price.split('.');
  const sigFigs = (whole + frac.replace(/0+$/, '')).replace(/^0+/, '').length;
  if (sigFigs > 5) {
    throw new GdexValidationError(
      `${fieldName} ${price} has ${sigFigs} significant figures; Hyperliquid allows at most 5 for a non-integer price`,
      fieldName
    );
  }
}

/**
 * Validate a Hyperliquid order size: a positive plain decimal, and with
 * `szDecimals` no more than that many decimals (never rounded).
 *
 * @throws {GdexValidationError} if the size is malformed or too precise
 */
export function validateHlSize(size: string, fieldName = 'size', szDecimals?: number): void {
  validateAmount(size, fieldName);
  checkSzDecimals(szDecimals);
  if (szDecimals !== undefined && significantDecimals(size) > szDecimals) {
    throw new GdexValidationError(
      `${fieldName} ${size} has more than the ${szDecimals} decimals this market allows (szDecimals)`,
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
  normalizeChain(chain);
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
