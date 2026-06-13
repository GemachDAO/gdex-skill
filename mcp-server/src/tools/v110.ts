/**
 * MCP tools for backend v1.1.0 additions:
 *   - Transfers
 *   - Social / watchlist / token import
 *   - Portfolio analytics
 *   - Extended token discovery
 *   - HyperLiquid HIP-3 outcomes
 *   - HyperLiquid referral
 *   - Trending promotion
 *   - Retailer onboarding
 *   - HyperLiquid extras (enable trading, swap collateral, builder referral, copy PnL)
 *   - OAuth / email association
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSdk, handleToolCall } from '../sdk.js';

export function registerV110Tools(server: McpServer): void {
  // ── Transfers ────────────────────────────────────────────────────────────
  server.tool(
    'transfer_native',
    'Transfer native asset (ETH, SOL, SUI, BNB, ...) via managed custody. Requires pre-built encrypted computedData.',
    {
      computedData: z.string().describe('Encrypted computedData payload'),
      chainId: z.union([z.string(), z.number()]).optional().describe('Optional chain id hint'),
    },
    async (params: any) => handleToolCall(async () => getSdk().transferNative(params as any)),
  );

  server.tool(
    'transfer_token',
    'Transfer ERC20 / SPL token via managed custody. Requires pre-built encrypted computedData.',
    {
      computedData: z.string().describe('Encrypted computedData payload'),
      chainId: z.union([z.string(), z.number()]).optional().describe('Optional chain id hint'),
    },
    async (params: any) => handleToolCall(async () => getSdk().transferToken(params as any)),
  );

  // ── Social / Watchlist ───────────────────────────────────────────────────
  server.tool(
    'add_comment',
    'Post a comment on a token.',
    {
      tokenAddress: z.string(),
      chain: z.union([z.string(), z.number()]),
      message: z.string(),
      userId: z.string(),
      data: z.string().optional(),
    },
    async (params: any) => handleToolCall(async () => getSdk().addComment(params as any)),
  );

  server.tool(
    'get_comments',
    'Get comments for a token.',
    {
      tokenAddress: z.string(),
      chain: z.union([z.string(), z.number()]),
      page: z.number().optional(),
      limit: z.number().optional(),
    },
    async (params: any) => handleToolCall(async () => getSdk().getComments(params as any)),
  );

  server.tool(
    'vote_sentiment',
    'Cast a bullish/bearish sentiment vote on a token.',
    {
      tokenAddress: z.string(),
      chain: z.union([z.string(), z.number()]),
      sentiment: z.string().describe("'bullish' | 'bearish'"),
      userId: z.string(),
      data: z.string().optional(),
    },
    async (params: any) => handleToolCall(async () => getSdk().voteSentiment(params as any)),
  );

  server.tool(
    'get_watchlist',
    "Fetch the user's watchlist.",
    {
      userId: z.string(),
      data: z.string().optional(),
    },
    async (params: any) => handleToolCall(async () => getSdk().getWatchList(params as any)),
  );

  server.tool(
    'change_watchlist',
    "Add or remove a token from the user's watchlist via managed custody. Requires pre-built encrypted computedData.",
    {
      computedData: z.string().describe('Encrypted computedData payload'),
      chainId: z.union([z.string(), z.number()]).optional().describe('Optional chain id hint'),
    },
    async (params: any) => handleToolCall(async () => getSdk().changeWatchList(params as any)),
  );

  server.tool(
    'import_token',
    'Import a user-defined custom token into the platform via managed custody. Requires pre-built encrypted computedData.',
    {
      computedData: z.string().describe('Encrypted computedData payload'),
      chainId: z.union([z.string(), z.number()]).optional().describe('Optional chain id hint'),
    },
    async (params: any) => handleToolCall(async () => getSdk().importToken(params as any)),
  );

  // ── Portfolio Analytics ──────────────────────────────────────────────────
  server.tool(
    'get_wallet_performance',
    'Get wallet performance / PnL summary across recent periods.',
    {
      walletAddress: z.string(),
      chain: z.union([z.string(), z.number()]).optional(),
      period: z.string().optional(),
    },
    async (params: any) => handleToolCall(async () => getSdk().getWalletPerformance(params as any)),
  );

  server.tool(
    'get_nof1_analytics',
    'Get NoF1 advanced trader analytics for a wallet.',
    {
      walletAddress: z.string(),
      chain: z.union([z.string(), z.number()]).optional(),
    },
    async (params: any) => handleToolCall(async () => getSdk().getNof1Analytics(params as any)),
  );

  server.tool(
    'get_native_prices',
    'Get current native token prices (ETH, SOL, SUI, BNB, ...) keyed by chain.',
    {
      chainIds: z.array(z.union([z.string(), z.number()])).optional(),
    },
    async (params: any) => handleToolCall(async () => getSdk().getNativePrices(params as any)),
  );

  server.tool(
    'generate_pnl',
    'Trigger backend PnL generation for a wallet.',
    {
      walletAddress: z.string(),
      chain: z.union([z.string(), z.number()]).optional(),
      startTime: z.number().optional(),
      endTime: z.number().optional(),
    },
    async (params: any) => handleToolCall(async () => getSdk().generatePnl(params as any)),
  );

  // ── Extended Token Discovery ─────────────────────────────────────────────
  const tokenListShape = {
    chain: z.union([z.string(), z.number()]).optional(),
    limit: z.number().optional(),
    page: z.number().optional(),
  };

  server.tool(
    'get_newest_tokens',
    'Get newest tokens across all chains (or a specific chain).',
    tokenListShape,
    async (params: any) => handleToolCall(async () => getSdk().getNewestTokens(params as any)),
  );

  server.tool(
    'get_top_tokens',
    'Get top tokens by volume / market cap.',
    tokenListShape,
    async (params: any) => handleToolCall(async () => getSdk().getTopTokens(params as any)),
  );

  server.tool(
    'get_bigbuys',
    '"Big buy" alert feed for a chain — recent large buy transactions.',
    {
      chainId: z.union([z.string(), z.number()]).describe('Chain id, e.g. 622112261 for Solana'),
      limit: z.number().optional(),
    },
    async (params: any) => handleToolCall(async () => getSdk().getBigBuys(params as any)),
  );

  server.tool(
    'get_currently_live',
    'Currently-livestreaming token launches.',
    tokenListShape,
    async (params: any) => handleToolCall(async () => getSdk().getCurrentlyLiveTokens(params as any)),
  );

  server.tool(
    'get_live_status',
    'Livestream status for a single token address.',
    {
      address: z.string().describe('Token mint / contract address'),
    },
    async (params: any) => handleToolCall(async () => getSdk().getLiveStatus(params as any)),
  );

  server.tool(
    'get_xstocks',
    'List tokenised equities (xStocks).',
    tokenListShape,
    async (params: any) => handleToolCall(async () => getSdk().getXstocks(params as any)),
  );

  server.tool(
    'get_zora_tokens',
    'List Zora-protocol tokens.',
    tokenListShape,
    async (params: any) => handleToolCall(async () => getSdk().getZoraTokens(params as any)),
  );

  server.tool(
    'get_token_trades',
    'Recent trades for a specific token.',
    {
      tokenAddress: z.string(),
      chain: z.union([z.string(), z.number()]),
      limit: z.number().optional(),
      page: z.number().optional(),
    },
    async (params: any) => handleToolCall(async () => getSdk().getTokenTrades(params as any)),
  );

  server.tool(
    'get_token_image',
    'Get server-rendered token social-card image metadata.',
    {
      tokenAddress: z.string(),
      chain: z.union([z.string(), z.number()]),
    },
    async (params: any) => handleToolCall(async () => getSdk().getTokenImage(params as any)),
  );

  // ── HyperLiquid Outcomes (HIP-3 event markets) ───────────────────────────
  server.tool(
    'hl_outcomes',
    'List available HyperLiquid outcome / event markets. Set withVolume=true to enrich each market with volume24hUsd (24h notional, from the HL WS feed) — adds a few seconds.',
    {
      dex: z.string().optional(),
      status: z.string().optional(),
      withVolume: z.boolean().optional().describe('Include 24h volume per market (slower)'),
    },
    async (params: any) =>
      handleToolCall(async () => {
        const { withVolume, ...rest } = params ?? {};
        return withVolume ? getSdk().getHlOutcomesWithVolume(rest as any) : getSdk().getHlOutcomes(rest as any);
      }),
  );

  server.tool(
    'get_hl_outcome_volumes',
    'Get 24h notional volume (USD) per outcome coin from the HyperLiquid WS feed. Pass coins like ["#1010","#1011"]; returns a { coin: volumeUsd } map. Sum a market\'s side coins for its total 24h volume.',
    {
      coins: z.array(z.string()).describe('Outcome coin names, e.g. ["#1010","#1011"]'),
    },
    async (params: any) => handleToolCall(async () => getSdk().getHlOutcomeVolumes(params.coins as string[])),
  );

  server.tool(
    'hl_outcome_account',
    'Get HyperLiquid outcomes account state for a wallet on a specific outcome market (coins, positions, open orders).',
    {
      userAddress: z.string(),
      outcomeId: z.union([z.string(), z.number()]).describe('Outcome market id, e.g. 101'),
    },
    async (params: any) => handleToolCall(async () => getSdk().getHlOutcomeAccount(params as any)),
  );

  server.tool(
    'hl_create_outcome_order',
    'Create an order on a HyperLiquid outcome (HIP-3) market. Pass structured params (apiKey, walletAddress=control address, sessionPrivateKey, outcomeId, coin like "#1010", isBuy, price 0-1, size) and the SDK builds the encrypted payload. A pre-built computedData is also accepted.',
    {
      apiKey: z.string().optional(),
      walletAddress: z.string().optional().describe('CONTROL wallet address from sign-in'),
      sessionPrivateKey: z.string().optional(),
      outcomeId: z.union([z.string(), z.number()]).optional(),
      coin: z.string().optional().describe('Outcome asset id, e.g. "#1010" (outcome 101 Yes)'),
      isBuy: z.boolean().optional(),
      price: z.string().optional().describe('Limit price in [0,1]; pass "0" for market'),
      size: z.string().optional().describe('Order size in contracts'),
      reduceOnly: z.boolean().optional(),
      isMarket: z.boolean().optional(),
      computedData: z.string().optional(),
      dex: z.string().optional(),
    },
    async (params: any) => handleToolCall(async () => getSdk().createHlOutcomeOrder(params as any)),
  );

  server.tool(
    'hl_cancel_outcome_order',
    'Cancel a HyperLiquid outcome-market order. Pass structured params (apiKey, walletAddress, sessionPrivateKey, outcomeId, coin, orderId) or a pre-built computedData.',
    {
      apiKey: z.string().optional(),
      walletAddress: z.string().optional(),
      sessionPrivateKey: z.string().optional(),
      outcomeId: z.union([z.string(), z.number()]).optional(),
      coin: z.string().optional(),
      orderId: z.string().optional(),
      computedData: z.string().optional(),
      dex: z.string().optional(),
    },
    async (params: any) => handleToolCall(async () => getSdk().cancelHlOutcomeOrder(params as any)),
  );

  server.tool(
    'hl_close_outcome_order',
    'Close a HyperLiquid outcome-market position. Pass structured params (apiKey, walletAddress, sessionPrivateKey, outcomeId, coin, price, size, isMarket) or a pre-built computedData.',
    {
      apiKey: z.string().optional(),
      walletAddress: z.string().optional(),
      sessionPrivateKey: z.string().optional(),
      outcomeId: z.union([z.string(), z.number()]).optional(),
      coin: z.string().optional(),
      price: z.string().optional(),
      size: z.string().optional(),
      isMarket: z.boolean().optional(),
      computedData: z.string().optional(),
      dex: z.string().optional(),
    },
    async (params: any) => handleToolCall(async () => getSdk().closeHlOutcomeOrder(params as any)),
  );

  // ── HyperLiquid Referral ─────────────────────────────────────────────────
  server.tool(
    'hl_ref_info',
    'Get HyperLiquid referral info (earned, eligibility, code).',
    { userAddress: z.string() },
    async (params: any) => handleToolCall(async () => getSdk().getHlReferralInfo(params as any)),
  );

  server.tool(
    'hl_ref_claim',
    'Submit a claim request for accrued HL referral rewards. Requires pre-built computedData.',
    { computedData: z.string() },
    async (params: any) => handleToolCall(async () => getSdk().requestHlReferralClaim(params as any)),
  );

  // ── Trending Promotion ───────────────────────────────────────────────────
  server.tool(
    'trending_list',
    'List currently promoted / booked trending tokens.',
    {
      chain: z.union([z.string(), z.number()]).optional(),
      limit: z.number().optional(),
    },
    async (params: any) => handleToolCall(async () => getSdk().getTrendingList(params as any)),
  );

  server.tool(
    'trending_options',
    'List available trending-slot packages and prices.',
    {},
    async () => handleToolCall(async () => getSdk().getTrendingOptions()),
  );

  server.tool(
    'trending_register',
    'Register / pay for a trending slot.',
    {
      tokenAddress: z.string(),
      chain: z.union([z.string(), z.number()]),
      slot: z.union([z.string(), z.number()]).optional(),
      durationHours: z.number().optional(),
      userId: z.string(),
      data: z.string().optional(),
      computedData: z.string().optional(),
    },
    async (params: any) => handleToolCall(async () => getSdk().registerTrending(params as any)),
  );

  server.tool(
    'trending_booking_status',
    'Check trending-slot booking status (pending payment, active, expired).',
    {
      bookingId: z.string().optional(),
      tokenAddress: z.string().optional(),
      chain: z.union([z.string(), z.number()]).optional(),
    },
    async (params: any) => handleToolCall(async () => getSdk().getTrendingBookingStatus(params as any)),
  );

  // ── Retailer ─────────────────────────────────────────────────────────────
  server.tool(
    'get_retailers',
    'List registered retailer integrations / branded onboarding partners.',
    {
      retailer: z.string().optional(),
    },
    async (params: any) => handleToolCall(async () => getSdk().getRetailers(params as any)),
  );

  // ── HyperLiquid Extras ───────────────────────────────────────────────────
  server.tool(
    'hl_enable_trading',
    'Enable HL trading for a managed wallet (one-time, required before outcome/HIP-3 orders). Pass apiKey, walletAddress (control address), sessionPrivateKey and the SDK builds the payload; a pre-built computedData is also accepted.',
    {
      apiKey: z.string().optional(),
      walletAddress: z.string().optional().describe('CONTROL wallet address from sign-in'),
      sessionPrivateKey: z.string().optional(),
      computedData: z.string().optional(),
    },
    async (params: any) => handleToolCall(async () => getSdk().hlEnableTrading(params as any)),
  );

  server.tool(
    'hl_swap_collateral',
    'Swap collateral between HL clearinghouses/perp DEXes (HIP-3). Pass apiKey, walletAddress, sessionPrivateKey, fromToken, toToken, amount or a pre-built computedData.',
    {
      apiKey: z.string().optional(),
      walletAddress: z.string().optional(),
      sessionPrivateKey: z.string().optional(),
      fromToken: z.string().optional(),
      toToken: z.string().optional(),
      amount: z.string().optional(),
      computedData: z.string().optional(),
      fromDex: z.string().optional(),
      toDex: z.string().optional(),
    },
    async (params: any) => handleToolCall(async () => getSdk().hlSwapCollateral(params as any)),
  );

  server.tool(
    'hl_builder_referral',
    'Get builder-referral metadata for a wallet.',
    { userAddress: z.string() },
    async (params: any) => handleToolCall(async () => getSdk().getHlBuilderReferral(params as any)),
  );

  server.tool(
    'hl_list_user_copy_pnl',
    'Per-user realised PnL from HL copy-trading.',
    {
      userAddress: z.string(),
      page: z.number().optional(),
      limit: z.number().optional(),
    },
    async (params: any) => handleToolCall(async () => getSdk().getHlListUserCopyPnl(params as any)),
  );

  server.tool(
    'hl_tx_list',
    'Get HL transaction list (fills / orders) for a wallet.',
    {
      userAddress: z.string(),
      page: z.number().optional(),
      limit: z.number().optional(),
      dex: z.string().optional(),
    },
    async (params: any) => handleToolCall(async () => getSdk().getHlTxList(params as any)),
  );

  // ── OAuth / Email association ────────────────────────────────────────────
  // Backend: POST /v1/auth/oauth-login and POST /v1/auth/associate-email
  // (ServiceMain.oauthLogin / ServiceMain.associateEmail, v1.1.0). Google
  // ID tokens only; if oauth-login returns 404/code 108 the wallet has no
  // associated email yet and the caller must call associate_email first.
  server.tool(
    'oauth_login',
    'Log in or sign up using a Google ID token. Google OIDC only — there is no Apple/GitHub branch. If the wallet has no associated email yet, the backend returns 404 with internal code 108 and the caller must invoke associate_email first (using the same idToken) before retrying.',
    {
      idToken: z.string().describe('Google-issued OIDC ID token (JWT).'),
      chainId: z
        .union([z.string(), z.number()])
        .optional()
        .describe('Optional chain id hint for wallet resolution.'),
    },
    async (params: any) => handleToolCall(async () => getSdk().oauthLogin(params as any)),
  );

  server.tool(
    'associate_email',
    'Link the email claim from a Google ID token to the caller\'s wallet. Must be called before oauth_login when the wallet has no associated email yet (oauth-login returns 404/code 108). The email is NOT sent by the client — the backend extracts it server-side from the verified Google idToken. computedData must be built with buildAssociateEmailComputedData (managed-custody payload).',
    {
      computedData: z
        .string()
        .describe('Managed-custody encrypted payload from buildAssociateEmailComputedData.'),
      idToken: z
        .string()
        .describe('Google-issued OIDC ID token (JWT). Backend extracts the email claim from this token.'),
    },
    async (params: any) => handleToolCall(async () => getSdk().associateEmail(params as any)),
  );
}
