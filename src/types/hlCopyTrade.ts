/**
 * Types for HyperLiquid perpetual futures copy trading.
 *
 * This is a completely separate system from Solana spot copy trading.
 * It operates on EVM chain (chainId = 1), copies perpetual futures positions,
 * and supports opposite-direction copy trading.
 *
 * Backend routes under /v1/hl/:
 *   GET  /list           — user's HL copy trade configs (session-key auth)
 *   GET  /tx_list        — HL copy trade fill history (session-key auth)
 *   POST /create         — create HL copy trade (computedData auth)
 *   POST /update         — update/delete HL copy trade (computedData auth)
 *   GET  /top_traders    — top traders by volume/tradeCount/deposit (no auth)
 *   GET  /top_traders_by_pnl — top 30 by PnL (no auth)
 *   GET  /user_stats     — detailed trader stats (no auth)
 *   GET  /perp_dexes     — available perp DEXes (no auth)
 *   GET  /all_assets     — all tradeable assets (no auth)
 *   GET  /clearinghouse_state     — account state on a DEX (no auth)
 *   GET  /clearinghouse_state_all — account state across all DEXes (no auth)
 *   GET  /open_orders    — active orders on a DEX (no auth)
 *   GET  /open_orders_all — active orders across all DEXes (no auth)
 *   GET  /deposit_tokens — supported deposit tokens (no auth)
 *   GET  /usdc_balance   — USDC balance on Arbitrum (no auth)
 */

// ── List HL copy trades (session-key auth) ──────────────────────────────────

/** Query params for GET /hl/list. */
export interface HlCopyTradeListParams {
  userId: string;
  /** AES-encrypted session key (from buildGdexUserSessionData) */
  data: string;
}

/** A single HL copy trade configuration. */
export interface HlCopyTradeConfig {
  copyTradeId: string;
  copyTradeName: string;
  /**
   * Copy mode. The backend stores the ABI byte-offset (416 for create, 480 for update)
   * rather than the actual string value, so this is NOT 1 or 2 in practice.
   * Treat as opaque; the value sent during create/update is what matters.
   */
  copyMode: number;
  /** Always 1 (EVM) */
  chainId: number;
  isActive: boolean;
  userId: string;
  userWallet: string;
  /** EVM address of the trader being copied */
  traderWallet: string;
  lossPercent: number;
  profitPercent: number;
  /** USD amount per order (mode 1) or ratio (mode 2) */
  fixedAmountCostPerOrder: string;
  /**
   * Copy in opposite direction. In responses this is always `true` due to a backend
   * ABI-offset parsing bug — the actual value sent during create/update is what matters.
   */
  oppositeCopy: boolean;
  createdAt: number;
  lastUpdated: number;
  /** Aggregated total trades from HLCopyTradeTrack */
  totalTrades: number;
  /** Aggregated total volume from HLCopyTradeTrack */
  totalVolumes: number;
  /** Aggregated total PnL from HLCopyTradeTrack */
  totalPnl: number;
}

export interface HlCopyTradeListResponse {
  isSuccess: boolean;
  count: number;
  allCopyTrades: HlCopyTradeConfig[];
}

// ── Transaction history (session-key auth) ──────────────────────────────────

/** Query params for GET /hl/tx_list. */
export interface HlCopyTradeTxListParams {
  userId: string;
  /** AES-encrypted session key */
  data: string;
  /** Page number (default "1") */
  page?: string;
  /** Results per page, max 100 (default "10") */
  limit?: string;
}

/** A single HL copy trade fill record. */
export interface HlCopyTradeTx {
  /** Asset symbol, e.g. "BTC" */
  coin: string;
  /** Fill price */
  px: string;
  /** Fill size */
  sz: string;
  /** "B" for buy, "S" for sell */
  side: string;
  /** Unix timestamp in ms */
  time: number;
  closedPnl: string;
  /** HyperLiquid order ID */
  oid: string;
  /** Direction description, e.g. "Open Long" */
  dir: string;
  /** Copy trade name, or "N/A" if not from copy trade */
  copyTradeName: string;
  /** Trader's tx hash, or "N/A" */
  traderTxHash: string;
  /** Trader's position size, or "N/A" */
  traderSize: string;
  /** Trader's price, or "N/A" */
  traderPrice: string;
  /** Trader's wallet, or "N/A" */
  traderWallet: string;
}

export interface HlCopyTradeTxListResponse {
  isSuccess: boolean;
  totalCount: number;
  txes: HlCopyTradeTx[];
}

// ── Create HL copy trade (computedData auth) ────────────────────────────────

/** Parameters for creating a new HL copy trade. */
export interface CreateHlCopyTradeParams {
  /** API key for ComputedData encryption */
  apiKey: string;
  /** Control wallet address */
  userId: string;
  /** Session private key for signing */
  sessionPrivateKey: string;
  /** EVM address of the trader to copy */
  traderWallet: string;
  /** Human-readable label */
  copyTradeName: string;
  /** 1 = Fixed USD Amount per order, 2 = Proportion of trader's size */
  copyMode: 1 | 2;
  /** USD amount per order (mode 1) or ratio (mode 2) */
  fixedAmountCostPerOrder: string;
  /** Stop-loss percentage (must be > 0 and < 100) */
  lossPercent: string;
  /** Take-profit percentage (must be > 0) */
  profitPercent: string;
  /** Copy in opposite direction (short when trader goes long) */
  oppositeCopy?: boolean;
}

export interface CreateHlCopyTradeResponse {
  isSuccess: boolean;
  message: string;
  allCopyTrades: HlCopyTradeConfig[];
}

// ── Update / toggle / delete HL copy trade (computedData auth) ──────────────

/** Parameters for updating an existing HL copy trade. */
export interface UpdateHlCopyTradeParams {
  apiKey: string;
  userId: string;
  sessionPrivateKey: string;
  /** The copyTradeId to modify */
  copyTradeId: string;
  traderWallet: string;
  copyTradeName: string;
  copyMode: 1 | 2;
  fixedAmountCostPerOrder: string;
  lossPercent: string;
  profitPercent: string;
  oppositeCopy?: boolean;
  /** Set truthy to permanently delete this copy trade */
  isDelete?: boolean;
  /**
   * WARNING: Despite the name, isChangeStatus DELETES the trade permanently
   * (same behaviour as Solana copy trade). It does NOT toggle isActive.
   * Prefer using isDelete for clarity.
   */
  isChangeStatus?: boolean;
}

export interface UpdateHlCopyTradeResponse {
  isSuccess: boolean;
  message: string;
}

// ── Discovery endpoints (no auth) ───────────────────────────────────────────

/** HL top trader entry from /hl/top_traders. */
/** HL top trader entry from /hl/top_traders (volume/tradeCount/deposit sort). */
export interface HlTopTrader {
  address: string;
  volume: number;
  tradeCount: number;
  deposit: number;
}

/** HL top trader entry from /hl/top_traders_by_pnl (nested by time window). */
export interface HlTopTraderByPnl {
  ethAddress: string;
  accountValue: string;
  windowPerformances: Array<{
    window: string;
    percentage: number;
    pnl: number;
  }>;
}

export interface HlTopTradersResponse {
  isSuccess: boolean;
  topTraders: HlTopTrader[] | { day: HlTopTraderByPnl[]; week: HlTopTraderByPnl[]; month: HlTopTraderByPnl[] };
}

/**
 * Detailed user stats from /hl/user_stats.
 * NOTE: Requires the MANAGED wallet address, not the control wallet.
 */
export interface HlDailyPnl {
  timeMs: number;
  date: string;
  pnl: number;
  pnlPercentage: number;
  capitalDeployed: number;
}

export interface HlUserStats {
  '24h': number;
  '7d': number;
  '30d': number;
  week: number;
  dailyPnls: HlDailyPnl[];
  volumes: Record<string, number>;
  tradesCount: Record<string, { win: number; lose: number; total: number }>;
  percentagePnl: Record<string, number>;
  capitalDeployed: Record<string, number>;
  allTime: { pnl: number; pnlPercentage: number; capitalDeployed: number };
}

export interface HlUserStatsResponse {
  isSuccess: boolean;
  userStats: HlUserStats;
}

/** Perp DEXes from /hl/perp_dexes. */
export interface HlPerpDexesResponse {
  isSuccess: boolean;
  perpDexes: string[];
}

/** All tradeable assets from /hl/all_assets. */
export interface HlAllAssetsResponse {
  isSuccess: boolean;
  count: number;
  assets: unknown[];
}

/** Deposit token info from /hl/deposit_tokens. */
export interface HlDepositToken {
  name: string;
  address: string;
  symbol: string;
  chainId: number;
  decimals: number;
  minDeposit: number;
  HLReceiver: string;
}

export interface HlDepositTokensResponse {
  isSuccess: boolean;
  tokens: Record<string, HlDepositToken[]>;
}
