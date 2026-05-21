/**
 * All API endpoint constants for the Gbot backend (v1.1.0).
 *
 * Source of truth: gbotTradingDashboardBackend/src/api/routes/*.ts. Constants
 * removed in PR 3 of the v1.1.0 sweep:
 *   - /v1/auth/nonce, /v1/auth/login, /v1/auth/refresh, /v1/auth/logout
 *     (no wallet-signing nonce/login flow on v1.1.0 — see /v1/sign_in)
 *   - /v1/user/update, /v1/wallet/info, /v1/balances
 *   - /v1/trade/status (replaced by tradeStatusPath(requestId))
 *   - /v1/token/search (replaced by /v1/trading_view/search)
 *   - /v1/trading_view/{config,symbols,history} (parameterised per provider)
 *   - duplicate TRENDING_LIST / TRENDING
 *   - TRADE_HISTORY renamed to USER_HISTORY (path is /v1/user_history; legacy
 *     /v1/user_trade_history is not present on v1.1.0)
 */

/** Auth endpoints */
export const AUTH_SIGN_IN = '/v1/sign_in';
export const AUTH_OAUTH_LOGIN = '/v1/auth/oauth-login';
export const AUTH_ASSOCIATE_EMAIL = '/v1/auth/associate-email';

/** User endpoints */
export const USER_PROFILE = '/v1/user';
export const USER_CONFIG = '/v1/config';
export const USER_SWITCH_CHAIN = '/v1/switch_chain';

/** Admin endpoints */
export const ADMIN_STATS = '/v1/admin/stats';
export const ADMIN_ADD = '/v1/admin/add';

/** Trading endpoints */
export const PURCHASE_V2 = '/v1/purchase_v2';
export const SELL_V2 = '/v1/sell_v2';
export const TRADE_STATUS_BASE = '/v1/trade-status';
export const tradeStatusPath = (requestId: string): string => `${TRADE_STATUS_BASE}/${requestId}`;

/** Portfolio endpoints — balances are embedded under portfolio.balances[] */
export const PORTFOLIO = '/v1/portfolio';
/** User history (trades). Replaces legacy /v1/user_trade_history. */
export const USER_HISTORY = '/v1/user_history';

/** Order endpoints */
export const ORDERS = '/v1/orders';
export const LIMIT_BUY = '/v1/limit_buy';
export const LIMIT_SELL = '/v1/limit_sell';
export const UPDATE_ORDER = '/v1/update_order';

/** HyperLiquid perp endpoints (managed custody computedData) */
export const HL_DEPOSIT = '/v1/hl/deposit';
export const HL_WITHDRAW = '/v1/hl/withdraw';
export const HL_CREATE_ORDER = '/v1/hl/create_order';
export const HL_PLACE_ORDER = '/v1/hl/place_order';
export const HL_CLOSE_ALL = '/v1/hl/close_all_positions';
export const HL_CANCEL_ORDER = '/v1/hl/cancel_order';
export const HL_UPDATE_LEVERAGE = '/v1/hl/update_leverage';
export const HL_GBOT_USDC_BALANCE = '/v1/hl/gbot_usdc_balance';
export const HL_USER_STATS = '/v1/hl/user_stats';

/** HyperLiquid perp copy trade endpoints */
export const HL_COPY_LIST = '/v1/hl/list';
export const HL_COPY_TX_LIST = '/v1/hl/tx_list';
export const HL_COPY_CREATE = '/v1/hl/create';
export const HL_COPY_UPDATE = '/v1/hl/update';
export const HL_TOP_TRADERS = '/v1/hl/top_traders';
export const HL_TOP_TRADERS_BY_PNL = '/v1/hl/top_traders_by_pnl';
export const HL_PERP_DEXES = '/v1/hl/perp_dexes';
export const HL_ALL_ASSETS = '/v1/hl/all_assets';
export const HL_CLEARINGHOUSE_STATE = '/v1/hl/clearinghouse_state';
export const HL_CLEARINGHOUSE_STATE_ALL = '/v1/hl/clearinghouse_state_all';
export const HL_OPEN_ORDERS = '/v1/hl/open_orders';
export const HL_OPEN_ORDERS_ALL = '/v1/hl/open_orders_all';
export const HL_META_AND_ASSET_CTXS = '/v1/hl/meta_and_asset_ctxs';
export const HL_DEPOSIT_TOKENS = '/v1/hl/deposit_tokens';
export const HL_USDC_BALANCE = '/v1/hl/usdc_balance';

/** Copy trade endpoints */
export const COPY_TRADE_LIST = '/v1/copy_trade/list';
export const COPY_TRADE_TX_LIST = '/v1/copy_trade/tx_list';
export const COPY_TRADE_CREATE = '/v1/copy_trade/create';
export const COPY_TRADE_UPDATE = '/v1/copy_trade/update';
export const COPY_TRADE_WALLETS = '/v1/copy_trade/wallets';
export const COPY_TRADE_CUSTOM_WALLETS = '/v1/copy_trade/custom_wallets';
export const COPY_TRADE_GEMS = '/v1/copy_trade/gems';
export const COPY_TRADE_DEXES_LIST = '/v1/copy_trade/dexes_list';

/** Token endpoints */
export const TOKEN_DETAILS = '/v1/token_details';
/** Token search lives under the trading_view router on v1.1.0. */
export const TOKEN_SEARCH = '/v1/trading_view/search';
export const TOKEN_TOP_TRADERS = '/v1/token/top_traders';

/** OHLCV endpoint */
export const OHLCV = '/v1/candles';

/** TradingView router (/v1/trading_view/*) — parameterised per provider. */
const TRADING_VIEW_BASE = '/v1/trading_view';
export const tradingViewConfigPath = (provider: string): string =>
  `${TRADING_VIEW_BASE}/${provider}/config`;
export const tradingViewSymbolsPath = (provider: string): string =>
  `${TRADING_VIEW_BASE}/${provider}/symbols`;
export const tradingViewHistoryPath = (provider: string): string =>
  `${TRADING_VIEW_BASE}/${provider}/history`;
export const tradingViewMarksPath = (provider: string): string =>
  `${TRADING_VIEW_BASE}/${provider}/marks`;

/** Bridge endpoints */
export const BRIDGE_ESTIMATE = '/v1/bridge/estimate_bridge';
export const BRIDGE_REQUEST = '/v1/bridge/request_bridge';
export const BRIDGE_ORDERS = '/v1/bridge/bridge_orders';

/** Top traders endpoints */
export const TOP_TRADERS = '/v1/copy_trade/top_traders';

/** Transfer endpoints (managed custody) */
export const TRANSFER_NATIVE = '/v1/transfer';
export const TRANSFER_TOKEN = '/v1/transfer_token';

/** Social / community endpoints */
export const ADD_COMMENT = '/v1/add_comment';
export const COMMENTS = '/v1/comments';
export const VOTE_SENTIMENT = '/v1/vote_sentiment';

/** Watchlist endpoints */
export const WATCH_LIST = '/v1/watch_list';
export const CHANGE_WATCH_LIST = '/v1/change_watch_list';

/** User-imported tokens */
export const IMPORT_TOKEN = '/v1/import_token';

/** Portfolio analytics */
export const WALLET_PERFORMANCE = '/v1/wallet_performance';
export const NOF1_ANALYTICS = '/v1/nof1_analytics';
export const NATIVE_PRICES = '/v1/native_prices';
export const GENERATE_PNL = '/v1/generate_pnl';

/** Referral endpoints */
export const REFERRAL_INFO = '/v1/referral';
export const REFERRAL_REQUEST_CLAIM = '/v1/request_claim';

/** Token discovery extensions */
export const TOKEN_BIGBUYS_BASE = '/v1/bigbuys';
export const tokenBigBuysPath = (chainId: number | string): string => `${TOKEN_BIGBUYS_BASE}/${chainId}`;
export const TOKEN_NEWEST = '/v1/newest';
export const TOKEN_CURRENTLY_LIVE = '/v1/currently_live';
export const TOKEN_LIVE_STATUS_BASE = '/v1/live_status';
export const tokenLiveStatusPath = (address: string): string => `${TOKEN_LIVE_STATUS_BASE}/${address}`;
export const TOKEN_TOP_TOKENS = '/v1/top_tokens';
export const TOKEN_TRADES = '/v1/token_trades';
export const TOKEN_XSTOCKS = '/v1/xstocks';
export const TOKEN_ZORA = '/v1/zora';

/** Token router (/v1/token/*) */
export const TOKEN_IMAGE = '/v1/token/token_image';

/** HyperLiquid trading abstraction */
export const HL_ENABLE_TRADING = '/v1/hl/enable_trading';
export const HL_SWAP_COLLATERAL = '/v1/hl/swap_collateral';

/** HyperLiquid HIP-3 outcomes / event markets */
export const HL_OUTCOMES = '/v1/hl/outcomes';
export const HL_OUTCOME_ACCOUNT = '/v1/hl/outcome_account';
export const HL_OUTCOME_CREATE_ORDER = '/v1/hl/outcome/create_order';
export const HL_OUTCOME_CANCEL_ORDER = '/v1/hl/outcome/cancel_order';
export const HL_OUTCOME_CLOSE_ORDER = '/v1/hl/outcome/close_order';

/** HyperLiquid extras */
export const HL_BUILDER_REFERRAL = '/v1/hl/builder_referral';
export const HL_TX_LIST = '/v1/hl/tx_list';
export const HL_LIST_USER_COPY_PNL = '/v1/hl/list_user_copy_pnl';
export const HL_POSITIONS = '/v1/hl/positions';
export const HL_ACCOUNT_STATE = '/v1/hl/account_state';

/** HyperLiquid referral router (/v1/hl_ref/*) — distinct from copy trading */
export const HL_REF_INFO = '/v1/hl_ref/info';
export const HL_REF_REQUEST_CLAIM = '/v1/hl_ref/request_claim';

/** Trending router (/v1/trending/*) — paid trending slot booking */
export const TRENDING_LIST = '/v1/trending/list';
export const TRENDING_OPTIONS = '/v1/trending/options';
export const TRENDING_REGISTER = '/v1/trending/register';
export const TRENDING_BOOKING_STATUS = '/v1/trending/booking_status';

/** Retailer router (/v1/retailer/*) — branded onboarding integrations */
export const RETAILER_LIST = '/v1/retailer';

/** Stats endpoint */
export const STATS = '/v1/stats';

/** Health check */
export const HEALTH = '/v1/status';
export const CHECK_SOLANA_RPC = '/v1/checkSolanaConnectionRpc';
