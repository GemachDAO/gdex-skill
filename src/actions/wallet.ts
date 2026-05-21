/**
 * Wallet action — get wallet information and balances.
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import { WalletInfo, WalletInfoParams } from '../types';
import { validateChain, validateRequired } from '../utils/validation';
import { buildChainAliases, buildWalletAliases } from '../utils/apiAliases';

/**
 * Get wallet information including native token balance.
 *
 * On backend v1.1.0 there is no `/v1/wallet/info` route — wallet info is
 * derived from `/v1/portfolio` (balances embedded under
 * `portfolio.balances[]`).
 *
 * @param client - API client
 * @param params - Wallet parameters
 */
export async function getWalletInfo(
  client: GdexApiClient,
  params: WalletInfoParams
): Promise<WalletInfo> {
  validateRequired(params.walletAddress, 'walletAddress');
  validateChain(params.chain);

  const query = {
    ...buildWalletAliases(params.walletAddress),
    ...buildChainAliases(params.chain),
  };

  const portfolio = await client.get<{
    totalValueUsd?: string;
    balances?: Array<{ chain?: unknown; balance?: string; symbol?: string }>;
  }>(Endpoints.PORTFOLIO, query);

  const balances = Array.isArray(portfolio?.balances) ? portfolio.balances : [];
  const native = balances.find((b) => b.chain === params.chain) ?? balances[0];

  return {
    address: params.walletAddress,
    chain: params.chain,
    nativeBalance: native?.balance ?? '0',
    nativeSymbol: native?.symbol ?? 'N/A',
    totalValueUsd: portfolio?.totalValueUsd,
    tokenCount: balances.length,
  };
}
