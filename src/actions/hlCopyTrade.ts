/**
 * HyperLiquid perpetual futures copy trading actions.
 *
 * Completely separate from Solana spot copy trading:
 *   - Operates on EVM chain (chainId = 1)
 *   - Copies perpetual futures positions (long/short)
 *   - Supports opposite-direction copy trading
 *
 * /hl/update semantics (backend ServiceHyperLiquid.update):
 *   - isDelete       → HLFuturesCopySetting.deleteOne. Copied perp positions are NOT
 *                      closed and their TP/SL orders are NOT cancelled.
 *   - isChangeStatus → isActive = !existing.isActive (a relative toggle, not delete).
 *                      The copier only mirrors isActive:true settings
 *                      (copyTradeHyperLiquid.ts), so an inactive config mirrors
 *                      neither opens nor closes.
 *   - every other field is rewritten from the payload on each non-delete update.
 *
 * ABI schemas (typed as backend src/shared/parser/evm/decoder.ts decodes them):
 *   hl_create (8 fields):
 *     [traderWallet, copyTradeName, copyMode(uint64), fixedAmountCostPerOrder,
 *      lossPercent, profitPercent, nonce, oppositeCopy(bool)]
 *
 *   hl_update (11 fields):
 *     [traderWallet, copyTradeName, copyMode(uint64), fixedAmountCostPerOrder,
 *      lossPercent, profitPercent, nonce, isDelete(bool), isChangeStatus(bool),
 *      copyTradeId, oppositeCopy(bool)]
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import type {
  HlCopyTradeConfig,
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
  UpdateHlCopyTradeSettingsParams,
} from '../types/hlCopyTrade';
import type { CopyTradeControlParams, CopyTradeControlResult } from '../types/copyTrade';
import { GdexErrorCode } from '../types/common';
import { GdexError, GdexValidationError } from '../utils/errors';
import { validateRequired, validateAmount, parseRawAmount } from '../utils/validation';
import { buildHlComputedData, buildGdexReadSessionData } from '../utils/gdexManagedCrypto';

/** Normalise a string-or-object address argument used by HL read endpoints. */
function normalizeAddressArg(
  arg: string | { userAddress: string; dex?: string },
): { address: string; dex?: string } {
  if (typeof arg === 'string') return { address: arg };
  return { address: arg.userAddress, dex: arg.dex };
}

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
 * @param userAddress - EVM wallet address (or `{ userAddress, dex }` for HIP-3 multi-dex)
 */
export async function getHlClearinghouseState(
  client: GdexApiClient,
  userAddress: string | { userAddress: string; dex?: string },
): Promise<unknown> {
  const { address, dex } = normalizeAddressArg(userAddress);
  validateRequired(address, 'userAddress');
  const query: Record<string, unknown> = { address };
  if (dex) query.dex = dex;
  return client.get<unknown>(Endpoints.HL_CLEARINGHOUSE_STATE, query);
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
 * @param userAddress - EVM wallet address (or `{ userAddress, dex }` for HIP-3 multi-dex)
 */
export async function getHlOpenOrdersForCopy(
  client: GdexApiClient,
  userAddress: string | { userAddress: string; dex?: string },
): Promise<unknown> {
  const { address, dex } = normalizeAddressArg(userAddress);
  validateRequired(address, 'userAddress');
  const query: Record<string, unknown> = { address };
  if (dex) query.dex = dex;
  return client.get<unknown>(Endpoints.HL_OPEN_ORDERS, query);
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
 *
 * @param dex - Optional perp-dex identifier for HIP-3 deployments
 */
export async function getHlMetaAndAssetCtxs(
  client: GdexApiClient,
  dex?: string,
): Promise<unknown> {
  if (dex) {
    return client.get<unknown>(Endpoints.HL_META_AND_ASSET_CTXS, { dex });
  }
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
 * Check the numeric HL copy-trade fields before signing. Backend
 * (gbotTradingDashboardBackend ServiceHyperLiquid.ts:322-331 hl_create, same in
 * hl_update): copyMode 1 reads fixedAmountCostPerOrder as raw USDC with 6
 * decimals (copyTradeHyperLiquid.ts:372-375; gdex.pro sends
 * `toBigNumber(usd, 6)`, UI perp/page.tsx:409-412), so it must be a positive
 * integer ("50000000" = $50); copyMode 2 sends a percentage. lossPercent and
 * profitPercent must be non-zero decimals.
 */
function checkHlCopyTradeNumbers(p: { copyMode?: number; fixedAmountCostPerOrder?: string; lossPercent?: string; profitPercent?: string }): void {
  if (p.copyMode !== 1 && p.copyMode !== 2) {
    throw new GdexValidationError(`copyMode must be 1 (fixed USDC) or 2 (proportion), got ${JSON.stringify(p.copyMode)}`, 'copyMode');
  }
  const amount = String(p.fixedAmountCostPerOrder ?? '');
  if (p.copyMode === 1) parseRawAmount(amount, 'fixedAmountCostPerOrder');
  else validateAmount(amount, 'fixedAmountCostPerOrder');
  validateAmount(String(p.lossPercent ?? ''), 'lossPercent');
  validateAmount(String(p.profitPercent ?? ''), 'profitPercent');
}

/**
 * Create a new HL perpetual futures copy trade.
 *
 * ABI (hl_create, 8 fields):
 *   [traderWallet, copyTradeName, copyMode(uint64), fixedAmountCostPerOrder,
 *    lossPercent, profitPercent, nonce, oppositeCopy(bool)]
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
  checkHlCopyTradeNumbers(params);

  const computedData = buildHlComputedData({
    action: 'hl_create',
    apiKey: params.apiKey,
    walletAddress: params.userId,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: {
      traderWallet: params.traderWallet,
      copyTradeName: params.copyTradeName,
      copyMode: params.copyMode,
      fixedAmountCostPerOrder: params.fixedAmountCostPerOrder,
      lossPercent: params.lossPercent,
      profitPercent: params.profitPercent,
      oppositeCopy: params.oppositeCopy === true,
    },
  });

  return client.post<CreateHlCopyTradeResponse>(Endpoints.HL_COPY_CREATE, {
    computedData,
  });
}

/**
 * Low-level HL copy-trade update (legacy). Prefer {@link updateHlCopyTradeSettings},
 * {@link deleteHlCopyTrade}, {@link pauseHlCopyTrade} or {@link resumeHlCopyTrade}.
 *
 * ABI (hl_update, 11 fields):
 *   [traderWallet, copyTradeName, copyMode(uint64), fixedAmountCostPerOrder,
 *    lossPercent, profitPercent, nonce, isDelete(bool), isChangeStatus(bool),
 *    copyTradeId, oppositeCopy(bool)]
 * Signature: "hl_update-{userId}-{dataHex}"
 *
 * isDelete deletes the configuration (positions stay open). isChangeStatus
 * TOGGLES isActive. Passing both is rejected.
 */
export async function updateHlCopyTrade(
  client: GdexApiClient,
  params: UpdateHlCopyTradeParams,
): Promise<UpdateHlCopyTradeResponse> {
  validateRequired(params.copyTradeId, 'copyTradeId');
  validateRequired(params.traderWallet, 'traderWallet');
  if (params.isDelete === true && params.isChangeStatus === true) {
    throw new GdexValidationError(
      'isDelete and isChangeStatus cannot both be set: isDelete removes the configuration, isChangeStatus toggles isActive',
      'isChangeStatus',
    );
  }
  // Settings changes are checked like a create; delete / pause / resume re-send stored values.
  if (params.isDelete !== true && params.isChangeStatus !== true) checkHlCopyTradeNumbers(params);

  const computedData = buildHlComputedData({
    action: 'hl_update',
    apiKey: params.apiKey,
    walletAddress: params.userId,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: {
      traderWallet: params.traderWallet,
      copyTradeName: params.copyTradeName,
      copyMode: params.copyMode,
      fixedAmountCostPerOrder: params.fixedAmountCostPerOrder,
      lossPercent: params.lossPercent,
      profitPercent: params.profitPercent,
      isDelete: params.isDelete === true,
      isChangeStatus: params.isChangeStatus === true,
      copyTradeId: params.copyTradeId,
      oppositeCopy: params.oppositeCopy === true,
    },
  });

  return client.post<UpdateHlCopyTradeResponse>(Endpoints.HL_COPY_UPDATE, {
    computedData,
  });
}

// ── Explicit controls ───────────────────────────────────────────────────────

/** What deleting does and does not do, from ServiceHyperLiquid.update. */
export const HL_COPY_TRADE_DELETE_NOTE =
  'Configuration deleted. Perp positions already opened by this copy trade were NOT closed and their ' +
  'TP/SL orders were NOT cancelled; close them with the perp tools if you want out. Deletion cannot be undone.';

/** What pausing does and does not do. */
export const HL_COPY_TRADE_PAUSE_NOTE =
  'Copy trade paused (isActive=false). The copier stops mirroring BOTH opens and closes for this ' +
  "configuration, so copied positions stay open and will NOT follow the trader's exits while paused; " +
  'their TP/SL orders stay in place. Resume to mirror again.';

const HL_COPY_TRADE_RESUME_NOTE =
  'Copy trade resumed (isActive=true). New fills by the followed trader are mirrored again; fills made ' +
  'while paused are not replayed.';

async function findHlCopyTradeConfig(
  client: GdexApiClient,
  params: CopyTradeControlParams,
): Promise<HlCopyTradeConfig> {
  validateRequired(params.copyTradeId, 'copyTradeId');
  validateRequired(params.userId, 'userId');
  validateRequired(params.apiKey, 'apiKey');
  validateRequired(params.sessionPrivateKey, 'sessionPrivateKey');
  const data = buildGdexReadSessionData(params.sessionPrivateKey, params.apiKey);
  const list = await getHlCopyTradeList(client, { userId: params.userId, data });
  const configs = Array.isArray(list?.allCopyTrades) ? list.allCopyTrades : null;
  if (!configs) {
    throw new GdexError(
      'Could not read HL copy trade list to confirm the configuration; nothing was sent',
      GdexErrorCode.PAUSE_STATE_UNVERIFIED,
    );
  }
  const config = configs.find((c) => c?.copyTradeId === params.copyTradeId);
  if (!config) {
    throw new GdexError(
      `No HL copy trade ${params.copyTradeId} for this user; nothing was sent`,
      GdexErrorCode.COPY_TRADE_NOT_FOUND,
    );
  }
  return config;
}

function storedCopyMode(config: HlCopyTradeConfig): 1 | 2 | undefined {
  const mode = Number(config.copyMode);
  return mode === 1 || mode === 2 ? mode : undefined;
}

function hlConfigToUpdateFields(
  config: HlCopyTradeConfig,
  overrides: Partial<UpdateHlCopyTradeSettingsParams>,
  operation: CopyTradeControlResult['operation'],
): Omit<UpdateHlCopyTradeParams, 'apiKey' | 'userId' | 'sessionPrivateKey' | 'isDelete' | 'isChangeStatus'> {
  const copyMode = overrides.copyMode ?? storedCopyMode(config);
  if (copyMode !== 1 && copyMode !== 2) {
    throw new GdexError(
      `Stored copyMode ${JSON.stringify(config.copyMode)} is not 1 or 2 (configurations written by SDK <= 4.12 ` +
        'hold an ABI offset such as 416/480). ' +
        (operation === 'update_settings'
          ? 'Pass copyMode, fixedAmountCostPerOrder and oppositeCopy explicitly.'
          : 'Call updateHlCopyTradeSettings with explicit copyMode, fixedAmountCostPerOrder and oppositeCopy first.'),
      GdexErrorCode.COPY_TRADE_CONFIG_INVALID,
    );
  }
  return {
    copyTradeId: config.copyTradeId,
    traderWallet: overrides.traderWallet ?? config.traderWallet,
    copyTradeName: overrides.copyTradeName ?? config.copyTradeName,
    copyMode,
    fixedAmountCostPerOrder: overrides.fixedAmountCostPerOrder ?? String(config.fixedAmountCostPerOrder),
    lossPercent: overrides.lossPercent ?? String(config.lossPercent),
    profitPercent: overrides.profitPercent ?? String(config.profitPercent),
    oppositeCopy: overrides.oppositeCopy ?? config.oppositeCopy === true,
  };
}

/**
 * Change settings of an existing HL copy trade. Never deletes and never changes
 * isActive. Omitted fields keep their current values (read from the list).
 */
export async function updateHlCopyTradeSettings(
  client: GdexApiClient,
  params: UpdateHlCopyTradeSettingsParams,
): Promise<CopyTradeControlResult> {
  const config = await findHlCopyTradeConfig(client, params);
  const fields = hlConfigToUpdateFields(config, params, 'update_settings');
  const response = await updateHlCopyTrade(client, {
    apiKey: params.apiKey,
    userId: params.userId,
    sessionPrivateKey: params.sessionPrivateKey,
    ...fields,
    isDelete: false,
    isChangeStatus: false,
  });
  return {
    operation: 'update_settings',
    copyTradeId: params.copyTradeId,
    submitted: true,
    previousIsActive: typeof config.isActive === 'boolean' ? config.isActive : undefined,
    expectedIsActive: typeof config.isActive === 'boolean' ? config.isActive : undefined,
    note: 'Settings updated; active state unchanged. Open positions are not resized.',
    response,
  };
}

/**
 * Permanently delete an HL copy trade configuration. Does NOT close positions it
 * opened or cancel their TP/SL orders.
 */
export async function deleteHlCopyTrade(
  client: GdexApiClient,
  params: CopyTradeControlParams,
): Promise<CopyTradeControlResult> {
  const config = await findHlCopyTradeConfig(client, params);
  // copyMode is not read on the delete branch; a legacy out-of-range value is
  // replaced with 1 so the payload encodes.
  const fields = hlConfigToUpdateFields(config, storedCopyMode(config) ? {} : { copyMode: 1 }, 'delete');
  const response = await updateHlCopyTrade(client, {
    apiKey: params.apiKey,
    userId: params.userId,
    sessionPrivateKey: params.sessionPrivateKey,
    ...fields,
    isDelete: true,
    isChangeStatus: false,
  });
  return {
    operation: 'delete',
    copyTradeId: params.copyTradeId,
    submitted: true,
    previousIsActive: typeof config.isActive === 'boolean' ? config.isActive : undefined,
    note: HL_COPY_TRADE_DELETE_NOTE,
    response,
  };
}

async function setHlCopyTradeActive(
  client: GdexApiClient,
  params: CopyTradeControlParams,
  active: boolean,
): Promise<CopyTradeControlResult> {
  const operation = active ? 'resume' : 'pause';
  const config = await findHlCopyTradeConfig(client, params);
  if (typeof config.isActive !== 'boolean') {
    throw new GdexError(
      `HL copy trade ${params.copyTradeId} has no readable isActive; refusing to toggle blindly. Nothing was sent.`,
      GdexErrorCode.PAUSE_STATE_UNVERIFIED,
    );
  }
  if (config.isActive === active) {
    return {
      operation,
      copyTradeId: params.copyTradeId,
      submitted: false,
      previousIsActive: config.isActive,
      expectedIsActive: config.isActive,
      note: `Already ${active ? 'active' : 'paused'}; nothing was sent.`,
    };
  }
  let fields;
  try {
    fields = hlConfigToUpdateFields(config, {}, operation);
  } catch (err) {
    if (err instanceof GdexError && err.code === GdexErrorCode.COPY_TRADE_CONFIG_INVALID) {
      throw new GdexError(
        `Cannot ${operation} HL copy trade ${params.copyTradeId}: ${err.message} The toggle rewrites every setting, ` +
          'so it is not sent with an invalid stored value. Alternative: deleteHlCopyTrade stops copying permanently, ' +
          'but positions it opened stay open and their TP/SL orders remain.',
        GdexErrorCode.PAUSE_UNSUPPORTED,
      );
    }
    throw err;
  }
  const response = await updateHlCopyTrade(client, {
    apiKey: params.apiKey,
    userId: params.userId,
    sessionPrivateKey: params.sessionPrivateKey,
    ...fields,
    isDelete: false,
    isChangeStatus: true,
  });
  return {
    operation,
    copyTradeId: params.copyTradeId,
    submitted: true,
    previousIsActive: config.isActive,
    expectedIsActive: active,
    note: active ? HL_COPY_TRADE_RESUME_NOTE : HL_COPY_TRADE_PAUSE_NOTE,
    response,
  };
}

/**
 * Pause an HL copy trade (isActive=false) without deleting it. Reads the current
 * state first because the backend flag is a toggle; no-op when already paused.
 * Never sets isDelete.
 */
export async function pauseHlCopyTrade(
  client: GdexApiClient,
  params: CopyTradeControlParams,
): Promise<CopyTradeControlResult> {
  return setHlCopyTradeActive(client, params, false);
}

/** Resume a paused HL copy trade (isActive=true). No-op when already active. */
export async function resumeHlCopyTrade(
  client: GdexApiClient,
  params: CopyTradeControlParams,
): Promise<CopyTradeControlResult> {
  return setHlCopyTradeActive(client, params, true);
}
