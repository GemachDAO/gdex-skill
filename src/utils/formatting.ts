/**
 * Response formatting utilities.
 */
import { SupportedChain, ChainId } from '../types/common';

/**
 * Get the human-readable name for a chain.
 */
export function getChainName(chain: SupportedChain): string {
  if (chain === 'solana') return 'Solana';
  if (chain === 'sui') return 'Sui';

  const names: Record<number, string> = {
    [ChainId.ETHEREUM]: 'Ethereum',
    [ChainId.BSC]: 'BNB Smart Chain',
    [ChainId.OPTIMISM]: 'Optimism',
    [ChainId.ARBITRUM]: 'Arbitrum One',
    [ChainId.AVALANCHE]: 'Avalanche',
    [ChainId.SONIC]: 'Sonic',
    [ChainId.BASE]: 'Base',
    [ChainId.POLYGON]: 'Polygon',
    [ChainId.FRAXTAL]: 'Fraxtal',
    [ChainId.NIBIRU]: 'Nibiru',
    [ChainId.LINEA]: 'Linea',
    [ChainId.BERACHAIN]: 'Berachain',
    [ChainId.SCROLL]: 'Scroll',
    [ChainId.BLAST]: 'Blast',
    [ChainId.ZKSYNC]: 'zkSync Era',
    [ChainId.ROBINHOOD]: 'Robinhood Chain',
    [ChainId.SOLANA]: 'Solana',
    [ChainId.SUI]: 'Sui',
  };

  return names[chain as number] ?? `Chain ${chain}`;
}

/**
 * Get the native token symbol for a chain.
 */
export function getNativeToken(chain: SupportedChain): string {
  if (chain === 'solana') return 'SOL';
  if (chain === 'sui') return 'SUI';

  const tokens: Record<number, string> = {
    [ChainId.ETHEREUM]: 'ETH',
    [ChainId.BSC]: 'BNB',
    [ChainId.OPTIMISM]: 'ETH',
    [ChainId.ARBITRUM]: 'ETH',
    [ChainId.AVALANCHE]: 'AVAX',
    [ChainId.SONIC]: 'S',
    [ChainId.BASE]: 'ETH',
    [ChainId.POLYGON]: 'MATIC',
    [ChainId.FRAXTAL]: 'frxETH',
    [ChainId.NIBIRU]: 'NIBI',
    [ChainId.LINEA]: 'ETH',
    [ChainId.BERACHAIN]: 'BERA',
    [ChainId.SCROLL]: 'ETH',
    [ChainId.BLAST]: 'ETH',
    [ChainId.ZKSYNC]: 'ETH',
    [ChainId.SOLANA]: 'SOL',
    [ChainId.SUI]: 'SUI',
  };

  return tokens[chain as number] ?? 'ETH';
}

/**
 * Format a token amount for display (with symbol and proper decimals).
 *
 * @param amount - Raw balance (in smallest unit as a string)
 * @param decimals - Token decimal places
 * @param symbol - Token symbol
 * @returns Formatted string like "1.5 ETH"
 */
export function formatTokenAmount(amount: string, decimals: number, symbol: string): string {
  try {
    const raw = BigInt(amount);
    const divisor = 10n ** BigInt(decimals);
    const whole = raw / divisor;
    const remainder = raw % divisor;
    const remainderStr = remainder.toString().padStart(decimals, '0');
    const trimmed = remainderStr.replace(/0+$/, '');
    const decimal = trimmed.length > 0 ? `.${trimmed.slice(0, 6)}` : '';
    return `${whole}${decimal} ${symbol}`;
  } catch {
    return `${amount} ${symbol}`;
  }
}

/**
 * Format a USD value for display.
 *
 * @param value - USD value as a string
 * @param decimals - Number of decimal places (default: 2)
 */
export function formatUsd(value: string, decimals = 2): string {
  const num = parseFloat(value);
  if (isNaN(num)) return '$0.00';
  return `$${num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * Format a percentage change for display.
 *
 * @param change - Percentage change as a string (e.g., "5.23")
 */
export function formatPercentChange(change: string): string {
  const num = parseFloat(change);
  if (isNaN(num)) return '0.00%';
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

/**
 * Shorten an address for display (0x1234...5678).
 *
 * @param address - Full address string
 * @param prefixLen - Number of characters to keep at start (default: 6)
 * @param suffixLen - Number of characters to keep at end (default: 4)
 */
export function shortenAddress(address: string, prefixLen = 6, suffixLen = 4): string {
  if (address.length <= prefixLen + suffixLen + 3) return address;
  return `${address.slice(0, prefixLen)}...${address.slice(-suffixLen)}`;
}

/**
 * Convert a Unix timestamp to ISO 8601 date string.
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

/** The shortest decimal JavaScript prints for a non-negative `value`, without exponent notation. */
function plainDecimal(value: number): string {
  const [mantissa, exponent] = String(value).split('e');
  if (exponent === undefined) return mantissa;
  const [int, frac = ''] = mantissa.split('.');
  const digits = int + frac;
  const point = int.length + Number(exponent);
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

/**
 * Truncate a number to a fixed number of decimal places without rounding.
 *
 * Non-negative values are cut on their decimal form, so a value that already
 * has `decimals` places is kept (1.15 stays "1.15"; `1.15 * 100` would be
 * 114.99999999999999 and floor to 1.14). Negative values round down, as before.
 *
 * @param value - Value to truncate
 * @param decimals - Number of decimal places
 */
export function truncateDecimals(value: number, decimals: number): string {
  if (Number.isFinite(value) && value >= 0 && Number.isInteger(decimals) && decimals >= 0) {
    const [int, frac = ''] = plainDecimal(value).split('.');
    return decimals === 0 ? int : `${int}.${frac.slice(0, decimals).padEnd(decimals, '0')}`;
  }
  const factor = Math.pow(10, decimals);
  return (Math.floor(value * factor) / factor).toFixed(decimals);
}
