import { SupportedChain, ChainId, NonEvmChain } from '../types/common';

const NON_EVM_CHAIN_IDS: Record<NonEvmChain, number> = {
  solana: ChainId.SOLANA,
  sui: ChainId.SUI,
};

export function buildChainAliases(chain?: SupportedChain): Record<string, unknown> {
  if (chain === undefined) return {};
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
