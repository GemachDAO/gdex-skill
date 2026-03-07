import { SupportedChain } from '../types/common';

export function buildChainAliases(chain?: SupportedChain): Record<string, unknown> {
  if (chain === undefined) return {};
  if (typeof chain === 'number') {
    return {
      chain,
      chainId: chain,
    };
  }
  return {
    chain,
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
