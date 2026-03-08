/**
 * All API endpoint constants for the Gbot backend.
 */

/** Auth endpoints */
export const AUTH_NONCE = '/v1/auth/nonce';
export const AUTH_LOGIN = '/v1/auth/login';
export const AUTH_SIGN_IN = '/v1/sign_in';
export const AUTH_REFRESH = '/v1/auth/refresh';
export const AUTH_LOGOUT = '/v1/auth/logout';

/** User endpoints */
export const USER_PROFILE = '/v1/user';
export const USER_UPDATE = '/v1/user/update';

/** Trading endpoints */
export const PURCHASE_V2 = '/v1/purchase_v2';
export const SELL_V2 = '/v1/sell_v2';
export const TRADE_STATUS = '/v1/trade/status'; // legacy compatibility
export const TRADE_STATUS_BASE = '/v1/trade-status';
export const tradeStatusPath = (requestId: string): string => `${TRADE_STATUS_BASE}/${requestId}`;

/** Portfolio endpoints */
export const PORTFOLIO = '/v1/portfolio';
export const BALANCES = '/v1/portfolio/balances'; // legacy compatibility
export const TRADE_HISTORY = '/v1/user_history';

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

/** Copy trade endpoints */
export const COPY_TRADE_SETTINGS = '/v1/copy_trade/settings';
export const COPY_TRADE_WALLETS = '/v1/copy_trade/wallets';
export const COPY_TRADE_WALLET_ADD = '/v1/copy_trade/wallets/add';
export const COPY_TRADE_WALLET_REMOVE = '/v1/copy_trade/wallets/remove';

/** Token endpoints */
export const TOKEN_DETAILS = '/v1/token_details';
export const TOKEN_SEARCH = '/v1/token/search';
export const TOKEN_TOP_TRADERS = '/v1/token/top_traders';

/** Trending endpoints */
export const TRENDING = '/v1/trending/list';
export const TRENDING_CHAIN = '/v1/trending/:chain';

/** OHLCV / TradingView endpoints */
export const OHLCV = '/v1/candles';
export const TRADING_VIEW_CONFIG = '/v1/trading_view/config';
export const TRADING_VIEW_SYMBOLS = '/v1/trading_view/symbols';
export const TRADING_VIEW_HISTORY = '/v1/trading_view/history';

/** Bridge endpoints */
export const BRIDGE_ESTIMATE = '/v1/bridge/estimate_bridge';
export const BRIDGE_REQUEST = '/v1/bridge/request_bridge';
export const BRIDGE_ORDERS = '/v1/bridge/bridge_orders';

/** Top traders endpoints */
export const TOP_TRADERS = '/v1/copy_trade/top_traders';

/** Wallet endpoints */
export const WALLET_INFO = '/v1/wallet/info'; // not always enabled in all deployments

/** Health check */
export const HEALTH = '/v1/status';
export const CHECK_SOLANA_RPC = '/v1/checkSolanaConnectionRpc';
