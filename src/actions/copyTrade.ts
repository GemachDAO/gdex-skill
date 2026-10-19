/**
 * Copy trading actions.
 *
 * Backend routes under /v1/copy_trade/:
 *   GET  /list           — user's copy trade configs (session-key auth)
 *   GET  /tx_list        — copy trade tx history (session-key auth)
 *   POST /create         — create copy trade (computedData + signature)
 *   POST /update         — update settings / toggle isActive / delete (computedData)
 *   GET  /wallets        — top 300 by totalPnl (no auth, cached 2min)
 *   GET  /custom_wallets — top 300 by net received (no auth, cached 2min)
 *   GET  /gems           — hot new tokens (no auth, cached 20s)
 *   GET  /dexes_list     — supported DEXes for a chain (no auth)
 *
 * Write operations are Solana-only.
 *
 * /update semantics (backend ServiceCopyTrade.update):
 *   - isDelete       → CopyTradeSetting.deleteOne (and the WalletTrade tracking row
 *                      when no other follower copies that trader). Copied positions
 *                      are NOT sold and their TP/SL limit orders are NOT cancelled.
 *   - isChangeStatus → isActive = !existing.isActive (a relative toggle). The copier
 *                      only mirrors isActive:true settings (copyTradeSolana.ts), so an
 *                      inactive config copies neither buys nor sells.
 *   - every other field is rewritten from the payload on each non-delete update.
 * Use the explicit operations below (updateCopyTradeSettings, deleteCopyTrade,
 * pauseCopyTrade, resumeCopyTrade) rather than raw flags.
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import {
  CopyTradeConfig,
  CopyTradeControlParams,
  CopyTradeControlResult,
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
  UpdateCopyTradeSettingsParams,
} from '../types/copyTrade';
import { GdexErrorCode } from '../types/common';
import { GdexError, GdexValidationError } from '../utils/errors';
import { validateRequired, validateAmount, parseAmountUnits } from '../utils/validation';
import { buildCopyTradeComputedData, buildGdexReadSessionData } from '../utils/gdexManagedCrypto';

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
 * Check the numeric copy-trade fields before signing, against the backend's
 * reading of them (gbotTradingDashboardBackend ServiceCopyTrade.ts create
 * :466-479, :507-509; update applies the same checks):
 * - buyMode 1: copyBuyAmount is SOL per copied buy in whole units (stored as
 *   copyBuyFixedAmount and spent by copyTradeSolana.ts:419-421), so at most 9 decimals.
 * - buyMode 2: copyBuyAmount is a percentage in (0, 100].
 * - lossPercent in (0, 100); profitPercent > 0. Plain decimals only.
 */
function checkCopyTradeNumbers(p: { buyMode?: number; copyBuyAmount?: string; lossPercent?: string; profitPercent?: string }): void {
  if (p.buyMode !== 1 && p.buyMode !== 2) {
    throw new GdexValidationError(`buyMode must be 1 (fixed SOL) or 2 (percentage), got ${JSON.stringify(p.buyMode)}`, 'buyMode');
  }
  const amount = String(p.copyBuyAmount ?? '');
  if (p.buyMode === 1) {
    parseAmountUnits(amount, 9, 'copyBuyAmount');
  } else {
    validateAmount(amount, 'copyBuyAmount');
    if (Number(amount) > 100) throw new GdexValidationError(`copyBuyAmount is a percentage in buyMode 2 and must be at most 100, got "${amount}"`, 'copyBuyAmount');
  }
  const loss = String(p.lossPercent ?? '');
  validateAmount(loss, 'lossPercent');
  if (Number(loss) >= 100) throw new GdexValidationError(`lossPercent must be below 100, got "${loss}"`, 'lossPercent');
  validateAmount(String(p.profitPercent ?? ''), 'profitPercent');
}

/**
 * Create a new copy trade configuration.
 *
 * ABI (create_copy_trade, 12 fields, typed as the backend decodes it):
 *   [traderWallet, copyTradeName, chainId(uint64), gasPrice, buyMode(uint64), copyBuyAmount,
 *    isBuyExistingToken(bool), lossPercent, profitPercent, nonce, copySell(bool),
 *    excludedDexNumbers(uint64[])]
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
  checkCopyTradeNumbers(params);

  const computedData = buildCopyTradeComputedData({
    action: 'create_copy_trade',
    apiKey: params.apiKey,
    userId: params.userId,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: {
      traderWallet: params.traderWallet,
      copyTradeName: params.copyTradeName,
      chainId: params.chainId,
      gasPrice: params.gasPrice ?? '0',
      buyMode: params.buyMode,
      copyBuyAmount: params.copyBuyAmount,
      isBuyExistingToken: params.isBuyExistingToken === true,
      lossPercent: params.lossPercent,
      profitPercent: params.profitPercent,
      copySell: params.copySell === true,
      excludedDexNumbers: params.excludedDexNumbers ?? [],
    },
  });

  return client.post<CreateCopyTradeResponse>(Endpoints.COPY_TRADE_CREATE, {
    computedData,
  });
}

/**
 * Low-level update (legacy). Prefer {@link updateCopyTradeSettings},
 * {@link deleteCopyTrade}, {@link pauseCopyTrade} or {@link resumeCopyTrade}.
 *
 * ABI (update_copy_trade, 15 fields, typed as the backend decodes it):
 *   [traderWallet, copyTradeName, chainId(uint64), gasPrice, buyMode(uint64), copyBuyAmount,
 *    isBuyExistingToken(bool), lossPercent, profitPercent, nonce, isDelete(bool),
 *    isChangeStatus(bool), copyTradeId, copySell(bool), excludedDexNumbers(uint64[])]
 * Signature message: "update_copy_trade-{userId}-{data}"
 *
 * isDelete deletes the configuration (positions stay open). isChangeStatus
 * TOGGLES isActive. Passing both is rejected.
 */
export async function updateCopyTrade(
  client: GdexApiClient,
  params: UpdateCopyTradeParams,
): Promise<UpdateCopyTradeResponse> {
  validateRequired(params.copyTradeId, 'copyTradeId');
  validateRequired(params.traderWallet, 'traderWallet');
  if (params.isDelete === true && params.isChangeStatus === true) {
    throw new GdexValidationError(
      'isDelete and isChangeStatus cannot both be set: isDelete removes the configuration, isChangeStatus toggles isActive',
      'isChangeStatus',
    );
  }
  // A settings change is checked like a create; delete / pause / resume re-send
  // the stored values unchanged and are not re-judged here.
  if (params.isDelete !== true && params.isChangeStatus !== true) checkCopyTradeNumbers(params);

  const computedData = buildCopyTradeComputedData({
    action: 'update_copy_trade',
    apiKey: params.apiKey,
    userId: params.userId,
    sessionPrivateKey: params.sessionPrivateKey,
    actionParams: {
      traderWallet: params.traderWallet,
      copyTradeName: params.copyTradeName,
      chainId: params.chainId,
      gasPrice: params.gasPrice ?? '0',
      buyMode: params.buyMode,
      copyBuyAmount: params.copyBuyAmount,
      isBuyExistingToken: params.isBuyExistingToken === true,
      lossPercent: params.lossPercent,
      profitPercent: params.profitPercent,
      isDelete: params.isDelete === true,
      isChangeStatus: params.isChangeStatus === true,
      copyTradeId: params.copyTradeId,
      copySell: params.copySell === true,
      excludedDexNumbers: params.excludedDexNumbers ?? [],
    },
  });

  return client.post<UpdateCopyTradeResponse>(Endpoints.COPY_TRADE_UPDATE, {
    computedData,
  });
}

// ── Explicit controls ───────────────────────────────────────────────────────

/** What deleting does and does not do, from ServiceCopyTrade.update. */
export const COPY_TRADE_DELETE_NOTE =
  'Configuration deleted. Positions already opened by this copy trade were NOT sold, and their ' +
  'take-profit/stop-loss limit orders were NOT cancelled; manage them from the portfolio/limit-order tools. ' +
  'Deletion cannot be undone; create a new copy trade to follow this trader again.';

/** What pausing does and does not do. */
export const COPY_TRADE_PAUSE_NOTE =
  'Copy trade paused (isActive=false). The copier stops mirroring BOTH buys and sells for this ' +
  'configuration; positions it already opened stay open and their TP/SL limit orders stay in place. ' +
  'Resume to mirror again. The list endpoint caches for ~20s, so it may show the old state briefly.';

const COPY_TRADE_RESUME_NOTE =
  'Copy trade resumed (isActive=true). New trades by the followed wallet are mirrored again; trades ' +
  'it made while paused are not replayed.';

/**
 * The backend's /copy_trade/list caches per user for 20 s and an update does not
 * clear it (ServiceCopyTrade.list). A second toggle inside that window could read
 * the pre-toggle state and flip the setting back, so it is refused.
 */
const TOGGLE_GUARD_MS = 25_000;
const lastToggleAt = new Map<string, number>();

/** Test hook: clear the in-process toggle guard. */
export function resetCopyTradeToggleGuardForTests(): void {
  lastToggleAt.clear();
}

async function findCopyTradeConfig(
  client: GdexApiClient,
  params: CopyTradeControlParams,
): Promise<CopyTradeConfig> {
  validateRequired(params.copyTradeId, 'copyTradeId');
  validateRequired(params.userId, 'userId');
  validateRequired(params.apiKey, 'apiKey');
  validateRequired(params.sessionPrivateKey, 'sessionPrivateKey');
  const data = buildGdexReadSessionData(params.sessionPrivateKey, params.apiKey);
  const list = await getCopyTradeList(client, { userId: params.userId, data });
  const configs = Array.isArray(list?.allCopyTrades) ? list.allCopyTrades : null;
  if (!configs) {
    throw new GdexError(
      'Could not read copy trade list to confirm the configuration; nothing was sent',
      GdexErrorCode.PAUSE_STATE_UNVERIFIED,
    );
  }
  const config = configs.find((c) => c?.copyTradeId === params.copyTradeId);
  if (!config) {
    throw new GdexError(
      `No copy trade ${params.copyTradeId} for this user; nothing was sent`,
      GdexErrorCode.COPY_TRADE_NOT_FOUND,
    );
  }
  return config;
}

function storedBuyMode(config: CopyTradeConfig): 1 | 2 | undefined {
  const mode = Number(config.buyMode);
  return mode === 1 || mode === 2 ? mode : undefined;
}

function storedCopyBuyAmount(config: CopyTradeConfig, buyMode: 1 | 2): string {
  return buyMode === 1 ? String(config.copyBuyFixedAmount ?? '') : String(config.copyBuyPercent ?? '');
}

/** Rebuild every update field from a stored config, with optional overrides. */
function configToUpdateFields(
  config: CopyTradeConfig,
  overrides: Partial<UpdateCopyTradeSettingsParams>,
  operation: CopyTradeControlResult['operation'],
): Omit<UpdateCopyTradeParams, 'apiKey' | 'userId' | 'sessionPrivateKey' | 'isDelete' | 'isChangeStatus'> {
  const buyMode = overrides.buyMode ?? storedBuyMode(config);
  if (buyMode !== 1 && buyMode !== 2) {
    throw new GdexError(
      `Stored buyMode ${JSON.stringify(config.buyMode)} is not 1 or 2. ` +
        (operation === 'update_settings'
          ? 'Pass buyMode and copyBuyAmount explicitly.'
          : 'Call updateCopyTradeSettings with explicit buyMode and copyBuyAmount first.'),
      GdexErrorCode.COPY_TRADE_CONFIG_INVALID,
    );
  }
  const copyBuyAmount =
    overrides.copyBuyAmount ??
    (overrides.buyMode !== undefined && overrides.buyMode !== storedBuyMode(config)
      ? undefined
      : storedCopyBuyAmount(config, buyMode));
  if (copyBuyAmount === undefined || copyBuyAmount === '') {
    throw new GdexValidationError('copyBuyAmount is required when buyMode changes', 'copyBuyAmount');
  }
  return {
    chainId: Number(config.chainId),
    copyTradeId: config.copyTradeId,
    traderWallet: overrides.traderWallet ?? config.traderWallet,
    copyTradeName: overrides.copyTradeName ?? config.copyTradeName,
    gasPrice: overrides.gasPrice ?? String(config.gasPrice ?? '0'),
    buyMode,
    copyBuyAmount,
    isBuyExistingToken: overrides.isBuyExistingToken ?? config.isBuyExistingToken === true,
    lossPercent: overrides.lossPercent ?? String(config.lossPercent),
    profitPercent: overrides.profitPercent ?? String(config.profitPercent),
    copySell: overrides.copySell ?? config.copySell === true,
    excludedDexNumbers:
      overrides.excludedDexNumbers ??
      (Array.isArray(config.excludedDexNumbers) ? config.excludedDexNumbers.map(Number) : []),
  };
}

/**
 * Change settings of an existing Solana copy trade. Never deletes and never
 * changes isActive. Omitted fields keep their current values (read from the list).
 */
export async function updateCopyTradeSettings(
  client: GdexApiClient,
  params: UpdateCopyTradeSettingsParams,
): Promise<CopyTradeControlResult> {
  const config = await findCopyTradeConfig(client, params);
  const fields = configToUpdateFields(config, params, 'update_settings');
  const response = await updateCopyTrade(client, {
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
    note: 'Settings updated; active state unchanged. Positions already open are not resized.',
    response,
  };
}

/**
 * Permanently delete a Solana copy trade configuration.
 *
 * Does NOT sell positions it opened and does NOT cancel their TP/SL limit orders
 * (ServiceCopyTrade.update only deletes the CopyTradeSetting row).
 */
export async function deleteCopyTrade(
  client: GdexApiClient,
  params: CopyTradeControlParams,
): Promise<CopyTradeControlResult> {
  const config = await findCopyTradeConfig(client, params);
  // The backend validates the payload (chain, wallet, loss/profit) before it
  // reaches the delete branch, so the stored values are re-sent. buyMode is not
  // read on delete; a legacy out-of-range value is replaced with 1.
  const fields = configToUpdateFields(
    config,
    storedBuyMode(config) ? {} : { buyMode: 1, copyBuyAmount: String(config.copyBuyFixedAmount || '0') },
    'delete',
  );
  const response = await updateCopyTrade(client, {
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
    note: COPY_TRADE_DELETE_NOTE,
    response,
  };
}

async function setCopyTradeActive(
  client: GdexApiClient,
  params: CopyTradeControlParams,
  active: boolean,
): Promise<CopyTradeControlResult> {
  const operation = active ? 'resume' : 'pause';
  const config = await findCopyTradeConfig(client, params);
  if (typeof config.isActive !== 'boolean') {
    throw new GdexError(
      `Copy trade ${params.copyTradeId} has no readable isActive; refusing to toggle blindly. Nothing was sent.`,
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
  const guardKey = `${params.userId.toLowerCase()}:${params.copyTradeId}`;
  const last = lastToggleAt.get(guardKey);
  if (last !== undefined && Date.now() - last < TOGGLE_GUARD_MS) {
    throw new GdexError(
      `Copy trade ${params.copyTradeId} was toggled less than ${TOGGLE_GUARD_MS / 1000}s ago and the backend list ` +
        'is cached for 20s, so its current state cannot be confirmed. Nothing was sent; retry shortly.',
      GdexErrorCode.PAUSE_STATE_UNVERIFIED,
    );
  }
  let fields;
  try {
    fields = configToUpdateFields(config, {}, operation);
  } catch (err) {
    if (err instanceof GdexError && err.code === GdexErrorCode.COPY_TRADE_CONFIG_INVALID) {
      throw new GdexError(
        `Cannot ${operation} copy trade ${params.copyTradeId}: ${err.message} The toggle rewrites every setting, ` +
          'so it is not sent with an invalid stored value. Alternative: deleteCopyTrade stops copying permanently, ' +
          'but positions it opened stay open and their TP/SL orders remain.',
        GdexErrorCode.PAUSE_UNSUPPORTED,
      );
    }
    throw err;
  }
  const response = await updateCopyTrade(client, {
    apiKey: params.apiKey,
    userId: params.userId,
    sessionPrivateKey: params.sessionPrivateKey,
    ...fields,
    isDelete: false,
    isChangeStatus: true,
  });
  lastToggleAt.set(guardKey, Date.now());
  return {
    operation,
    copyTradeId: params.copyTradeId,
    submitted: true,
    previousIsActive: config.isActive,
    expectedIsActive: active,
    note: active ? COPY_TRADE_RESUME_NOTE : COPY_TRADE_PAUSE_NOTE,
    response,
  };
}

/**
 * Pause a Solana copy trade (isActive=false) without deleting it.
 *
 * Reads the current state first because the backend flag is a toggle; a no-op
 * when already paused. Never sets isDelete.
 */
export async function pauseCopyTrade(
  client: GdexApiClient,
  params: CopyTradeControlParams,
): Promise<CopyTradeControlResult> {
  return setCopyTradeActive(client, params, false);
}

/** Resume a paused Solana copy trade (isActive=true). No-op when already active. */
export async function resumeCopyTrade(
  client: GdexApiClient,
  params: CopyTradeControlParams,
): Promise<CopyTradeControlResult> {
  return setCopyTradeActive(client, params, true);
}
