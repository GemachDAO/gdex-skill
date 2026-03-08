/**
 * @gdexsdk/gdex-skill
 *
 * AI Agent Skill SDK for the Gbot Trading Dashboard.
 * Exposes cross-chain spot/perp trading, portfolio management,
 * token discovery, copy trading, and bridging as a clean TypeScript SDK.
 *
 * @example
 * ```typescript
 * import { GdexSkill, ChainId } from '@gdexsdk/gdex-skill';
 *
 * const skill = new GdexSkill({ apiUrl: 'https://api.gdex.pro' });
 *
 * const token = await skill.getTokenDetails({
 *   tokenAddress: 'So11111111111111111111111111111111111111112',
 *   chain: 'solana',
 * });
 * console.log(token.symbol, token.priceUsd);
 * ```
 */

import { generateEvmWallet } from './utils/walletGeneration';
import type { GeneratedEvmWallet } from './utils/walletGeneration';
import { GdexApiClient } from './client';
import { AuthCredentials, AuthSession } from './client/auth';
import * as Endpoints from './client/endpoints';
import { GdexSkillConfig } from './types/common';
import {
  buildGdexManagedTradeComputedData,
  buildGdexSignInComputedData,
  buildGdexUserSessionData,
  generateGdexSessionKeyPair,
} from './utils/gdexManagedCrypto';

// Actions
import { buyToken, sellToken } from './actions/spotTrade';
import {
  getHlAccountState,
  getPerpPositions,
  getHlMarkPrice,
  getHlUsdcBalance,
  getHlOpenOrders,
  getGbotUsdcBalance,
  perpDeposit,
  perpWithdraw,
  hlCreateOrder,
  hlPlaceOrder,
  hlCloseAll,
  hlCancelOrder,
  hlCancelAllOrders,
  hlUpdateLeverage,
} from './actions/perpTrade';
import { createLimitOrder, cancelLimitOrder, getLimitOrders } from './actions/limitOrders';
import {
  getCopyTradeSettings,
  setCopyTradeSettings,
  getCopyTradeWallets,
  addCopyTradeWallet,
  removeCopyTradeWallet,
} from './actions/copyTrade';
import { getPortfolio, getBalances, getTradeHistory } from './actions/portfolio';
import { getTokenDetails, getTrendingTokens, getOHLCV } from './actions/tokenInfo';
import { getTopTraders } from './actions/topTraders';
import { bridge, getBridgeQuote } from './actions/bridge';
import { getWalletInfo } from './actions/wallet';

// Types
export type { GdexSkillConfig, TransactionResult, SupportedChain, NonEvmChain } from './types/common';
export { ChainId, GdexErrorCode } from './types/common';
export type { BuyTokenParams, SellTokenParams, TradeResult, QuoteParams, QuoteResult } from './types/trading';
export type {
  Portfolio,
  Balance,
  TradeRecord,
  PortfolioParams,
  BalanceParams,
  TradeHistoryParams,
} from './types/portfolio';
export type {
  TokenDetails,
  TokenDetailsParams,
  TokenPool,
  TrendingToken,
  TrendingParams,
  OHLCVCandle,
  OHLCVData,
  OHLCVParams,
} from './types/token';
export type {
  LimitOrder,
  CreateLimitOrderParams,
  CancelLimitOrderParams,
  GetLimitOrdersParams,
} from './types/orders';
export type {
  PerpPosition,
  PerpSide,
  HlManagedCredentials,
  GetPositionsParams,
  HlAccountState,
  PerpDepositParams,
  PerpWithdrawParams,
  HlCreateOrderParams,
  HlPlaceOrderParams,
  HlCloseAllParams,
  HlCancelOrderParams,
  HlCancelAllOrdersParams,
  HlUpdateLeverageParams,
  HlResponse,
  HlOrderResult,
} from './types/perp';
export type {
  CopyTradeSettings,
  CopyTradeWallet,
  AddWalletParams,
  RemoveWalletParams,
  GetCopyTradeSettingsParams,
} from './types/copyTrade';
export type { BridgeParams, BridgeResult, BridgeQuote } from './types/bridge';
export type { TopTrader, TopTradersParams, WalletInfo, WalletInfoParams } from './types/index';
export type {
  GdexManagedSignInParams,
  GdexManagedUserQuery,
  GdexManagedSessionKeyPair,
  GdexManagedComputedPayload,
  GdexManagedTradeParams,
  GdexManagedTradeSubmitResult,
  GdexManagedTradeStatus,
} from './types/managed';

// Error classes
export {
  GdexError,
  GdexAuthError,
  GdexValidationError,
  GdexApiError,
  GdexNetworkError,
  GdexRateLimitError,
} from './utils/errors';

// Client and auth utilities
export { GdexApiClient } from './client';
export type { AuthCredentials, AuthSession } from './client/auth';
export * as Endpoints from './client/endpoints';

// Config utilities
export { getChainConfig, getSupportedChains, chainSupportsDex, CHAIN_CONFIGS, HYPERLIQUID_DEFAULT_ASSETS } from './config/chains';
export type { ChainConfig } from './config/chains';
export { GDEX_API_KEYS, GDEX_API_KEY_PRIMARY, GDEX_API_KEY_SECONDARY } from './config/apiKeys';

// Formatting utilities
export { getChainName, getNativeToken, formatTokenAmount, formatUsd, formatPercentChange, shortenAddress, formatTimestamp, truncateDecimals } from './utils/formatting';

// Wallet generation utilities (no network required)
export { generateEvmWallet } from './utils/walletGeneration';
export type { GeneratedEvmWallet } from './utils/walletGeneration';

// Validation utilities
export { validateAddress, validateAmount, validateChain, validateSlippage, validateLeverage, validateCoin } from './utils/validation';
export {
  deriveGdexAesMaterial,
  encryptGdexComputedData,
  encryptGdexHexData,
  decryptGdexComputedData,
  generateGdexSessionKeyPair,
  buildGdexSignInMessage,
  encodeGdexSignInData,
  encodeGdexTradeData,
  buildGdexTradeSignatureMessage,
  signGdexTradeMessageWithSessionKey,
  buildGdexUserSessionData,
  buildEncryptedGdexPayload,
  buildGdexSignInComputedData,
  buildGdexManagedTradeComputedData,
  generateGdexNonce,
  encodeHlActionData,
  signHlActionMessage,
  buildHlComputedData,
} from './utils/gdexManagedCrypto';
export type { HlActionType } from './utils/gdexManagedCrypto';

// Import parameter types for the GdexSkill class methods
import type { BuyTokenParams, SellTokenParams, TradeResult } from './types/trading';
import type { Portfolio, Balance, TradeRecord, PortfolioParams, BalanceParams, TradeHistoryParams } from './types/portfolio';
import type { TokenDetails, TokenDetailsParams, TrendingToken, TrendingParams, OHLCVData, OHLCVParams } from './types/token';
import type { LimitOrder, CreateLimitOrderParams, CancelLimitOrderParams, GetLimitOrdersParams } from './types/orders';
import type {
  PerpPosition,
  GetPositionsParams,
  HlAccountState,
  PerpDepositParams,
  PerpWithdrawParams,
  HlCreateOrderParams,
  HlPlaceOrderParams,
  HlCloseAllParams,
  HlCancelOrderParams,
  HlCancelAllOrdersParams,
  HlUpdateLeverageParams,
  HlResponse,
  HlOrderResult,
} from './types/perp';
import type { CopyTradeSettings, CopyTradeWallet, AddWalletParams, RemoveWalletParams, GetCopyTradeSettingsParams } from './types/copyTrade';
import type { BridgeParams, BridgeResult, BridgeQuote } from './types/bridge';
import type { TopTrader, TopTradersParams, WalletInfo, WalletInfoParams } from './types/index';
import type {
  GdexManagedSignInParams,
  GdexManagedUserQuery,
  GdexManagedSessionKeyPair,
  GdexManagedComputedPayload,
  GdexManagedTradeParams,
  GdexManagedTradeSubmitResult,
  GdexManagedTradeStatus,
} from './types/managed';

/**
 * GdexSkill — the main entry point for the AI Agent Skill SDK.
 *
 * Wraps all Gbot backend API operations as clean async methods
 * that AI agents can call programmatically.
 *
 * @example
 * ```typescript
 * const skill = new GdexSkill({
 *   apiUrl: 'https://api.gdex.pro',
 *   debug: true,
 * });
 *
 * // Authenticate with an EVM wallet
 * await skill.authenticate({
 *   type: 'evm',
 *   address: '0xYourWalletAddress',
 *   privateKey: process.env.EVM_PRIVATE_KEY,
 * });
 *
 * // Buy a token on Solana
 * const result = await skill.buyToken({
 *   chain: 'solana',
 *   tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
 *   amount: '0.1',
 *   slippage: 1,
 * });
 * ```
 */
export class GdexSkill {
  /** Underlying HTTP client */
  readonly client: GdexApiClient;

  /**
   * Create a new GdexSkill instance.
   *
   * @param config - SDK configuration options
   */
  constructor(config: GdexSkillConfig = {}) {
    this.client = new GdexApiClient(config);
  }

  // ── Authentication ─────────────────────────────────────────────────────────

  /**
   * Authenticate using a pre-configured shared API key.
   *
   * This is the recommended authentication method for AI agents.
   * Use one of the exported `GDEX_API_KEYS` constants.
   *
   * @param apiKey - Shared API key (see `GDEX_API_KEYS`)
   *
   * @example
   * ```typescript
   * import { GdexSkill, GDEX_API_KEY_PRIMARY } from '@gdexsdk/gdex-skill';
   *
   * const skill = new GdexSkill();
   * skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);
   * // Now ready to make authenticated requests
   * ```
   */
  loginWithApiKey(apiKey: string): void {
    this.client.loginWithApiKey(apiKey);
  }

  /**
   * Authenticate with the Gbot backend using wallet credentials (EVM/Solana/Sui).
   *
   * For most AI agent use cases, prefer `loginWithApiKey()` with a shared key.
   * Use this method when you need user-specific wallet authentication.
   *
   * @param credentials - Wallet credentials for signing
   * @returns Session object with token and expiry
   */
  async authenticate(credentials: AuthCredentials): Promise<AuthSession> {
    return this.client.authenticate(credentials);
  }

  /**
   * Clear the current auth session.
   */
  logout(): void {
    this.client.logout();
  }

  /**
   * Check whether the client has a valid auth session.
   */
  isAuthenticated(): boolean {
    return this.client.isAuthenticated();
  }

  // ── Managed Custody Contract (/v1 computedData flow) ─────────────────────

  /**
   * Sign in using pre-built encrypted `computedData` payload.
   *
   * This matches the documented `/v1/sign_in` contract used by managed custody.
   */
  async signInWithComputedData(params: GdexManagedSignInParams): Promise<Record<string, unknown>> {
    return this.client.post<Record<string, unknown>>(Endpoints.AUTH_SIGN_IN, params);
  }

  /**
   * Generate a new secp256k1 session keypair for managed-custody auth flow.
   */
  generateManagedSessionKeyPair(): GdexManagedSessionKeyPair {
    return generateGdexSessionKeyPair();
  }

  /**
   * Build encrypted /v1/user `data` query param from session key.
   */
  buildManagedUserData(sessionKey: string, apiKey: string): string {
    return buildGdexUserSessionData(sessionKey, apiKey);
  }

  /**
   * Build /v1/sign_in computedData after obtaining control-wallet signature.
   */
  buildManagedSignInComputedData(params: {
    apiKey: string;
    userId: string;
    sessionKey: string;
    nonce: string;
    refSourceCode?: string;
    signature: string;
  }): GdexManagedComputedPayload {
    return buildGdexSignInComputedData(params);
  }

  /**
   * Build trade computedData for purchase/sell using session private key signing.
   */
  buildManagedTradeComputedData(params: {
    apiKey: string;
    action: 'purchase' | 'sell';
    userId: string;
    tokenAddress: string;
    amount: string | number | bigint;
    nonce: string;
    sessionPrivateKey: string;
  }): GdexManagedComputedPayload {
    return buildGdexManagedTradeComputedData(params);
  }

  /**
   * Get current managed user profile and chain wallet resolution.
   */
  async getManagedUser(params: GdexManagedUserQuery): Promise<Record<string, unknown>> {
    return this.client.get<Record<string, unknown>>(Endpoints.USER_PROFILE, { ...params });
  }

  /**
   * Submit managed-custody buy trade using encrypted `computedData`.
   */
  async submitManagedPurchase(params: GdexManagedTradeParams): Promise<GdexManagedTradeSubmitResult> {
    return this.client.post<GdexManagedTradeSubmitResult>(Endpoints.PURCHASE_V2, params);
  }

  /**
   * Submit managed-custody sell trade using encrypted `computedData`.
   */
  async submitManagedSell(params: GdexManagedTradeParams): Promise<GdexManagedTradeSubmitResult> {
    return this.client.post<GdexManagedTradeSubmitResult>(Endpoints.SELL_V2, params);
  }

  /**
   * Poll managed trade status by `requestId`.
   *
   * Uses the canonical `/v1/trade-status/:requestId` path first,
   * then falls back to legacy query endpoint for compatibility.
   */
  async getManagedTradeStatus(requestId: string): Promise<GdexManagedTradeStatus> {
    try {
      return await this.client.get<GdexManagedTradeStatus>(Endpoints.tradeStatusPath(requestId));
    } catch {
      return this.client.get<GdexManagedTradeStatus>(Endpoints.TRADE_STATUS, {
        requestId,
        jobId: requestId,
      });
    }
  }

  // ── Spot Trading ──────────────────────────────────────────────────────────

  /**
   * Buy a token on any supported chain.
   *
   * Submits a market buy order to the backend trade queue.
   * Supports Solana (Raydium/Orca), Sui (Cetus/Bluefin), and 12+ EVM chains.
   *
   * @param params - Buy parameters
   * @returns Trade result with transaction hash and execution details
   *
   * @example
   * ```typescript
   * const result = await skill.buyToken({
   *   chain: 'solana',
   *   tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
   *   amount: '0.5', // 0.5 SOL
   *   slippage: 1, // 1% slippage
   * });
   * console.log('Tx:', result.txHash);
   * ```
   */
  async buyToken(params: BuyTokenParams): Promise<TradeResult> {
    return buyToken(this.client, params);
  }

  /**
   * Sell a token on any supported chain.
   *
   * @param params - Sell parameters (amount can be absolute or percentage like "50%")
   * @returns Trade result with transaction hash and execution details
   *
   * @example
   * ```typescript
   * // Sell 50% of holdings
   * const result = await skill.sellToken({
   *   chain: ChainId.BASE,
   *   tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
   *   amount: '50%',
   * });
   * ```
   */
  async sellToken(params: SellTokenParams): Promise<TradeResult> {
    return sellToken(this.client, params);
  }

  // ── Perpetual Trading (HyperLiquid) ────────────────────────────────────────

  /**
   * Get full HyperLiquid account state (positions, margin, balance).
   * Reads directly from HyperLiquid L1 — no auth required.
   */
  async getHlAccountState(walletAddress: string): Promise<HlAccountState> {
    return getHlAccountState(walletAddress);
  }

  /**
   * Get open perpetual positions for a wallet. Optionally filter by coin.
   * Reads directly from HyperLiquid L1.
   */
  async getPerpPositions(params: GetPositionsParams): Promise<PerpPosition[]> {
    return getPerpPositions(params);
  }

  /**
   * Get the mark price for an asset from the HyperLiquid L2 book.
   */
  async getHlMarkPrice(coin: string): Promise<number> {
    return getHlMarkPrice(coin);
  }

  /**
   * Get available USDC balance on HyperLiquid for a wallet.
   */
  async getHlUsdcBalance(walletAddress: string): Promise<number> {
    return getHlUsdcBalance(walletAddress);
  }

  /**
   * Get open orders on HyperLiquid.
   */
  async getHlOpenOrders(walletAddress: string) {
    return getHlOpenOrders(walletAddress);
  }

  /**
   * Get USDC balance via the GDEX backend.
   */
  async getGbotUsdcBalance(walletAddress: string): Promise<number> {
    return getGbotUsdcBalance(this.client, walletAddress);
  }

  /**
   * Deposit USDC into HyperLiquid via managed custody.
   */
  async perpDeposit(params: PerpDepositParams): Promise<HlResponse> {
    return perpDeposit(this.client, params);
  }

  /**
   * Withdraw USDC from HyperLiquid via managed custody.
   */
  async perpWithdraw(params: PerpWithdrawParams): Promise<HlResponse> {
    return perpWithdraw(this.client, params);
  }

  /**
   * Place a market or limit order with optional TP/SL on HyperLiquid.
   */
  async hlCreateOrder(params: HlCreateOrderParams): Promise<HlOrderResult> {
    return hlCreateOrder(this.client, params);
  }

  /**
   * Place a simple order (no TP/SL) on HyperLiquid.
   */
  async hlPlaceOrder(params: HlPlaceOrderParams): Promise<HlOrderResult> {
    return hlPlaceOrder(this.client, params);
  }

  /**
   * Close all open positions on HyperLiquid.
   */
  async hlCloseAll(params: HlCloseAllParams): Promise<HlResponse> {
    return hlCloseAll(this.client, params);
  }

  /**
   * Cancel a specific order on HyperLiquid.
   */
  async hlCancelOrder(params: HlCancelOrderParams): Promise<HlResponse> {
    return hlCancelOrder(this.client, params);
  }

  /**
   * Cancel all open orders on HyperLiquid.
   */
  async hlCancelAllOrders(params: HlCancelAllOrdersParams): Promise<HlResponse> {
    return hlCancelAllOrders(this.client, params);
  }

  /**
   * Update leverage for a specific asset on HyperLiquid.
   */
  async hlUpdateLeverage(params: HlUpdateLeverageParams): Promise<HlResponse> {
    return hlUpdateLeverage(this.client, params);
  }

  // ── Limit Orders ───────────────────────────────────────────────────────────

  /**
   * Create a limit order.
   *
   * @param params - Order parameters
   * @returns Created limit order object
   */
  async createLimitOrder(params: CreateLimitOrderParams): Promise<LimitOrder> {
    return createLimitOrder(this.client, params);
  }

  /**
   * Cancel an existing limit order.
   *
   * @param params - Cancel parameters (orderId and chain)
   */
  async cancelLimitOrder(params: CancelLimitOrderParams): Promise<void> {
    return cancelLimitOrder(this.client, params);
  }

  /**
   * Get limit orders for a wallet.
   *
   * @param params - Query parameters
   * @returns List of limit orders
   */
  async getLimitOrders(params: GetLimitOrdersParams): Promise<LimitOrder[]> {
    return getLimitOrders(this.client, params);
  }

  // ── Copy Trading ───────────────────────────────────────────────────────────

  /**
   * Get copy trade settings for a user.
   *
   * @param params - Query parameters
   * @returns Current copy trade settings
   */
  async getCopyTradeSettings(params: GetCopyTradeSettingsParams): Promise<CopyTradeSettings> {
    return getCopyTradeSettings(this.client, params);
  }

  /**
   * Update copy trade settings.
   *
   * @param settings - New settings to apply
   */
  async setCopyTradeSettings(settings: CopyTradeSettings): Promise<void> {
    return setCopyTradeSettings(this.client, settings);
  }

  /**
   * Get all wallets being tracked for copy trading.
   *
   * @param userId - User ID
   * @returns List of tracked wallets
   */
  async getCopyTradeWallets(userId: string): Promise<CopyTradeWallet[]> {
    return getCopyTradeWallets(this.client, userId);
  }

  /**
   * Add a wallet to copy trade tracking.
   *
   * @param params - Add wallet parameters
   */
  async addCopyTradeWallet(params: AddWalletParams): Promise<void> {
    return addCopyTradeWallet(this.client, params);
  }

  /**
   * Remove a wallet from copy trade tracking.
   *
   * @param params - Remove wallet parameters
   */
  async removeCopyTradeWallet(params: RemoveWalletParams): Promise<void> {
    return removeCopyTradeWallet(this.client, params);
  }

  // ── Portfolio ──────────────────────────────────────────────────────────────

  /**
   * Get the full cross-chain portfolio for a wallet.
   *
   * Returns all token balances with USD values across all supported chains.
   *
   * @param params - Portfolio query parameters
   * @returns Portfolio with balances and positions
   */
  async getPortfolio(params: PortfolioParams): Promise<Portfolio> {
    return getPortfolio(this.client, params);
  }

  /**
   * Get token balances for a wallet on a specific chain.
   *
   * @param params - Balance query parameters
   * @returns List of token balances
   */
  async getBalances(params: BalanceParams): Promise<Balance[]> {
    return getBalances(this.client, params);
  }

  /**
   * Get trade history for a wallet.
   *
   * @param params - Trade history query parameters
   * @returns List of historical trades
   */
  async getTradeHistory(params: TradeHistoryParams): Promise<TradeRecord[]> {
    return getTradeHistory(this.client, params);
  }

  // ── Token Info ─────────────────────────────────────────────────────────────

  /**
   * Get detailed information about a specific token.
   *
   * Includes price, market cap, liquidity, DEX pools, and social links.
   * No authentication required.
   *
   * @param params - Token details parameters
   * @returns Token details object
   */
  async getTokenDetails(params: TokenDetailsParams): Promise<TokenDetails> {
    return getTokenDetails(this.client, params);
  }

  /**
   * Get trending tokens across all chains or a specific chain.
   *
   * @param params - Trending query parameters
   * @returns List of trending tokens sorted by rank
   */
  async getTrendingTokens(params?: TrendingParams): Promise<TrendingToken[]> {
    return getTrendingTokens(this.client, params);
  }

  /**
   * Get OHLCV candlestick data for a token.
   *
   * No authentication required.
   *
   * @param params - OHLCV query parameters
   * @returns OHLCV data with candle array
   */
  async getOHLCV(params: OHLCVParams): Promise<OHLCVData> {
    return getOHLCV(this.client, params);
  }

  // ── Top Traders ────────────────────────────────────────────────────────────

  /**
   * Get top performing traders across chains.
   *
   * @param params - Query parameters
   * @returns List of top traders with P&L statistics
   */
  async getTopTraders(params?: TopTradersParams): Promise<TopTrader[]> {
    return getTopTraders(this.client, params);
  }

  // ── Bridge ─────────────────────────────────────────────────────────────────

  /**
   * Bridge tokens from one chain to another.
   *
   * @param params - Bridge parameters
   * @returns Bridge result with transaction hashes
   */
  async bridge(params: BridgeParams): Promise<BridgeResult> {
    return bridge(this.client, params);
  }

  /**
   * Get a bridge quote without executing the transaction.
   *
   * @param params - Bridge parameters (amount required)
   * @returns Quote with expected output amount and fees
   */
  async getBridgeQuote(params: BridgeParams): Promise<BridgeQuote> {
    return getBridgeQuote(this.client, params);
  }

  // ── Wallet ─────────────────────────────────────────────────────────────────

  /**
   * Get wallet information including native token balance.
   *
   * @param params - Wallet info parameters
   * @returns Wallet info object
   */
  async getWalletInfo(params: WalletInfoParams): Promise<WalletInfo> {
    return getWalletInfo(this.client, params);
  }

  // ── Wallet Generation ─────────────────────────────────────────────────────

  /**
   * Generate a new EVM control wallet (Ethereum, Base, Arbitrum, BSC, etc.).
   *
   * This is your **control wallet** used to authenticate with the Gbot backend.
   * Once authenticated, the backend automatically provides a full trading wallet
   * (including a Solana address and other chain-specific keys) — no separate
   * Solana wallet generation is needed.
   *
   * Uses `ethers.Wallet.createRandom()` with the platform CSPRNG.
   * The private key is returned to the caller and is never transmitted over
   * the network.
   *
   * @returns New EVM wallet with address, private key, and mnemonic.
   *
   * @example
   * ```typescript
   * // One-time setup: generate your EVM control wallet
   * const wallet = skill.generateEvmWallet();
   * console.log('Address:', wallet.address);
   * // ⚠️  Store wallet.privateKey and wallet.mnemonic securely!
   *
   * // Authenticate — the backend will provision your trading wallets
   * await skill.authenticate({ type: 'evm', address: wallet.address, privateKey: wallet.privateKey });
   *
   * // Now trade on any supported chain (Solana, EVM, etc.)
   * const trade = await skill.buyToken({ chain: 'solana', tokenAddress: '...', amount: '0.1' });
   * ```
   */
  generateEvmWallet(): GeneratedEvmWallet {
    return generateEvmWallet();
  }
}

export default GdexSkill;
