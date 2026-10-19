/**
 * MCP tools for backend v1.1.0 additions:
 *   - Transfers
 *   - Social / watchlist / token import
 *   - Portfolio analytics
 *   - Extended token discovery
 *   - Hyperliquid HIP-4 outcome markets
 *   - HyperLiquid referral
 *   - Trending promotion
 *   - Retailer onboarding
 *   - HyperLiquid extras (enable trading, swap collateral, builder referral, copy PnL)
 *   - OAuth / email association
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { resolveOutcomeWriteMode } from '@gemachdao/gdex-skill';
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

  // ── Hyperliquid HIP-4 outcome markets ────────────────────────────────────
  // Hyperliquid HIP-4 outcome markets only (not HIP-3 perps, not Polymarket/Kalshi —
  // GDEX has no Polymarket or Kalshi integration). Write tools take EITHER the
  // structured fields OR a pre-built computedData; mixing is rejected at runtime
  // (resolveOutcomeWriteMode) because zod unions don't fit the server.tool shape API.
  const outcomeStateEnum = z.enum(['active', 'pre_launch', 'expired', 'settled']);
  const outcomeCreds = {
    apiKey: z.string().optional().describe('Structured mode: API key'),
    walletAddress: z.string().optional().describe('Structured mode: CONTROL wallet address from sign-in (not the managed address)'),
    sessionPrivateKey: z.string().optional().describe('Structured mode: session private key'),
  };
  const sideSelector = {
    coin: z.string().optional().describe('Side coin "#<assetId>" from hl_outcomes sides[].coin. Give exactly one of coin / sideIndex / sideLabel.'),
    sideIndex: z.number().int().optional().describe('Side index in sides[] (sides are NOT always Yes/No; read the labels)'),
    sideLabel: z.string().optional().describe('Exact side label from sides[].label, e.g. "No" or a team name'),
  };
  const prebuilt = {
    computedData: z.string().optional().describe('Pre-built mode ONLY: encrypted payload. Must be sent alone (no structured fields).'),
  };

  server.tool(
    'hl_outcomes',
    'Discover Hyperliquid HIP-4 outcome markets (GDEX has no Polymarket/Kalshi). Returns normalised markets: outcomeId, title, sides[] (label, coin "#<assetId>", balanceCoin "+<assetId>", mid price), quoteToken (collateral, held in the HL spot balance), state (active | pre_launch | expired | settled), rules (price 0.00001-0.99999 tick 0.00001, whole-contract size, min order notional 11 quote), settlement (no claim via GDEX). withVolume=true adds volume24h {volume, asOf, source, coverage} with a bounded wait. raw=true returns the backend payload unchanged.',
    {
      state: z.union([outcomeStateEnum, z.array(outcomeStateEnum)]).optional().describe('Filter by trading state, e.g. "active"'),
      query: z.string().optional().describe('Case-insensitive text match on title / side labels / params, or an exact outcomeId'),
      excludeFallback: z.boolean().optional().describe('Hide "none of the listed outcomes" legs'),
      limit: z.number().int().min(0).optional(),
      withVolume: z.boolean().optional().describe('Attach 24h volume (bounded by volumeTimeoutMs, default 2500)'),
      volumeTimeoutMs: z.number().int().min(100).max(10000).optional(),
      raw: z.boolean().optional().describe('Return the raw backend payload instead'),
    },
    async (params: any) =>
      handleToolCall(async () => {
        const { raw, withVolume, volumeTimeoutMs, ...rest } = params ?? {};
        if (raw) {
          return withVolume
            ? getSdk().getHlOutcomesWithVolume({}, volumeTimeoutMs ? { timeoutMs: volumeTimeoutMs } : undefined)
            : getSdk().getHlOutcomes({});
        }
        return getSdk().getHlOutcomeMarkets({ ...rest, withVolume, volumeTimeoutMs });
      }),
  );

  server.tool(
    'get_hl_outcome_volumes',
    'Get 24h notional volume per outcome side coin from the Hyperliquid WS feed. Pass coins from hl_outcomes sides[].coin, e.g. ["#143150","#143151"]. Returns { coin: volume } for coins that reported; a missing coin means no reading (not zero). Prefer hl_outcomes withVolume=true, which reports coverage per market.',
    {
      coins: z.array(z.string()).describe('Outcome side coins, e.g. ["#143150","#143151"]'),
    },
    async (params: any) => handleToolCall(async () => getSdk().getHlOutcomeVolumes(params.coins as string[])),
  );

  server.tool(
    'hl_outcome_account',
    'Normalised state of a MANAGED wallet on one HIP-4 outcome market: positions (per side: size, hold, available, avgEntryPrice, markPrice, value, unrealizedPnl), openOrders (resting / partially_filled with orderId, price, size, filledSize), fills, historicalOrders (Hyperliquid status). Use it to reconcile after create/cancel/close. raw=true returns the backend payload.',
    {
      userAddress: z.string().describe('MANAGED wallet address (outcome balances live there)'),
      outcomeId: z.union([z.string(), z.number()]).describe('Outcome market id from hl_outcomes'),
      raw: z.boolean().optional(),
    },
    async (params: any) =>
      handleToolCall(async () => {
        const { raw, ...rest } = params ?? {};
        return raw ? getSdk().getHlOutcomeAccount(rest as any) : getSdk().getHlOutcomeAccountState(rest as any);
      }),
  );

  server.tool(
    'hl_outcome_check_collateral',
    'Check the managed wallet\'s Hyperliquid SPOT balance of a market\'s quoteToken (outcome buys draw on spot collateral, not the perp account) against size × price.',
    {
      managedAddress: z.string().describe('MANAGED wallet address'),
      quoteToken: z.string().optional().describe('Market quoteToken from hl_outcomes (default USDC)'),
      size: z.string().optional().describe('Intended contracts'),
      price: z.string().optional().describe('Intended limit price'),
    },
    async (params: any) => handleToolCall(async () => getSdk().checkHlOutcomeCollateral(params as any)),
  );

  server.tool(
    'hl_create_outcome_order',
    'Place an order on a Hyperliquid HIP-4 outcome market. Structured mode (apiKey, walletAddress=control address, sessionPrivateKey, outcomeId, one of coin/sideIndex/sideLabel, isBuy, size, and price unless isMarket) is validated against the live market first: side must belong to outcomeId, size is whole contracts, price in [0.00001, 0.99999] with max 5 decimals, size×price >= 11 quote (a full-position sell is exempt when managedAddress is given), market must not be expired/settled. isBuy=false sells side tokens you hold. reduceOnly is ignored by the backend. Returns status resting (with orderId) | filled | rejected. Pre-built mode: computedData alone.',
    {
      ...outcomeCreds,
      outcomeId: z.union([z.string(), z.number()]).optional().describe('Structured mode: outcome market id'),
      ...sideSelector,
      isBuy: z.boolean().optional().describe('Structured mode: true buys side tokens; false sells held tokens'),
      price: z.string().optional().describe('Limit price, e.g. "0.42" (omit for isMarket)'),
      size: z.string().optional().describe('Whole contracts, e.g. "30"'),
      isMarket: z.boolean().optional().describe('Take the book at ±5% of top of book'),
      reduceOnly: z.boolean().optional().describe('Ignored by the backend'),
      managedAddress: z.string().optional().describe('Managed wallet; enables position-aware sell checks'),
      ...prebuilt,
    },
    async (params: any) =>
      handleToolCall(async () => {
        resolveOutcomeWriteMode(params ?? {}, ['apiKey', 'walletAddress', 'sessionPrivateKey', 'outcomeId', 'isBuy', 'size']);
        return getSdk().createHlOutcomeOrder(params as any);
      }),
  );

  server.tool(
    'hl_cancel_outcome_order',
    'Cancel a resting HIP-4 outcome order. Structured mode: apiKey, walletAddress (control), sessionPrivateKey, outcomeId, coin (must belong to outcomeId), orderId (numeric Hyperliquid oid from hl_create_outcome_order or hl_outcome_account openOrders). Partial fills before the cancel stay in the position. Pre-built mode: computedData alone.',
    {
      ...outcomeCreds,
      outcomeId: z.union([z.string(), z.number()]).optional(),
      coin: z.string().optional().describe('Side coin "#<assetId>" of the order'),
      orderId: z.string().optional().describe('Numeric Hyperliquid oid'),
      ...prebuilt,
    },
    async (params: any) =>
      handleToolCall(async () => {
        resolveOutcomeWriteMode(params ?? {}, ['apiKey', 'walletAddress', 'sessionPrivateKey', 'outcomeId', 'coin', 'orderId']);
        return getSdk().cancelHlOutcomeOrder(params as any);
      }),
  );

  server.tool(
    'hl_close_outcome_order',
    'Exit a HIP-4 outcome position by SELLING held side tokens (the backend always sells; it cannot short). Structured mode: apiKey, walletAddress (control), sessionPrivateKey, outcomeId, one of coin/sideIndex/sideLabel, price (limit) or isMarket=true, optional size (whole contracts; omit for a full exit — the backend caps size to what you hold). With managedAddress, partial exits must leave both the sold part and the remainder >= 11 quote. Settled markets have no book: GDEX has no claim endpoint, check the HL spot balance instead. Pre-built mode: computedData alone.',
    {
      ...outcomeCreds,
      outcomeId: z.union([z.string(), z.number()]).optional(),
      ...sideSelector,
      price: z.string().optional().describe('Limit price (omit for isMarket)'),
      size: z.string().optional().describe('Contracts to sell; omit for the full position'),
      isMarket: z.boolean().optional(),
      managedAddress: z.string().optional().describe('Managed wallet; enables position-aware partial-exit checks'),
      ...prebuilt,
    },
    async (params: any) =>
      handleToolCall(async () => {
        resolveOutcomeWriteMode(params ?? {}, ['apiKey', 'walletAddress', 'sessionPrivateKey', 'outcomeId']);
        return getSdk().closeHlOutcomeOrder(params as any);
      }),
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
