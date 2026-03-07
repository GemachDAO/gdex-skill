/**
 * Chain configuration — defines supported chains with metadata.
 */
import { ChainId, SupportedChain, SupportedDex } from '../types/common';

/**
 * Configuration metadata for a supported chain.
 */
export interface ChainConfig {
  /** Chain ID (number for EVM, string for non-EVM) */
  id: SupportedChain;
  /** Human-readable chain name */
  name: string;
  /** Native token symbol */
  nativeToken: string;
  /** Native token decimals */
  nativeDecimals: number;
  /** Native token address placeholder (used in trade params) */
  nativeTokenAddress: string;
  /** Supported DEXes on this chain */
  supportedDexes: SupportedDex[];
  /** Whether perpetual trading is supported */
  supportsPerpTrading: boolean;
  /** Whether bridging is supported */
  supportsBridging: boolean;
  /** Block explorer base URL */
  explorerUrl: string;
  /** Average block time in seconds */
  blockTime?: number;
}

/**
 * All supported chain configurations.
 */
export const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  // ── Solana ───────────────────────────────────────────────────────────────
  solana: {
    id: 'solana',
    name: 'Solana',
    nativeToken: 'SOL',
    nativeDecimals: 9,
    nativeTokenAddress: 'So11111111111111111111111111111111111111112',
    supportedDexes: ['raydium', 'raydium-v2', 'orca'],
    supportsPerpTrading: false,
    supportsBridging: true,
    explorerUrl: 'https://solscan.io',
    blockTime: 0.4,
  },

  // ── Sui ──────────────────────────────────────────────────────────────────
  sui: {
    id: 'sui',
    name: 'Sui',
    nativeToken: 'SUI',
    nativeDecimals: 9,
    nativeTokenAddress: '0x2::sui::SUI',
    supportedDexes: ['cetus', 'bluefin'],
    supportsPerpTrading: false,
    supportsBridging: true,
    explorerUrl: 'https://suiexplorer.com',
    blockTime: 0.5,
  },

  // ── Ethereum ─────────────────────────────────────────────────────────────
  [ChainId.ETHEREUM]: {
    id: ChainId.ETHEREUM,
    name: 'Ethereum',
    nativeToken: 'ETH',
    nativeDecimals: 18,
    nativeTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    supportedDexes: ['uniswap-v2', 'uniswap-v3', 'odos'],
    supportsPerpTrading: false,
    supportsBridging: true,
    explorerUrl: 'https://etherscan.io',
    blockTime: 12,
  },

  // ── BNB Smart Chain ───────────────────────────────────────────────────────
  [ChainId.BSC]: {
    id: ChainId.BSC,
    name: 'BNB Smart Chain',
    nativeToken: 'BNB',
    nativeDecimals: 18,
    nativeTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    supportedDexes: ['uniswap-v2', 'pancakeswap', 'odos'],
    supportsPerpTrading: false,
    supportsBridging: true,
    explorerUrl: 'https://bscscan.com',
    blockTime: 3,
  },

  // ── Optimism ──────────────────────────────────────────────────────────────
  [ChainId.OPTIMISM]: {
    id: ChainId.OPTIMISM,
    name: 'Optimism',
    nativeToken: 'ETH',
    nativeDecimals: 18,
    nativeTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    supportedDexes: ['uniswap-v3', 'odos'],
    supportsPerpTrading: false,
    supportsBridging: true,
    explorerUrl: 'https://optimistic.etherscan.io',
    blockTime: 2,
  },

  // ── Arbitrum ──────────────────────────────────────────────────────────────
  [ChainId.ARBITRUM]: {
    id: ChainId.ARBITRUM,
    name: 'Arbitrum One',
    nativeToken: 'ETH',
    nativeDecimals: 18,
    nativeTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    supportedDexes: ['uniswap-v3', 'odos'],
    supportsPerpTrading: false,
    supportsBridging: true,
    explorerUrl: 'https://arbiscan.io',
    blockTime: 0.25,
  },

  // ── Avalanche ─────────────────────────────────────────────────────────────
  [ChainId.AVALANCHE]: {
    id: ChainId.AVALANCHE,
    name: 'Avalanche',
    nativeToken: 'AVAX',
    nativeDecimals: 18,
    nativeTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    supportedDexes: ['uniswap-v2', 'uniswap-v3', 'odos'],
    supportsPerpTrading: false,
    supportsBridging: true,
    explorerUrl: 'https://snowtrace.io',
    blockTime: 2,
  },

  // ── Base ──────────────────────────────────────────────────────────────────
  [ChainId.BASE]: {
    id: ChainId.BASE,
    name: 'Base',
    nativeToken: 'ETH',
    nativeDecimals: 18,
    nativeTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    supportedDexes: ['uniswap-v3', 'odos', 'arcadia'],
    supportsPerpTrading: false,
    supportsBridging: true,
    explorerUrl: 'https://basescan.org',
    blockTime: 2,
  },

  // ── Polygon ───────────────────────────────────────────────────────────────
  [ChainId.POLYGON]: {
    id: ChainId.POLYGON,
    name: 'Polygon',
    nativeToken: 'MATIC',
    nativeDecimals: 18,
    nativeTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    supportedDexes: ['uniswap-v3', 'odos'],
    supportsPerpTrading: false,
    supportsBridging: true,
    explorerUrl: 'https://polygonscan.com',
    blockTime: 2,
  },

  // ── Fraxtal ───────────────────────────────────────────────────────────────
  [ChainId.FRAXTAL]: {
    id: ChainId.FRAXTAL,
    name: 'Fraxtal',
    nativeToken: 'frxETH',
    nativeDecimals: 18,
    nativeTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    supportedDexes: ['uniswap-v3'],
    supportsPerpTrading: false,
    supportsBridging: true,
    explorerUrl: 'https://fraxscan.com',
    blockTime: 2,
  },

  // ── Linea ─────────────────────────────────────────────────────────────────
  [ChainId.LINEA]: {
    id: ChainId.LINEA,
    name: 'Linea',
    nativeToken: 'ETH',
    nativeDecimals: 18,
    nativeTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    supportedDexes: ['uniswap-v3'],
    supportsPerpTrading: false,
    supportsBridging: true,
    explorerUrl: 'https://lineascan.build',
    blockTime: 2,
  },

  // ── Scroll ────────────────────────────────────────────────────────────────
  [ChainId.SCROLL]: {
    id: ChainId.SCROLL,
    name: 'Scroll',
    nativeToken: 'ETH',
    nativeDecimals: 18,
    nativeTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    supportedDexes: ['uniswap-v3'],
    supportsPerpTrading: false,
    supportsBridging: true,
    explorerUrl: 'https://scrollscan.com',
    blockTime: 3,
  },

  // ── Blast ─────────────────────────────────────────────────────────────────
  [ChainId.BLAST]: {
    id: ChainId.BLAST,
    name: 'Blast',
    nativeToken: 'ETH',
    nativeDecimals: 18,
    nativeTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    supportedDexes: ['uniswap-v3'],
    supportsPerpTrading: false,
    supportsBridging: true,
    explorerUrl: 'https://blastscan.io',
    blockTime: 2,
  },

  // ── zkSync Era ────────────────────────────────────────────────────────────
  [ChainId.ZKSYNC]: {
    id: ChainId.ZKSYNC,
    name: 'zkSync Era',
    nativeToken: 'ETH',
    nativeDecimals: 18,
    nativeTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    supportedDexes: ['uniswap-v3'],
    supportsPerpTrading: false,
    supportsBridging: true,
    explorerUrl: 'https://explorer.zksync.io',
    blockTime: 1,
  },
};

/**
 * Get chain configuration by chain ID.
 *
 * @throws {Error} if the chain is not supported
 */
export function getChainConfig(chain: SupportedChain): ChainConfig {
  const key = String(chain);
  const config = CHAIN_CONFIGS[key];
  if (!config) {
    throw new Error(`Unsupported chain: ${chain}`);
  }
  return config;
}

/**
 * Check if a chain supports a given DEX.
 */
export function chainSupportsDex(chain: SupportedChain, dex: SupportedDex): boolean {
  try {
    const config = getChainConfig(chain);
    return config.supportedDexes.includes(dex);
  } catch {
    return false;
  }
}

/**
 * Get all supported chain IDs.
 */
export function getSupportedChains(): SupportedChain[] {
  return Object.values(CHAIN_CONFIGS).map((c) => c.id);
}

/**
 * HyperLiquid default asset leverage configurations.
 * Based on the source backend's hyperLiquidAssets.ts
 */
export const HYPERLIQUID_DEFAULT_ASSETS: Record<string, { maxLeverage: number; defaultLeverage: number }> = {
  BTC: { maxLeverage: 40, defaultLeverage: 10 },
  ETH: { maxLeverage: 25, defaultLeverage: 5 },
  SOL: { maxLeverage: 20, defaultLeverage: 5 },
  AVAX: { maxLeverage: 20, defaultLeverage: 5 },
  BNB: { maxLeverage: 15, defaultLeverage: 5 },
  ARB: { maxLeverage: 20, defaultLeverage: 5 },
  OP: { maxLeverage: 20, defaultLeverage: 5 },
  MATIC: { maxLeverage: 20, defaultLeverage: 5 },
  LINK: { maxLeverage: 20, defaultLeverage: 5 },
  DOGE: { maxLeverage: 20, defaultLeverage: 5 },
  LTC: { maxLeverage: 20, defaultLeverage: 5 },
  ADA: { maxLeverage: 20, defaultLeverage: 5 },
  DOT: { maxLeverage: 20, defaultLeverage: 5 },
  ATOM: { maxLeverage: 20, defaultLeverage: 5 },
  NEAR: { maxLeverage: 20, defaultLeverage: 5 },
  APT: { maxLeverage: 20, defaultLeverage: 5 },
  SUI: { maxLeverage: 20, defaultLeverage: 5 },
  TIA: { maxLeverage: 20, defaultLeverage: 5 },
  INJ: { maxLeverage: 20, defaultLeverage: 5 },
  SEI: { maxLeverage: 20, defaultLeverage: 5 },
};
