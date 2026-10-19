/**
 * Portfolio actions — managed-account holdings, balances, trading funds and
 * trade history.
 *
 * Backend contract (gbotTradingDashboardBackend, src/api/main.ts:23,53-54):
 *
 * - `GET /v1/portfolio?userId&data&chainId` (ServiceMain.portfolio,
 *   ServiceMain.ts:2723-2775). `userId` is the control wallet; `data` is the
 *   encrypted compressed session public key and must match the stored session
 *   (400 code 101/102/104, 404 code 103 otherwise). Responds `{ holding: [] }`,
 *   each row `{ amount, uiAmount, tokenInfo, holding?, invested?,
 *   pnlPercentage?, startTimestamp? }` (evmHelper.ts:967-1003, 1116-1158;
 *   solanaBalances.ts:280-310; suiBalances.ts:165-180). `amount` is raw base
 *   units: a string on EVM and Sui, a JS number on Solana.
 * - `GET /v1/user?userId&data&chainId` (ServiceMain.user, ServiceMain.ts:1151-1226):
 *   same auth; returns `{ address, walletsByChain, balance, chainId, ... }`
 *   with `balance` the managed wallet's native balance as a float in whole
 *   units (evmExternalApi.ts:35-59, solanaBalances.ts:40-75; 0 on RPC failure).
 * - `GET /v1/user_history?chainId&user&limit&cursor` (ServiceMain.userHistory,
 *   ServiceMain.ts:3127-3152; apiUtils.ts:11-65). `user` is the control wallet
 *   (Track.userId); no session. Returns `{ tracks, tokenMap, nextCursor }`,
 *   `limit` capped at 50, cursor = timestamp of the last track.
 *
 * gdex.pro reads holdings the same way (gbotTradingDashboardUI staging,
 * src/utils/api.ts:1225-1247 `getHoldings`, :1116-1145 `getUserInfo`,
 * :786-806 `getUserTradeHistory`).
 *
 * There is no public (address-only) holdings read: every holdings route needs a
 * managed session. A response without the documented envelope throws instead
 * of reading as an empty, zero-balance account.
 */
import { formatUnits, parseUnits } from 'ethers';
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import {
  Portfolio,
  Balance,
  TradeRecord,
  PortfolioParams,
  BalanceParams,
  TradeHistoryParams,
  TradeHistoryPage,
  TradingFunds,
  ManagedReadCredentials,
} from '../types/portfolio';
import { SupportedChain } from '../types/common';
import { validateRequired } from '../utils/validation';
import { GdexApiError, GdexValidationError } from '../utils/errors';
import { CHAIN_CONFIGS, normalizeChain, NormalizedChain } from '../config/chains';
import { buildGdexReadSessionData } from '../utils/gdexManagedCrypto';

/**
 * Chains the backend serves managed reads for: `supportedChainIds` plus the
 * Solana and Sui ids (backend config/default.json:30-66; requestSchema.ts:98-120).
 */
export const MANAGED_READ_CHAIN_IDS: ReadonlySet<number> = new Set([
  1, 10, 56, 146, 252, 4663, 6900, 8453, 42161, 80094, 622112261, 1313131213,
]);

/** Resolve and check a chain for a managed read or trade. */
export function managedChain(chain: SupportedChain | string | number, allowed: ReadonlySet<number> = MANAGED_READ_CHAIN_IDS, what = 'managed reads'): NormalizedChain {
  const c = normalizeChain(chain);
  if (!allowed.has(c.id)) {
    throw new GdexValidationError(`Chain ${c.id} is not supported by GDEX for ${what}`, 'chain');
  }
  return c;
}

/** `userId` + encrypted session `data` for an authenticated read. */
export function managedReadAuth(creds: ManagedReadCredentials): { userId: string; data: string } {
  const userId = creds.userId ?? creds.walletAddress;
  validateRequired(userId, 'walletAddress');
  if (creds.data) return { userId, data: creds.data };
  if (creds.sessionPrivateKey && creds.apiKey) {
    return { userId, data: buildGdexReadSessionData(creds.sessionPrivateKey, creds.apiKey) };
  }
  throw new GdexValidationError(
    'Managed reads need the session: pass data, or sessionPrivateKey and apiKey (or accountRef). ' +
      'GDEX has no public address-only holdings read.',
    'sessionPrivateKey'
  );
}

function malformed(endpoint: string, detail: string, body?: unknown): never {
  throw new GdexApiError(
    `Malformed ${endpoint} response: ${detail}. Treat the balance as unknown, not zero.`,
    200,
    body && typeof body === 'object' ? (body as Record<string, unknown>) : undefined
  );
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const optStr = (v: unknown): string | undefined =>
  typeof v === 'string' && v !== '' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined;

/** Exact decimal string of a raw amount, without a trailing ".0". */
function formatRaw(raw: bigint, decimals: number): string {
  return formatUnits(raw, decimals).replace(/\.0$/, '');
}

/**
 * Raw balance of a holding row. EVM/Sui send an integer string; Solana sends a
 * JS number (uiAmount x 10^decimals), exact only while it is a safe integer, so
 * past that the exact `uiAmount` decimal string is used instead.
 */
function rawOfRow(amount: unknown, uiAmount: unknown, decimals: number): bigint | undefined {
  if (typeof amount === 'string' && /^[0-9]+$/.test(amount)) return BigInt(amount);
  if (typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0) return BigInt(amount);
  if (typeof uiAmount === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(uiAmount)) {
    const frac = uiAmount.split('.')[1] ?? '';
    if (frac.replace(/0+$/, '').length > decimals) return undefined;
    return parseUnits(frac.length > decimals ? uiAmount.slice(0, uiAmount.length - (frac.length - decimals)).replace(/\.$/, '') : uiAmount, decimals);
  }
  return undefined;
}

/** Normalize one `/v1/portfolio` `holding[]` row; throws on a malformed row. */
export function normalizeHolding(row: unknown, chain: NormalizedChain): Balance {
  if (!isObj(row) || !isObj(row.tokenInfo)) malformed(Endpoints.PORTFOLIO, 'holding row without tokenInfo', row);
  const t = row.tokenInfo;
  const decimals = Number(t.decimals);
  if (typeof t.address !== 'string' || !t.address || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    malformed(Endpoints.PORTFOLIO, 'holding tokenInfo without address/decimals', row);
  }
  const raw = rawOfRow(row.amount, row.uiAmount, decimals);
  if (raw === undefined) malformed(Endpoints.PORTFOLIO, `holding ${t.address} has no exact amount`, row);
  const balance = formatRaw(raw, decimals);
  const priceUsd = optStr(t.priceUsd);
  const out: Balance = {
    tokenAddress: t.address,
    symbol: optStr(t.symbol) ?? '',
    name: optStr(t.name) ?? '',
    decimals,
    rawBalance: raw.toString(),
    balance,
    chain: chain.id,
    chainId: chain.id,
  };
  const logo = optStr(t.image) ?? optStr(t.imageUrl) ?? optStr(t.logo);
  if (logo) out.logoUrl = logo;
  if (priceUsd) {
    out.priceUsd = priceUsd;
    const usd = Number(balance) * Number(priceUsd);
    if (Number.isFinite(usd)) out.usdValue = String(usd);
  }
  const priceNative = optStr(t.priceNative);
  if (priceNative) out.priceNative = priceNative;
  const valueNative = optStr(row.holding);
  if (valueNative) out.valueNative = valueNative;
  const investedNative = optStr(row.invested);
  if (investedNative) out.investedNative = investedNative;
  if (typeof row.pnlPercentage === 'number' && Number.isFinite(row.pnlPercentage)) out.pnlPercentage = row.pnlPercentage;
  return out;
}

function sumIfAll(values: (string | undefined)[]): string | undefined {
  if (values.some((v) => v === undefined)) return undefined;
  return String(values.reduce((a, v) => a + Number(v), 0));
}

/**
 * Holdings of a managed account on one chain (`GET /v1/portfolio`).
 *
 * @param client - API client
 * @param params - Control wallet, session (`data`, or `sessionPrivateKey` + `apiKey`) and chain
 * @throws {GdexValidationError} without a session or on an unsupported chain
 * @throws {GdexApiError} when the backend refuses or returns a malformed envelope
 */
export async function getPortfolio(client: GdexApiClient, params: PortfolioParams): Promise<Portfolio> {
  if (params.chain === undefined) throw new GdexValidationError('chain is required: /v1/portfolio is per chain', 'chain');
  const chain = managedChain(params.chain);
  const auth = managedReadAuth(params);
  const res = await client.get<unknown>(Endpoints.PORTFOLIO, { ...auth, chainId: chain.id });
  if (!isObj(res) || !Array.isArray(res.holding)) {
    malformed(Endpoints.PORTFOLIO, 'expected { holding: [] }', res);
  }
  const holdings = res.holding.map((row) => normalizeHolding(row, chain));
  const portfolio: Portfolio = {
    status: 'ok',
    mode: 'managed',
    userId: auth.userId,
    chainId: chain.id,
    holdings,
    balances: holdings,
  };
  const totalNative = sumIfAll(holdings.map((h) => h.valueNative));
  if (totalNative !== undefined) portfolio.totalValueNative = totalNative;
  const totalUsd = sumIfAll(holdings.map((h) => h.usdValue));
  if (totalUsd !== undefined) portfolio.totalValueUsd = totalUsd;
  return portfolio;
}

/** Alias of {@link getPortfolio}: the managed wallet's token holdings on one chain. */
export const getManagedHoldings = getPortfolio;

/**
 * Token balances of a managed account on one chain, optionally one token.
 * An empty array means the backend answered with no holdings; a failed or
 * malformed read throws.
 */
export async function getBalances(client: GdexApiClient, params: BalanceParams): Promise<Balance[]> {
  const portfolio = await getPortfolio(client, params);
  if (!params.tokenAddress) return portfolio.holdings;
  const evm = normalizeChain(params.chain).family === 'evm';
  const want = evm ? params.tokenAddress.toLowerCase() : params.tokenAddress;
  return portfolio.holdings.filter((h) => (evm ? h.tokenAddress.toLowerCase() : h.tokenAddress) === want);
}

/**
 * Native funds the managed wallet can trade with on one chain (`GET /v1/user`).
 * For the cross-chain USDC balance use `getUsdcBalances`.
 */
export async function getTradingFunds(
  client: GdexApiClient,
  params: ManagedReadCredentials & { chain: SupportedChain }
): Promise<TradingFunds> {
  if (params.chain === undefined) throw new GdexValidationError('chain is required', 'chain');
  const chain = managedChain(params.chain);
  const auth = managedReadAuth(params);
  const res = await client.get<unknown>(Endpoints.USER_PROFILE, { ...auth, chainId: chain.id });
  if (!isObj(res) || typeof res.address !== 'string' || !res.address) {
    malformed(Endpoints.USER_PROFILE, 'expected { address, balance }', res);
  }
  const bal = typeof res.balance === 'number' ? res.balance : typeof res.balance === 'string' ? Number(res.balance) : NaN;
  if (!Number.isFinite(bal) || bal < 0) malformed(Endpoints.USER_PROFILE, 'missing numeric balance', res);
  const funds: TradingFunds = {
    status: 'ok',
    mode: 'managed',
    userId: auth.userId,
    chainId: chain.id,
    address: res.address,
    nativeBalance: String(bal),
    nativeSymbol: CHAIN_CONFIGS[String(chain.id)]?.nativeToken ?? '',
    precision: 'approximate',
  };
  if (isObj(res.walletsByChain)) {
    const w = res.walletsByChain;
    const s = (v: unknown) => (typeof v === 'string' ? v : null);
    funds.walletsByChain = { evm: s(w.evm), solana: s(w.solana), sui: s(w.sui) };
  }
  return funds;
}

/**
 * One page of a managed account's successful trades on a chain
 * (`GET /v1/user_history`). Keyed by the control wallet; no session needed.
 * Note: the backend answers `{ tracks: [] }` on its own DB errors too
 * (apiUtils.ts:62-64), so an empty page is not proof of no trades.
 */
export async function getTradeHistory(client: GdexApiClient, params: TradeHistoryParams): Promise<TradeHistoryPage> {
  const userId = params.userId ?? params.walletAddress;
  validateRequired(userId, 'walletAddress');
  if (params.chain === undefined) throw new GdexValidationError('chain is required by /v1/user_history', 'chain');
  for (const f of ['page', 'startTime', 'endTime'] as const) {
    if (params[f] !== undefined) {
      throw new GdexValidationError(`${f} is not supported by /v1/user_history; page with limit and cursor (nextCursor)`, f);
    }
  }
  const chain = managedChain(params.chain);
  const query: Record<string, unknown> = { chainId: chain.id, user: userId };
  if (params.limit !== undefined) {
    if (!Number.isInteger(params.limit) || params.limit < 1 || params.limit > 50) {
      throw new GdexValidationError('limit must be an integer from 1 to 50', 'limit');
    }
    query.limit = params.limit;
  }
  if (params.cursor !== undefined) query.cursor = params.cursor;

  const res = await client.get<unknown>(Endpoints.USER_HISTORY, query);
  if (!isObj(res) || !Array.isArray(res.tracks)) malformed(Endpoints.USER_HISTORY, 'expected { tracks: [] }', res);
  const tokenMap = isObj(res.tokenMap) ? res.tokenMap : {};
  const native = CHAIN_CONFIGS[String(chain.id)]?.nativeTokenAddress ?? 'native';
  const trades = res.tracks.map((t): TradeRecord => {
    if (!isObj(t) || typeof t.token !== 'string' || typeof t.isBuy !== 'boolean') {
      malformed(Endpoints.USER_HISTORY, 'track without token/isBuy', t);
    }
    const tokenAmount = optStr(t.tokenAmount) ?? '0';
    const nativeAmount = optStr(t.nativeAmount) ?? '0';
    const info = isObj(tokenMap[t.token]) ? (tokenMap[t.token] as Record<string, unknown>) : undefined;
    const txHash = optStr(t.txHash) ?? '';
    const rec: TradeRecord = {
      id: txHash,
      type: t.isBuy ? 'buy' : 'sell',
      inputToken: t.isBuy ? native : t.token,
      outputToken: t.isBuy ? t.token : native,
      amountIn: t.isBuy ? nativeAmount : tokenAmount,
      amountOut: t.isBuy ? tokenAmount : nativeAmount,
      chain: chain.id,
      txHash,
      timestamp: Number(t.timestamp) || 0,
      status: 'completed',
      tokenAddress: t.token,
      tokenAmount,
      nativeAmount,
    };
    if (typeof t.walletAddress === 'string') rec.walletAddress = t.walletAddress;
    const decimals = typeof t.tokenDecimals === 'number' ? t.tokenDecimals : typeof info?.decimals === 'number' ? info.decimals : undefined;
    if (decimals !== undefined) rec.tokenDecimals = decimals;
    if (typeof info?.symbol === 'string') rec.tokenSymbol = info.symbol;
    if (typeof t.nativePrice === 'number') rec.nativePrice = t.nativePrice;
    if (typeof t.isConfirmed === 'boolean') rec.isConfirmed = t.isConfirmed;
    return rec;
  });
  const next = Number(res.nextCursor);
  return { status: 'ok', userId, chainId: chain.id, trades, nextCursor: res.nextCursor != null && Number.isFinite(next) ? next : null };
}
