/**
 * Types for portfolio and balance management.
 *
 * Managed-account reads (`/v1/portfolio`, `/v1/user`) are authenticated with
 * the control wallet (`userId`) plus the encrypted session `data`, per chain.
 * Trade history (`/v1/user_history`) is keyed by `userId` alone.
 */
import { SupportedChain } from './common';

/**
 * Credentials for an authenticated managed-account read. Give either `data`
 * (the encrypted session key, as `buildGdexReadSessionData` returns) or
 * `sessionPrivateKey` + `apiKey` to derive it.
 */
export interface ManagedReadCredentials {
  /** Control wallet address: the GDEX `userId`, not the managed trading wallet. */
  walletAddress: string;
  /** Alias of `walletAddress`. */
  userId?: string;
  /** Encrypted session key for the `data` query parameter. */
  data?: string;
  /** Session private key from sign-in (with `apiKey`, derives `data`). */
  sessionPrivateKey?: string;
  /** GDEX API key (with `sessionPrivateKey`, derives `data`). */
  apiKey?: string;
}

/**
 * Parameters for fetching a managed account's portfolio on one chain.
 */
export interface PortfolioParams extends ManagedReadCredentials {
  /** Chain to read. `/v1/portfolio` is per chain. */
  chain: SupportedChain;
}

/**
 * One token holding of the managed wallet, normalized from a
 * `/v1/portfolio` `holding[]` row.
 */
export interface Balance {
  /** Token contract address (mint on Solana, coin type on Sui) */
  tokenAddress: string;
  /** Token symbol */
  symbol: string;
  /** Token name */
  name: string;
  /** Token logo URL */
  logoUrl?: string;
  /** Decimal places of the token */
  decimals: number;
  /** Exact balance in raw base units (integer string) */
  rawBalance: string;
  /** Human-readable balance (exact decimal string of `rawBalance`) */
  balance: string;
  /** USD value of the balance, when the backend priced the token */
  usdValue?: string;
  /** Token price in USD */
  priceUsd?: string;
  /** Token price in the chain's native token */
  priceNative?: string;
  /** Backend's current worth of the holding, in native (`holding`) */
  valueNative?: string;
  /** Native spent on the position since the last reset (`invested`) */
  investedNative?: string;
  /** Position P&L percent (`pnlPercentage`) */
  pnlPercentage?: number;
  /** Percentage change in 24h */
  change24h?: string;
  /** Chain this balance belongs to */
  chain: SupportedChain;
  /** Numeric chain id */
  chainId?: number;
}

/**
 * A managed account's holdings on one chain.
 */
export interface Portfolio {
  status: 'ok';
  mode: 'managed';
  /** Control wallet the read was authenticated as. */
  userId: string;
  chainId: number;
  /** Token holdings (`/v1/portfolio` `holding[]`), native excluded. */
  holdings: Balance[];
  /** Same array as `holdings` (backwards-compatible name). */
  balances: Balance[];
  /** Sum of `valueNative` when every holding has one. */
  totalValueNative?: string;
  /** Total portfolio value in USD, when every holding has a `usdValue`. */
  totalValueUsd?: string;
  /** Open perpetual positions */
  perpPositions?: import('./perp').PerpPosition[];
  /** Realized P&L */
  realizedPnl?: string;
  /** Unrealized P&L */
  unrealizedPnl?: string;
  /** Total P&L */
  totalPnl?: string;
}

/**
 * Parameters for fetching balances.
 */
export interface BalanceParams extends ManagedReadCredentials {
  /** Chain to query */
  chain: SupportedChain;
  /** Optional specific token address */
  tokenAddress?: string;
}

/**
 * Native funds available to trade with on one chain, from `/v1/user`.
 */
export interface TradingFunds {
  status: 'ok';
  mode: 'managed';
  userId: string;
  chainId: number;
  /** Managed (deposit) wallet on this chain. */
  address: string;
  /** Managed wallets per chain family. */
  walletsByChain?: { evm: string | null; solana: string | null; sui: string | null };
  /** Native balance in whole units, as the backend reports it. */
  nativeBalance: string;
  nativeSymbol: string;
  /**
   * `approximate`: the backend returns a float, and reports 0 when its RPC read
   * fails after retries, so a zero here is not proof of an empty wallet.
   */
  precision: 'approximate';
}

/**
 * A historical trade record, normalized from a `/v1/user_history` track.
 */
export interface TradeRecord {
  /** Transaction hash (also the record id) */
  id: string;
  /** Trade type */
  type: 'buy' | 'sell' | 'perp_open' | 'perp_close';
  /** Input token */
  inputToken: string;
  /** Output token */
  outputToken: string;
  /** Amount in, raw units */
  amountIn: string;
  /** Amount out, raw units */
  amountOut: string;
  /** USD value at time of trade */
  usdValue?: string;
  /** Chain */
  chain: SupportedChain;
  /** DEX used */
  dex?: string;
  /** Transaction hash */
  txHash: string;
  /** Unix timestamp */
  timestamp: number;
  /** Trade status */
  status: 'completed' | 'failed' | 'pending';
  /** Managed wallet that traded */
  walletAddress?: string;
  /** Token traded */
  tokenAddress?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  /** Raw token amount */
  tokenAmount?: string;
  /** Raw native amount */
  nativeAmount?: string;
  /** Native price in USD at the trade */
  nativePrice?: number;
  isConfirmed?: boolean;
}

/**
 * Parameters for fetching trade history.
 */
export interface TradeHistoryParams {
  /** Control wallet address (the GDEX `userId`). */
  walletAddress: string;
  /** Alias of `walletAddress`. */
  userId?: string;
  /** Chain to read (required by `/v1/user_history`). */
  chain: SupportedChain;
  /** Items per page, 1-50 (backend cap). */
  limit?: number;
  /** Return trades older than this Unix timestamp (`nextCursor` of the previous page). */
  cursor?: number;
  /** Not supported by the backend (cursor pagination). Rejected when set. */
  page?: number;
  /** Not supported by the backend. Rejected when set. */
  startTime?: number;
  /** Not supported by the backend. Rejected when set. */
  endTime?: number;
}

/** One page of trade history. */
export interface TradeHistoryPage {
  status: 'ok';
  userId: string;
  chainId: number;
  trades: TradeRecord[];
  /** Pass as `cursor` for the next page; null when this is the last page. */
  nextCursor: number | null;
}
