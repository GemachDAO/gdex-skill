/**
 * Wallet action — get wallet information and balances.
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import { WalletInfo, WalletInfoParams } from '../types';
import { validateChain, validateRequired } from '../utils/validation';

/**
 * Get wallet information including native token balance.
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

  return client.get<WalletInfo>(Endpoints.WALLET_INFO, {
    walletAddress: params.walletAddress,
    chain: params.chain,
  });
}
