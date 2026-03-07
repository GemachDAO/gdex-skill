/**
 * Copy trading actions — configure and manage copy trade wallets.
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import {
  CopyTradeSettings,
  CopyTradeWallet,
  AddWalletParams,
  RemoveWalletParams,
  GetCopyTradeSettingsParams,
} from '../types/copyTrade';
import { validateChain, validateRequired } from '../utils/validation';

/**
 * Get copy trade settings for a user.
 *
 * @param client - Authenticated API client
 * @param params - Query parameters
 */
export async function getCopyTradeSettings(
  client: GdexApiClient,
  params: GetCopyTradeSettingsParams
): Promise<CopyTradeSettings> {
  validateRequired(params.userId, 'userId');

  const queryParams: Record<string, unknown> = { userId: params.userId };
  if (params.chain !== undefined) queryParams.chain = params.chain;

  return client.get<CopyTradeSettings>(Endpoints.COPY_TRADE_SETTINGS, queryParams);
}

/**
 * Update copy trade settings for a user.
 *
 * @param client - Authenticated API client
 * @param settings - Updated settings
 */
export async function setCopyTradeSettings(
  client: GdexApiClient,
  settings: CopyTradeSettings
): Promise<void> {
  await client.post<void>(Endpoints.COPY_TRADE_SETTINGS, settings);
}

/**
 * Get all tracked wallets for copy trading.
 *
 * @param client - Authenticated API client
 * @param userId - User ID
 */
export async function getCopyTradeWallets(
  client: GdexApiClient,
  userId: string
): Promise<CopyTradeWallet[]> {
  validateRequired(userId, 'userId');
  return client.get<CopyTradeWallet[]>(Endpoints.COPY_TRADE_WALLETS, { userId });
}

/**
 * Add a wallet to copy trade tracking.
 *
 * @param client - Authenticated API client
 * @param params - Add wallet parameters
 */
export async function addCopyTradeWallet(
  client: GdexApiClient,
  params: AddWalletParams
): Promise<void> {
  validateRequired(params.walletAddress, 'walletAddress');
  validateChain(params.chain);

  await client.post<void>(Endpoints.COPY_TRADE_WALLET_ADD, params);
}

/**
 * Remove a wallet from copy trade tracking.
 *
 * @param client - Authenticated API client
 * @param params - Remove wallet parameters
 */
export async function removeCopyTradeWallet(
  client: GdexApiClient,
  params: RemoveWalletParams
): Promise<void> {
  validateRequired(params.walletAddress, 'walletAddress');
  validateChain(params.chain);

  await client.post<void>(Endpoints.COPY_TRADE_WALLET_REMOVE, params);
}
