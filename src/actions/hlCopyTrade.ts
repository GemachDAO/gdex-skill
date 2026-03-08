/**
 * HyperLiquid perpetual futures copy trading actions.
 *
 * Completely separate from Solana spot copy trading:
 *   - Operates on EVM chain (chainId = 1)
 *   - Copies perpetual futures positions (long/short)
 *   - Supports opposite-direction copy trading
 *   - isChangeStatus DELETES the trade (same as Solana — does NOT toggle)
 *
 * ABI schemas:
 *   hl_create (8 fields, all strings):
 *     [traderWallet, copyTradeName, copyMode, fixedAmountCostPerOrder,
 *      lossPercent, profitPercent, nonce, oppositeCopy]
 *
 *   hl_update (11 fields, all strings):
 *     [traderWallet, copyTradeName, copyMode, fixedAmountCostPerOrder,
 *      lossPercent, profitPercent, nonce, isDelete, isChangeStatus,
 *      copyTradeId, oppositeCopy]
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import type {
  HlCopyTradeListParams,
  HlCopyTradeListResponse,
  HlCopyTradeTxListParams,
  HlCopyTradeTxListResponse,
  CreateHlCopyTradeParams,
  CreateHlCopyTradeResponse,
  UpdateHlCopyTradeParams,
  UpdateHlCopyTradeResponse,
  HlTopTradersResponse,
  HlUserStatsResponse,
  HlPerpDexesResponse,
  HlAllAssetsResponse,
  HlDepositTokensResponse,
} from '../types/hlCopyTrade';
import { validateRequired } from '../utils/validation';
import { buildHlComputedData } from '../utils/gdexManagedCrypto';

// ── Discovery (no auth) ─────────────────────────────────────────────────────

/**
 * Get top traders ranked by volume, trade count, or deposit. No auth. Cached 15 min.
 *
 * @param sort - "volume" | "tradeCount" | "deposit" (default: "volume")
 */
export async function getHlTopTraders(
  client: GdexApiClient,
  sort?: string,
): Promise<HlTopTradersResponse> {
  return client.get<HlTopTradersResponse>(Endpoints.HL_TOP_TRADERS, sort ? { sort } : undefined);
}

/**
 * Get top 30 traders ranked by PnL. No auth. Cached 15 min.
 */
export async function getHlTopTradersByPnl(
  client: GdexApiClient,
): Promise<HlTopTradersResponse> {
  return client.get<HlTopTradersResponse>(Endpoints.HL_TOP_TRADERS_BY_PNL);
}

/**
 * Get detailed trading stats for a user. No auth. Cached 1 hour.
 *
 * NOTE: Requires the MANAGED wallet address (not the control wallet).
 * The control wallet and external trader wallets return "Wallet not found".
 *
 * @param userAddress - Managed EVM wallet address
 */
export async function getHlUserStats(
  client: GdexApiClient,
  userAddress: string,
): Promise<HlUserStatsResponse> {
  validateRequired(userAddress, 'userAddress');
  return client.get<HlUserStatsResponse>(Endpoints.HL_USER_STATS, { user: userAddress });
}

/**
 * Get available perpetual DEX list. No auth.
 */
export async function getHlPerpDexes(
  client: GdexApiClient,
): Promise<HlPerpDexesResponse> {
  return client.get<HlPerpDexesResponse>(Endpoints.HL_PERP_DEXES);
}

/**
 * Get all tradeable assets. No auth.
 */
export async function getHlAllAssets(
  client: GdexApiClient,
): Promise<HlAllAssetsResponse> {
  return client.get<HlAllAssetsResponse>(Endpoints.HL_ALL_ASSETS);
}

/**
 * Get clearinghouse state (account state) for a user on a specific DEX. No auth.
 *
 * @param userAddress - EVM wallet address
 */
export async function getHlClearinghouseState(
  client: GdexApiClient,
  userAddress: string,
): Promise<unknown> {
  validateRequired(userAddress, 'userAddress');
  return client.get<unknown>(Endpoints.HL_CLEARINGHOUSE_STATE, { address: userAddress });
}

/**
 * Get clearinghouse state across all DEXes for a user. No auth.
 *
 * @param userAddress - EVM wallet address
 */
export async function getHlClearinghouseStateAll(
  client: GdexApiClient,
  userAddress: string,
): Promise<unknown> {
  validateRequired(userAddress, 'userAddress');
  return client.get<unknown>(Endpoints.HL_CLEARINGHOUSE_STATE_ALL, { address: userAddress });
}

/**
 * Get open orders on a specific DEX. No auth.
 *
 * @param userAddress - EVM wallet address
 */
export async function getHlOpenOrdersForCopy(
  client: GdexApiClient,
  userAddress: string,
): Promise<unknown> {
  validateRequired(userAddress, 'userAddress');
  return client.get<unknown>(Endpoints.HL_OPEN_ORDERS, { address: userAddress });
}

/**
 * Get open orders across all DEXes. No auth.
 *
 * @param userAddress - EVM wallet address
 */
export async function getHlOpenOrdersAllForCopy(
  client: GdexApiClient,
  userAddress: string,
): Promise<unknown> {
  validateRequired(userAddress, 'userAddress');
  return client.get<unknown>(Endpoints.HL_OPEN_ORDERS_ALL, { address: userAddress });
}

/**
 * Get market metadata and asset contexts. No auth.
 */
export async function getHlMetaAndAssetCtxs(
  client: GdexApiClient,
): Promise<unknown> {
  return client.get<unknown>(Endpoints.HL_META_AND_ASSET_CTXS);
}

/**
 * Get supported deposit tokens. No auth.
 */
export async function getHlDepositTokens(
  client: GdexApiClient,
): Promise<HlDepositTokensResponse> {
  return client.get<HlDepositTokensResponse>(Endpoints.HL_DEPOSIT_TOKENS);
}

/**
 * Get USDC balance on Arbitrum. No auth.
 *
 * @param userAddress - EVM wallet address
 */
export async function getHlUsdcBalanceForCopy(
  client: GdexApiClient,
  userAddress: string,
): Promise<unknown> {
  validateRequired(userAddress, 'userAddress');
  return client.get<unknown>(Endpoints.HL_USDC_BALANCE, { address: userAddress });
}

// ── Read (session-key auth) ─────────────────────────────────────────────────

/**
 * List all HL copy trade configurations for a user.
 * Requires session-key auth: userId + AES-encrypted session key in `data`.
 */
export async function getHlCopyTradeList(
  client: GdexApiClient,
  params: HlCopyTradeListParams,
): Promise<HlCopyTradeListResponse> {
  validateRequired(params.userId, 'userId');
  validateRequired(params.data, 'data');

  return client.get<HlCopyTradeListResponse>(Endpoints.HL_COPY_LIST, {
    userId: params.userId,
    data: params.data,
  });
}

/**
 * Get HL copy trade fill history with enrichment (copyTradeName, traderTxHash, etc.).
 * Requires session-key auth. Cached 15 seconds.
 */
export async function getHlCopyTradeTxList(
  client: GdexApiClient,
  params: HlCopyTradeTxListParams,
): Promise<HlCopyTradeTxListResponse> {
  validateRequired(params.userId, 'userId');
  validateRequired(params.data, 'data');

  return client.get<HlCopyTradeTxListResponse>(Endpoints.HL_COPY_TX_LIST, {
    userId: params.userId,
    data: params.data,
    page: params.page ?? '1',
    limit: params.limit ?? '10',
  });
}

// ── Write (computedData auth) ───────────────────────────────────────────────

/**
 * Create a new HL perpetual futures copy trade.
 *
 * ABI (hl_create, 8 fields, all strings):
 *   [traderWallet, copyTradeName, copyMode, fixedAmountCostPerOrder,
 *    lossPercent, profitPercent, nonce, oppositeCopy]
 * Signature: "hl_create-{userId}-{dataHex}"
 */
export async function createHlCopyTrade(
  client: GdexApiClient,
  params: CreateHlCopyTradeParams,
): Promise<CreateHlCopyTradeResponse> {
  validateRequired(params.traderWallet, 'traderWallet');
  validateRequired(params.copyTradeName, 'copyTradeName');
  validateRequired(params.lossPercent, 'lossPercent');
  validateRequired(params.profitPercent, 'profitPercent');
  validateRequired(params.fixedAmountCostPerOrder, 'fixedAmountCostPerOrder');

  const computedData = buildHlComputedData({
    action: 'hl_create',
    apiKey: params.apiKey,
    walletAddress: params.userId,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: {
      traderWallet: params.traderWallet,
      copyTradeName: params.copyTradeName,
      copyMode: String(params.copyMode),
      fixedAmountCostPerOrder: params.fixedAmountCostPerOrder,
      lossPercent: params.lossPercent,
      profitPercent: params.profitPercent,
      oppositeCopy: params.oppositeCopy ? '1' : '',
    },
  });

  return client.post<CreateHlCopyTradeResponse>(Endpoints.HL_COPY_CREATE, {
    computedData,
  });
}

/**
 * Update, toggle, or delete an HL perpetual futures copy trade.
 *
 * ABI (hl_update, 11 fields, all strings):
 *   [traderWallet, copyTradeName, copyMode, fixedAmountCostPerOrder,
 *    lossPercent, profitPercent, nonce, isDelete, isChangeStatus,
 *    copyTradeId, oppositeCopy]
 * Signature: "hl_update-{userId}-{dataHex}"
 *
 * WARNING: isChangeStatus DELETES the trade (same as Solana). It does NOT toggle.
 */
export async function updateHlCopyTrade(
  client: GdexApiClient,
  params: UpdateHlCopyTradeParams,
): Promise<UpdateHlCopyTradeResponse> {
  validateRequired(params.copyTradeId, 'copyTradeId');
  validateRequired(params.traderWallet, 'traderWallet');

  const computedData = buildHlComputedData({
    action: 'hl_update',
    apiKey: params.apiKey,
    walletAddress: params.userId,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: {
      traderWallet: params.traderWallet,
      copyTradeName: params.copyTradeName,
      copyMode: String(params.copyMode),
      fixedAmountCostPerOrder: params.fixedAmountCostPerOrder,
      lossPercent: params.lossPercent,
      profitPercent: params.profitPercent,
      isDelete: params.isDelete ? '1' : '',
      isChangeStatus: params.isChangeStatus ? '1' : '',
      copyTradeId: params.copyTradeId,
      oppositeCopy: params.oppositeCopy ? '1' : '',
    },
  });

  return client.post<UpdateHlCopyTradeResponse>(Endpoints.HL_COPY_UPDATE, {
    computedData,
  });
}
