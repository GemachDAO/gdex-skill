/**
 * Types for spot trading operations (buy/sell tokens).
 */
import { SupportedChain, SupportedDex, TransactionResult } from './common';

/**
 * Parameters for buying a token.
 */
export interface BuyTokenParams {
  /** Blockchain chain to execute the trade on */
  chain: SupportedChain;
  /** Token contract address to buy */
  tokenAddress: string;
  /**
   * Decimal amount of the chain's native token to spend, converted exactly to
   * native decimals (18 on EVM, 9 on Solana and Sui); never rounded.
   * @example "0.1" for 0.1 SOL
   */
  amount: string;
  /**
   * Slippage tolerance as a percentage, sent as basis points. Honoured by the
   * backend on Solana and Sui only, capped at 50%. On EVM chains the backend
   * uses the account's stored slippage, so passing it there is rejected.
   * Omit it to use the account's stored setting.
   * @example 1 for 1% slippage
   */
  slippage?: number;
  /** Not supported by `purchase_v2`: the backend picks the route. Rejected when set. */
  dex?: SupportedDex;
  /**
   * Control wallet address (the GDEX `userId`). Required with
   * `sessionPrivateKey` and `apiKey`.
   */
  walletAddress?: string;
  /** Not supported by `purchase_v2`. Rejected when set. */
  referrer?: string;
  /**
   * Solana priority fee in lamports (integer, Solana only). Sent as the
   * backend's `tip` in SOL, at most 50_000_000 lamports (0.05 SOL).
   */
  priorityFee?: number;
  /**
   * Must be omitted or the chain's native token: `purchase_v2` always spends
   * native. Use `buyWithUsdc` to pay with USDC.
   */
  inputToken?: string;
  /** Managed-custody session private key (from sign-in). Required. */
  sessionPrivateKey?: string;
  /** GDEX API key used to encrypt the signed payload. Required. */
  apiKey?: string;
}

/**
 * Parameters for selling a token.
 */
export interface SellTokenParams {
  /** Blockchain chain to execute the trade on */
  chain: SupportedChain;
  /** Token contract address to sell */
  tokenAddress: string;
  /**
   * Amount of tokens to sell: a decimal token amount ("1.5") converted exactly
   * to the token's decimals, or a percentage of the held balance ("50%",
   * "100%"), resolved from the managed portfolio read with integer math.
   */
  amount: string;
  /** Slippage percentage; same rules as {@link BuyTokenParams.slippage}. */
  slippage?: number;
  /** Not supported by `sell_v2`. Rejected when set. */
  dex?: SupportedDex;
  /** Control wallet address (the GDEX `userId`). Required. */
  walletAddress?: string;
  /** Not supported by `sell_v2`. Rejected when set. */
  referrer?: string;
  /** Solana priority fee in lamports; same rules as {@link BuyTokenParams.priorityFee}. */
  priorityFee?: number;
  /**
   * Must be omitted or the chain's native token: `sell_v2` always receives
   * native. Use `sellToUsdc` to receive USDC.
   */
  outputToken?: string;
  /**
   * Token decimals. Only needed for an absolute amount of a token the managed
   * portfolio does not list; otherwise read from the holding.
   */
  tokenDecimals?: number;
  /** Managed-custody session private key (from sign-in). Required. */
  sessionPrivateKey?: string;
  /** GDEX API key used to encrypt the signed payload. Required. */
  apiKey?: string;
}

/**
 * Accepted managed spot trade (`POST /v1/purchase_v2` or `/v1/sell_v2`).
 * The trade runs asynchronously: follow `requestId` with `waitForTrade` or
 * `getManagedTradeStatus`. Never resubmit a trade that has a `requestId`.
 */
export interface ManagedSpotTradeResult {
  /** Backend request id for `/v1/trade-status/:requestId`. */
  requestId: string;
  /** Status at submission, normally `pending`. */
  status: string;
  /** Backend timestamp (ms). */
  createdAt?: number;
  side: 'buy' | 'sell';
  chainId: number;
  tokenAddress: string;
  /** Exact signed amount in raw units: native for a buy, token for a sell. */
  amountRaw: string;
  /** Decimals `amountRaw` is expressed in. */
  amountDecimals: number;
  /** For a percentage sell: the held balance (raw) the amount was taken from. */
  heldRaw?: string;
  /** Slippage sent to the backend, in basis points. */
  slippageBps?: number;
  /** Solana tip sent to the backend, in SOL. */
  tipSol?: number;
}

/** Terminal (or timed-out) state of a managed spot trade. */
export interface ManagedTradeWaitResult {
  /**
   * `filled` (status success and isSuccess true); `failed` (status error or
   * isSuccess false); `not_found` (unknown or expired requestId); `pending`
   * (still running when `timeoutMs` ran out: never resubmit).
   */
  outcome: 'filled' | 'failed' | 'not_found' | 'pending';
  requestId: string;
  /** Last backend status: pending, processing, success or error. */
  status?: string;
  hash?: string;
  /** Raw token amount bought or sold. */
  tokenAmount?: string;
  /** Raw native amount spent or received. */
  ethAmount?: string;
  error?: string;
  errorCode?: string;
  /** Last `/v1/trade-status/:requestId` payload. */
  trade?: Record<string, unknown>;
  /** Last polling error, when the status could not be read. */
  lastError?: string;
}

/** Options for `waitForTrade`. */
export interface WaitForTradeParams {
  requestId: string;
  /** Poll interval, default 2000 ms. */
  intervalMs?: number;
  /** Give up after this long and return `outcome: 'pending'`; default 120000 ms. */
  timeoutMs?: number;
  /** Called whenever the backend status changes. */
  onUpdate?: (state: Record<string, unknown>) => void;
}

/**
 * Result of a spot trade (buy or sell) operation.
 */
export interface TradeResult extends TransactionResult {
  /** Input token address */
  inputToken: string;
  /** Output token address */
  outputToken: string;
  /** Amount of input token spent */
  inputAmount: string;
  /** Amount of output token received */
  outputAmount: string;
  /** Execution price (outputAmount / inputAmount) */
  executionPrice: string;
  /** Price impact as a percentage */
  priceImpact?: string;
  /** DEX used for the swap */
  dex?: string;
  /** Unique trade/job ID from the backend queue */
  jobId?: string;
}

/**
 * Parameters for getting a quote without executing a trade.
 */
export interface QuoteParams {
  /** Blockchain chain */
  chain: SupportedChain;
  /** Input token address */
  inputToken: string;
  /** Output token address */
  outputToken: string;
  /** Amount of input token */
  amount: string;
  /** Slippage tolerance */
  slippage?: number;
}

/**
 * Quote result.
 */
export interface QuoteResult {
  /** Expected output amount */
  outputAmount: string;
  /** Execution price */
  price: string;
  /** Price impact percentage */
  priceImpact: string;
  /** Best route DEX */
  dex: string;
  /** Minimum output amount after slippage */
  minimumReceived: string;
}
