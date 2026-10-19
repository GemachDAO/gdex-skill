import { SupportedChain, ChainId, NonEvmChain } from '../types/common';
import { normalizeChain } from '../config/chains';

const NON_EVM_CHAIN_IDS: Record<NonEvmChain, number> = {
  solana: ChainId.SOLANA,
  sui: ChainId.SUI,
};

/**
 * Canonical wire form of a chain: the numeric ChainId, except that string
 * Solana/Sui names stay as the legacy 'solana' / 'sui' strings the backend
 * already accepts. Names like 'base' or '8453' become 8453.
 *
 * @throws {GdexValidationError} if the chain is unknown
 */
export function toWireChain(chain: SupportedChain): SupportedChain {
  if (typeof chain === 'number') return chain;
  const { id, family } = normalizeChain(chain);
  return family === 'evm' ? id : family;
}

export function buildChainAliases(input?: SupportedChain): Record<string, unknown> {
  if (input === undefined) return {};
  const chain = toWireChain(input);
  if (typeof chain === 'number') {
    return {
      chain,
      chainId: chain,
    };
  }
  // Non-EVM string chains ('solana' / 'sui') still need the numeric chainId the
  // backend filters on; without it, discovery endpoints return empty results.
  return {
    chain,
    chainId: NON_EVM_CHAIN_IDS[chain],
  };
}

export function buildTokenAliases(tokenAddress: string): Record<string, unknown> {
  return {
    tokenAddress,
    token: tokenAddress,
  };
}

export function buildWalletAliases(walletAddress?: string): Record<string, unknown> {
  if (!walletAddress) return {};
  return {
    walletAddress,
    wallet: walletAddress,
  };
}

export function pickRequestId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;
  const requestId = p.requestId;
  const jobId = p.jobId;
  if (typeof requestId === 'string' && requestId.length > 0) return requestId;
  if (typeof jobId === 'string' && jobId.length > 0) return jobId;
  return undefined;
}
