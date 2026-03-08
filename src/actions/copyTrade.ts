/**
 * Copy trading actions.
 *
 * Backend routes under /v1/copy_trade/:
 *   GET  /list           — user's copy trade configs (session-key auth)
 *   GET  /tx_list        — copy trade tx history (session-key auth)
 *   POST /create         — create copy trade (computedData + signature)
 *   POST /update         — update/toggle/delete copy trade (computedData)
 *   GET  /wallets        — top 300 by totalPnl (no auth, cached 2min)
 *   GET  /custom_wallets — top 300 by net received (no auth, cached 2min)
 *   GET  /gems           — hot new tokens (no auth, cached 20s)
 *   GET  /dexes_list     — supported DEXes for a chain (no auth)
 *
 * Write operations are Solana-only.
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import {
  CopyTradeWallet,
  CopyTradeDexListResponse,
  CopyTradeListParams,
  CopyTradeListResponse,
  CopyTradeTxListParams,
  CopyTradeTxListResponse,
  CreateCopyTradeParams,
  CreateCopyTradeResponse,
  UpdateCopyTradeParams,
  UpdateCopyTradeResponse,
} from '../types/copyTrade';
import { validateRequired } from '../utils/validation';
import { buildCopyTradeComputedData } from '../utils/gdexManagedCrypto';

// ── Discovery (no auth) ─────────────────────────────────────────────────────

/**
 * Top 300 wallets ranked by totalPnl. No auth required. Cached 2 minutes.
 */
export async function getCopyTradeWallets(
  client: GdexApiClient,
): Promise<CopyTradeWallet[]> {
  return client.get<CopyTradeWallet[]>(Endpoints.COPY_TRADE_WALLETS);
}

/**
 * Top 300 wallets ranked by receivedMinusSpent (net profit). No auth. Cached 2 min.
 */
export async function getCopyTradeCustomWallets(
  client: GdexApiClient,
): Promise<CopyTradeWallet[]> {
  return client.get<CopyTradeWallet[]>(Endpoints.COPY_TRADE_CUSTOM_WALLETS);
}

/**
 * Hot new tokens heavily traded by top wallets. No auth. Cached 20s.
 * Returns an empty array when no gems are detected.
 */
export async function getCopyTradeGems(
  client: GdexApiClient,
): Promise<unknown[]> {
  return client.get<unknown[]>(Endpoints.COPY_TRADE_GEMS);
}

/**
 * List supported DEXes for a given chain.
 */
export async function getCopyTradeDexes(
  client: GdexApiClient,
  chainId: number,
): Promise<CopyTradeDexListResponse> {
  return client.get<CopyTradeDexListResponse>(Endpoints.COPY_TRADE_DEXES_LIST, { chainId });
}

// ── Read (session-key auth) ─────────────────────────────────────────────────

/**
 * List all copy trade configurations for a user.
 *
 * Requires session-key auth: userId + AES-encrypted session key in `data`.
 * Results are cached per-user for 20 seconds.
 */
export async function getCopyTradeList(
  client: GdexApiClient,
  params: CopyTradeListParams,
): Promise<CopyTradeListResponse> {
  validateRequired(params.userId, 'userId');
  validateRequired(params.data, 'data');

  return client.get<CopyTradeListResponse>(Endpoints.COPY_TRADE_LIST, {
    userId: params.userId,
    data: params.data,
  });
}

/**
 * List copy trade transaction history for a user, with PnL calculations.
 *
 * Requires session-key auth: userId + AES-encrypted session key in `data`.
 */
export async function getCopyTradeTxList(
  client: GdexApiClient,
  params: CopyTradeTxListParams,
): Promise<CopyTradeTxListResponse> {
  validateRequired(params.userId, 'userId');
  validateRequired(params.data, 'data');

  return client.get<CopyTradeTxListResponse>(Endpoints.COPY_TRADE_TX_LIST, {
    userId: params.userId,
    data: params.data,
  });
}

// ── Write (computedData auth, Solana only) ──────────────────────────────────

/**
 * Create a new copy trade configuration.
 *
 * ABI (create_copy_trade, 12 fields):
 *   [traderWallet, copyTradeName, chainId, gasPrice, buyMode, copyBuyAmount,
 *    isBuyExistingToken, lossPercent, profitPercent, nonce, copySell, excludedDexNumbers]
 * Signature message: "create_copy_trade-{userId}-{data}"
 */
export async function createCopyTrade(
  client: GdexApiClient,
  params: CreateCopyTradeParams,
): Promise<CreateCopyTradeResponse> {
  validateRequired(params.traderWallet, 'traderWallet');
  validateRequired(params.copyTradeName, 'copyTradeName');
  validateRequired(params.lossPercent, 'lossPercent');
  validateRequired(params.profitPercent, 'profitPercent');

  const computedData = buildCopyTradeComputedData({
    action: 'create_copy_trade',
    apiKey: params.apiKey,
    userId: params.userId,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: {
      traderWallet: params.traderWallet,
      copyTradeName: params.copyTradeName,
      chainId: String(params.chainId),
      gasPrice: params.gasPrice ?? '0',
      buyMode: String(params.buyMode),
      copyBuyAmount: params.copyBuyAmount,
      isBuyExistingToken: params.isBuyExistingToken ? '1' : '',
      lossPercent: params.lossPercent,
      profitPercent: params.profitPercent,
      copySell: params.copySell ? '1' : '',
      excludedDexNumbers: (params.excludedDexNumbers ?? []).join(','),
    },
  });

  return client.post<CreateCopyTradeResponse>(Endpoints.COPY_TRADE_CREATE, {
    computedData,
  });
}

/**
 * Update or delete an existing copy trade.
 *
 * ABI (update_copy_trade, 16 fields, chainId is uint256):
 *   [traderWallet, copyTradeName, chainId(uint256), gasPrice, buyMode, copyBuyAmount,
 *    isBuyExistingToken, lossPercent, profitPercent, nonce, copySell,
 *    excludedDexNumbers, copyTradeId, isDelete, isChangeStatus, excludedProgramIds]
 * Signature message: "update_copy_trade-{userId}-{data}"
 *
 * To delete: set isDelete = true.
 * Note: isChangeStatus also triggers deletion on the backend.
 */
export async function updateCopyTrade(
  client: GdexApiClient,
  params: UpdateCopyTradeParams,
): Promise<UpdateCopyTradeResponse> {
  validateRequired(params.copyTradeId, 'copyTradeId');
  validateRequired(params.traderWallet, 'traderWallet');

  const computedData = buildCopyTradeComputedData({
    action: 'update_copy_trade',
    apiKey: params.apiKey,
    userId: params.userId,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: {
      traderWallet: params.traderWallet,
      copyTradeName: params.copyTradeName,
      chainId: String(params.chainId),
      gasPrice: params.gasPrice ?? '0',
      buyMode: String(params.buyMode),
      copyBuyAmount: params.copyBuyAmount,
      isBuyExistingToken: params.isBuyExistingToken ? '1' : '',
      lossPercent: params.lossPercent,
      profitPercent: params.profitPercent,
      copySell: params.copySell ? '1' : '',
      excludedDexNumbers: (params.excludedDexNumbers ?? []).join(','),
      copyTradeId: params.copyTradeId,
      isDelete: params.isDelete ? '1' : '',
      isChangeStatus: params.isChangeStatus ? '1' : '',
      excludedProgramIds: (params.excludedProgramIds ?? []).join(','),
    },
  });

  return client.post<UpdateCopyTradeResponse>(Endpoints.COPY_TRADE_UPDATE, {
    computedData,
  });
}
