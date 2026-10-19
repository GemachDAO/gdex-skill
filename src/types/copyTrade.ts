/**
 * Types for copy trading operations.
 *
 * Backend routes under /v1/copy_trade/:
 *   GET  /list           — user's copy trade configs (session-key auth)
 *   GET  /tx_list        — copy trade transaction history (session-key auth)
 *   POST /create         — create a new copy trade (computedData auth)
 *   POST /update         — update/toggle/delete copy trade (computedData auth)
 *   GET  /wallets        — top 300 wallets by totalPnl (no auth)
 *   GET  /custom_wallets — top 300 wallets by net received (no auth)
 *   GET  /gems           — hot new tokens from top wallets (no auth)
 *   GET  /top_traders    — top trader rankings (no auth, handled by topTraders module)
 *   GET  /dexes_list     — supported DEXes for a chain (no auth)
 *
 * Write endpoints are Solana-only (chainId must be the Solana chain ID).
 */

// ── Wallet leaderboard (no auth) ────────────────────────────────────────────

/**
 * A tracked wallet from the copy-trade leaderboard.
 * Returned from GET /wallets and GET /custom_wallets.
 */
export interface CopyTradeWallet {
  _id: string;
  chainId: number;
  address: string;
  lastTxTimestamp: number;
  receivedMinusSpent: number;
  spent: number;
  lastCalculateUnrealizedPnl: number;
  totalPnl: number;
  unrealizedValue: number;
  received: number;
}

// ── DEX list (no auth) ──────────────────────────────────────────────────────

/** A supported DEX entry from GET /dexes_list. */
export interface CopyTradeDex {
  chainId: number;
  dexNumber: number;
  dexName: string;
  programId: string;
}

export interface CopyTradeDexListResponse {
  success: boolean;
  dexes: CopyTradeDex[];
}

// ── List copy trades (session-key auth) ─────────────────────────────────────

/** Query params for GET /list. */
export interface CopyTradeListParams {
  userId: string;
  /** AES-encrypted session key (from buildGdexUserSessionData) */
  data: string;
}

/** A single copy trade configuration document. */
export interface CopyTradeConfig {
  copyTradeId: string;
  copyTradeName: string;
  /** 1 = fixed SOL amount, 2 = percentage of trader's amount */
  buyMode: number;
  chainId: number;
  isActive: boolean;
  userId: string;
  userWallet: string;
  traderWallet: string;
  lossPercent: number;
  profitPercent: number;
  gasPrice: string;
  /** SOL amount when buyMode=1 */
  copyBuyFixedAmount: string;
  /** Percentage (0-100) when buyMode=2 */
  copyBuyPercent: number;
  isBuyExistingToken: boolean;
  copySell: boolean;
  excludedProgramIds: string[];
  excludedDexNumbers: number[];
  /** Number of copy-traded transactions */
  txCount?: number;
  lastTxTimestamp?: number;
}

export interface CopyTradeListResponse {
  isSuccess: boolean;
  count: number;
  allCopyTrades: CopyTradeConfig[];
  dexes: CopyTradeDex[];
}

// ── Transaction history (session-key auth) ──────────────────────────────────

/** Query params for GET /tx_list. */
export interface CopyTradeTxListParams {
  userId: string;
  /** AES-encrypted session key */
  data: string;
}

/** Token info embedded in a copy trade transaction. */
export interface CopyTradeTxTokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  dexId: string;
  marketCap?: number;
  logoUrl?: string;
}

/** A single copy trade transaction. */
export interface CopyTradeTx {
  chainId: number;
  userId: string;
  traderWallet: string;
  token: string;
  isBuy: boolean;
  priceUsd: number;
  boughtPrice: number;
  timestamp: number;
  pnlPercentage: number;
  tokenInfo: CopyTradeTxTokenInfo;
}

export interface CopyTradeTxListResponse {
  isSuccess: boolean;
  count: number;
  txes: CopyTradeTx[];
}

// ── Create copy trade (computedData auth) ───────────────────────────────────

/** Parameters for creating a new copy trade. */
export interface CreateCopyTradeParams {
  /** API key for ComputedData encryption */
  apiKey: string;
  /** Control wallet address */
  userId: string;
  /** Session private key for signing */
  sessionPrivateKey: string;
  /** Chain ID (must be Solana) */
  chainId: number;
  /** Solana wallet address of the trader to copy */
  traderWallet: string;
  /** Human-readable label */
  copyTradeName: string;
  /** Gas/priority fee setting */
  gasPrice?: string;
  /** 1 = fixed SOL amount, 2 = percentage of trader's amount */
  buyMode: 1 | 2;
  /** SOL amount (mode 1) or percentage 0-100 (mode 2) */
  copyBuyAmount: string;
  /** Also buy tokens the trader already holds */
  isBuyExistingToken?: boolean;
  /** Stop-loss percentage (must be > 0 and < 100) */
  lossPercent: string;
  /** Take-profit percentage (must be > 0) */
  profitPercent: string;
  /** Also copy the trader's sell trades */
  copySell?: boolean;
  /** DEX numbers to exclude (mapped to programIds on backend) */
  excludedDexNumbers?: number[];
}

export interface CreateCopyTradeResponse {
  isSuccess: boolean;
  message: string;
  allCopyTrades: CopyTradeConfig[];
  dexes: CopyTradeDex[];
}

// ── Update / toggle / delete copy trade (computedData auth) ─────────────────

/** Parameters for updating an existing copy trade. */
export interface UpdateCopyTradeParams {
  apiKey: string;
  userId: string;
  sessionPrivateKey: string;
  chainId: number;
  /** The copyTradeId of the config to modify */
  copyTradeId: string;
  traderWallet: string;
  copyTradeName: string;
  gasPrice?: string;
  buyMode: 1 | 2;
  copyBuyAmount: string;
  isBuyExistingToken?: boolean;
  lossPercent: string;
  profitPercent: string;
  copySell?: boolean;
  excludedDexNumbers?: number[];
  /**
   * Ignored by the backend: it derives excludedProgramIds from excludedDexNumbers
   * (ServiceCopyTrade.update). Kept for source compatibility only.
   */
  excludedProgramIds?: string[];
  /**
   * Permanently delete this configuration (CopyTradeSetting.deleteOne). Does NOT
   * close copied positions or cancel the TP/SL limit orders already placed for
   * them. Prefer {@link deleteCopyTrade}.
   */
  isDelete?: boolean;
  /**
   * TOGGLES isActive relative to the stored value (`isActive = !existing.isActive`
   * in ServiceCopyTrade.update). It is not "pause" and not delete: sent twice it
   * resumes. Prefer {@link pauseCopyTrade} / {@link resumeCopyTrade}, which read
   * the current state first. Cannot be combined with isDelete.
   */
  isChangeStatus?: boolean;
}

/**
 * Settings update for an existing Solana copy trade. Never deletes and never
 * changes the active state. The backend rewrites every field from the payload,
 * so omitted fields are filled from the current configuration (read via the
 * list endpoint) rather than reset to defaults.
 */
export interface UpdateCopyTradeSettingsParams {
  apiKey: string;
  /** Control wallet address */
  userId: string;
  sessionPrivateKey: string;
  copyTradeId: string;
  traderWallet?: string;
  copyTradeName?: string;
  gasPrice?: string;
  buyMode?: 1 | 2;
  copyBuyAmount?: string;
  isBuyExistingToken?: boolean;
  lossPercent?: string;
  profitPercent?: string;
  copySell?: boolean;
  excludedDexNumbers?: number[];
}

/** Identifies one copy trade for delete / pause / resume. */
export interface CopyTradeControlParams {
  apiKey: string;
  /** Control wallet address */
  userId: string;
  sessionPrivateKey: string;
  copyTradeId: string;
}

/** Outcome of an explicit copy-trade control operation. */
export interface CopyTradeControlResult {
  operation: 'update_settings' | 'delete' | 'pause' | 'resume';
  copyTradeId: string;
  /** False when nothing was sent (already in the requested state). */
  submitted: boolean;
  /** isActive read from the list endpoint before acting. */
  previousIsActive?: boolean;
  /** isActive the backend should now hold (undefined after a delete). */
  expectedIsActive?: boolean;
  /** What this did and did not do to positions/orders. */
  note: string;
  /** Raw backend response when a request was sent. */
  response?: { isSuccess: boolean; message?: string };
}

export interface UpdateCopyTradeResponse {
  isSuccess: boolean;
  message: string;
}
