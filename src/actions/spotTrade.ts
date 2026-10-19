/**
 * Spot trading actions — managed-custody buy and sell on supported chains.
 *
 * Backend contract (gbotTradingDashboardBackend):
 *
 * - `POST /v1/purchase_v2` and `POST /v1/sell_v2` (src/api/main.ts:43,45;
 *   ServiceMain.purchaseV2 / sellV2, ServiceMain.ts:2335-2404, 2569-2635).
 *   Body `{ computedData, chainId, tip?, slippage? }` (TRADE_V2_BUY_SCHEMA /
 *   TRADE_V2_SCHEMA, requestSchema.ts:330-343). `computedData` is required, so
 *   there is no plain-parameter trade: every spot trade is session-signed.
 * - The signed data is `decodeInputData('purchase' | 'sell')`
 *   (src/shared/parser/evm/decoder.ts:35-47): ABI `['string','uint256','string']`
 *   = `[tokenAddress, amount, nonce]`, signed as `${action}-${userId}-${data}`.
 *   A buy's amount is native base units (tradeWorker.ts:693-695 converts with
 *   the chain's native decimals); a sell's is token base units
 *   (tradeWorker.ts:895-896, 1015-1031).
 * - `slippage` is basis points, clamped to 5000 (50%), and only reaches the
 *   Solana and Sui executors; EVM swaps use the account's stored slippage
 *   (tradeWorker.ts:697-705, 803-823, 934-940, 1015-1017; tradeBounds.ts:22-56).
 * - `tip` is a Solana priority fee in SOL, capped at 0.05 (tradeBounds.ts:27-73,
 *   tradeWorker.ts:834, 1028).
 * - The response is `{ requestId, status: 'pending', createdAt }`; the result is
 *   read from `GET /v1/trade-status/:requestId` (ServiceMain.ts:2694-2720),
 *   whose `status` is pending | processing | success | error
 *   (shared/contracts/redis.types.ts:77, sanitizeTradeState.ts:18-37).
 *
 * gdex.pro submits trades the same way (gbotTradingDashboardUI staging,
 * src/utils/api.ts:3841-3933 `buyV2` / `sellV2`; percentage sells sized from a
 * fresh holdings read, src/app/[network]/token/TokenDetail.tsx:1380-1410).
 *
 * Options purchase_v2 / sell_v2 cannot honour (dex, referrer, a non-native
 * input/output token, EVM slippage) are rejected before anything is signed.
 */
import { parseUnits } from 'ethers';
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import {
  BuyTokenParams,
  SellTokenParams,
  ManagedSpotTradeResult,
  ManagedTradeWaitResult,
  WaitForTradeParams,
} from '../types/trading';
import { validateTokenAddress, validateAmount, validateSlippage, parseAmountUnits, validateRequired } from '../utils/validation';
import { CHAIN_CONFIGS, NormalizedChain } from '../config/chains';
import { buildGdexManagedTradeComputedData, generateGdexNonce } from '../utils/gdexManagedCrypto';
import { GdexApiError, GdexSubmissionUnknownError, GdexValidationError } from '../utils/errors';
import { GdexErrorCode } from '../types/common';
import { getPortfolio, managedChain, MANAGED_READ_CHAIN_IDS } from './portfolio';

/**
 * Chains `purchase_v2` accepts: backend `supportedChainIds` + Solana minus
 * `tradingDisabledChainIds` (config/default.json:30-42,65-66; requestSchema.ts:164-186).
 */
export const MANAGED_BUY_CHAIN_IDS: ReadonlySet<number> = new Set([
  1, 10, 56, 146, 252, 4663, 8453, 42161, 622112261,
]);

/** Chains `sell_v2` accepts: every configured chain, retired ones included (requestSchema.ts:322-336). */
export const MANAGED_SELL_CHAIN_IDS: ReadonlySet<number> = MANAGED_READ_CHAIN_IDS;

/** Backend slippage ceiling, 5000 bps (tradeBounds.ts:25). */
const MAX_SLIPPAGE_PERCENT = 50;
/** Backend tip ceiling, 0.05 SOL (tradeBounds.ts:29), in lamports. */
const MAX_TIP_LAMPORTS = 50_000_000;
const LAMPORTS_PER_SOL = 1_000_000_000;
/** Percentage sells are resolved with this many decimals of a percent. */
const PERCENT_DECIMALS = 6;
const HUNDRED_PERCENT = 100n * 10n ** BigInt(PERCENT_DECIMALS);

interface ManagedCreds {
  walletAddress: string;
  sessionPrivateKey: string;
  apiKey: string;
}

function requireManagedCreds(params: { walletAddress?: string; sessionPrivateKey?: string; apiKey?: string }): ManagedCreds {
  const missing = (['walletAddress', 'sessionPrivateKey', 'apiKey'] as const).filter((f) => !params[f]);
  if (missing.length > 0) {
    throw new GdexValidationError(
      `Spot trades are managed-custody only (purchase_v2/sell_v2 require a session-signed computedData). Missing: ${missing.join(', ')}. Pass them or an accountRef.`,
      missing[0]
    );
  }
  return params as ManagedCreds;
}

function isNativeToken(address: string, chain: NormalizedChain): boolean {
  const native = CHAIN_CONFIGS[String(chain.id)]?.nativeTokenAddress;
  if (address.toLowerCase() === 'native') return true;
  if (!native) return false;
  return chain.family === 'evm' ? address.toLowerCase() === native.toLowerCase() : address === native;
}

/** Map slippage/priorityFee onto the backend's unsigned `slippage`/`tip`, rejecting what it would ignore or clamp. */
function managedOptions(
  params: BuyTokenParams | SellTokenParams,
  chain: NormalizedChain,
  side: 'buy' | 'sell'
): { slippageBps?: number; tipSol?: number } {
  const endpoint = side === 'buy' ? 'purchase_v2' : 'sell_v2';
  if (params.dex !== undefined) {
    throw new GdexValidationError(`dex is not supported by ${endpoint}: the backend picks the route`, 'dex');
  }
  if (params.referrer !== undefined) {
    throw new GdexValidationError(`referrer is not supported by ${endpoint}`, 'referrer');
  }
  if (side === 'buy') {
    const input = (params as BuyTokenParams).inputToken;
    if (input !== undefined && !isNativeToken(input, chain)) {
      throw new GdexValidationError('purchase_v2 always spends the native token; use buyWithUsdc to pay with USDC', 'inputToken');
    }
  } else {
    const output = (params as SellTokenParams).outputToken;
    if (output !== undefined && !isNativeToken(output, chain)) {
      throw new GdexValidationError('sell_v2 always receives the native token; use sellToUsdc to receive USDC', 'outputToken');
    }
  }

  const out: { slippageBps?: number; tipSol?: number } = {};
  if (params.slippage !== undefined) {
    if (chain.family === 'evm') {
      throw new GdexValidationError(
        'slippage is not applied to EVM managed trades: the backend uses the account\'s stored slippage. Omit it, or change the stored setting on gdex.pro.',
        'slippage'
      );
    }
    validateSlippage(params.slippage);
    const bps = Math.round(params.slippage * 100);
    if (bps <= 0 || params.slippage > MAX_SLIPPAGE_PERCENT || Math.abs(bps - params.slippage * 100) > 1e-9) {
      throw new GdexValidationError(
        `slippage must be above 0 and at most ${MAX_SLIPPAGE_PERCENT}% in whole basis points (the backend clamps higher values), got ${params.slippage}`,
        'slippage'
      );
    }
    out.slippageBps = bps;
  }
  if (params.priorityFee !== undefined) {
    if (chain.family !== 'solana') {
      throw new GdexValidationError('priorityFee is Solana only', 'priorityFee');
    }
    const fee = params.priorityFee;
    if (!Number.isSafeInteger(fee) || fee <= 0 || fee > MAX_TIP_LAMPORTS) {
      throw new GdexValidationError(
        `priorityFee must be a positive integer number of lamports, at most ${MAX_TIP_LAMPORTS} (0.05 SOL, the backend cap), got ${fee}`,
        'priorityFee'
      );
    }
    out.tipSol = fee / LAMPORTS_PER_SOL;
  }
  return out;
}

async function submitManagedTrade(
  client: GdexApiClient,
  side: 'buy' | 'sell',
  creds: ManagedCreds,
  chain: NormalizedChain,
  tokenAddress: string,
  amountRaw: bigint,
  amountDecimals: number,
  opts: { slippageBps?: number; tipSol?: number },
  heldRaw?: bigint
): Promise<ManagedSpotTradeResult> {
  if (amountRaw <= 0n) throw new GdexValidationError('amount resolves to zero raw units', 'amount');
  const { computedData } = buildGdexManagedTradeComputedData({
    apiKey: creds.apiKey,
    action: side === 'buy' ? 'purchase' : 'sell',
    userId: creds.walletAddress,
    tokenAddress,
    amount: amountRaw,
    nonce: String(generateGdexNonce()),
    sessionPrivateKey: creds.sessionPrivateKey,
  });
  const body: Record<string, unknown> = { computedData, chainId: chain.id };
  if (opts.slippageBps !== undefined) body.slippage = opts.slippageBps;
  if (opts.tipSol !== undefined) body.tip = opts.tipSol;

  const endpoint = side === 'buy' ? Endpoints.PURCHASE_V2 : Endpoints.SELL_V2;
  const res = await client.post<Record<string, unknown>>(endpoint, body);
  if (!res || typeof res.requestId !== 'string' || !res.requestId) {
    throw new GdexSubmissionUnknownError(
      `${endpoint} answered without a requestId; the trade may have been queued. Check trade history before trading again.`,
      'POST',
      endpoint
    );
  }
  const result: ManagedSpotTradeResult = {
    requestId: res.requestId,
    status: typeof res.status === 'string' ? res.status : 'pending',
    side,
    chainId: chain.id,
    tokenAddress,
    amountRaw: amountRaw.toString(),
    amountDecimals,
  };
  if (typeof res.createdAt === 'number') result.createdAt = res.createdAt;
  if (heldRaw !== undefined) result.heldRaw = heldRaw.toString();
  if (opts.slippageBps !== undefined) result.slippageBps = opts.slippageBps;
  if (opts.tipSol !== undefined) result.tipSol = opts.tipSol;
  return result;
}

/**
 * Buy a token with the chain's native token through the managed account.
 *
 * Signs `purchase` `[tokenAddress, amountRaw, nonce]` with the session key and
 * posts it to `/v1/purchase_v2`. `amount` is a decimal native amount converted
 * exactly to native decimals. The trade runs asynchronously: follow the
 * returned `requestId` with {@link waitForTrade}.
 *
 * @throws {GdexValidationError} for missing credentials, an unsupported chain or an option the backend cannot honour (nothing is signed)
 */
export async function buyToken(client: GdexApiClient, params: BuyTokenParams): Promise<ManagedSpotTradeResult> {
  const chain = managedChain(params.chain, MANAGED_BUY_CHAIN_IDS, 'managed buys (purchase_v2)');
  validateTokenAddress(params.tokenAddress, params.chain, 'tokenAddress');
  validateAmount(params.amount, 'amount');
  const opts = managedOptions(params, chain, 'buy');
  const creds = requireManagedCreds(params);
  const amountRaw = parseAmountUnits(params.amount, chain.nativeDecimals, 'amount');
  return submitManagedTrade(client, 'buy', creds, chain, params.tokenAddress, amountRaw, chain.nativeDecimals, opts);
}

/** Parse "50%" into the percent scaled by 10^PERCENT_DECIMALS (undefined if not a percentage). */
function parsePercent(amount: string): bigint | undefined {
  const m = /^(\d+(?:\.\d+)?)%$/.exec(amount.trim());
  if (!m) return undefined;
  const frac = m[1].split('.')[1] ?? '';
  if (frac.replace(/0+$/, '').length > PERCENT_DECIMALS) {
    throw new GdexValidationError(`percentage has more than ${PERCENT_DECIMALS} decimal places: ${amount}`, 'amount');
  }
  const scaled = parseUnits(m[1], PERCENT_DECIMALS);
  if (scaled <= 0n || scaled > HUNDRED_PERCENT) {
    throw new GdexValidationError(`percentage must be above 0% and at most 100%, got ${amount}`, 'amount');
  }
  return scaled;
}

/**
 * Sell a token for the chain's native token through the managed account.
 *
 * `amount` is either a decimal token amount, converted exactly to the token's
 * decimals, or a percentage of the held balance ("50%", "100%"). Both read the
 * managed holding first (`/v1/portfolio`) for decimals and balance; a
 * percentage is `floor(held * pct / 100)` in integer math, and 100% sells the
 * exact raw balance. Signs `sell` `[tokenAddress, amountRaw, nonce]` and posts
 * it to `/v1/sell_v2`.
 *
 * @throws {GdexValidationError} for missing credentials, an unsupported chain, an unheld token, an amount above the balance, or an option the backend cannot honour (nothing is signed)
 */
export async function sellToken(client: GdexApiClient, params: SellTokenParams): Promise<ManagedSpotTradeResult> {
  const chain = managedChain(params.chain, MANAGED_SELL_CHAIN_IDS, 'managed sells (sell_v2)');
  validateTokenAddress(params.tokenAddress, params.chain, 'tokenAddress');
  validateAmount(params.amount, 'amount', true);
  const opts = managedOptions(params, chain, 'sell');
  const creds = requireManagedCreds(params);
  const pct = parsePercent(params.amount);
  if (params.tokenDecimals !== undefined && (!Number.isInteger(params.tokenDecimals) || params.tokenDecimals < 0 || params.tokenDecimals > 255)) {
    throw new GdexValidationError('tokenDecimals must be an integer from 0 to 255', 'tokenDecimals');
  }

  const portfolio = await getPortfolio(client, { ...creds, chain: chain.id });
  const same = (a: string) => (chain.family === 'evm' ? a.toLowerCase() === params.tokenAddress.toLowerCase() : a === params.tokenAddress);
  const holding = portfolio.holdings.find((h) => same(h.tokenAddress));
  const held = holding ? BigInt(holding.rawBalance) : undefined;

  if (pct !== undefined) {
    if (!holding || held === undefined || held === 0n) {
      throw new GdexValidationError(`No ${params.tokenAddress} balance in the managed wallet on chain ${chain.id} to sell a percentage of`, 'amount');
    }
    const amountRaw = pct === HUNDRED_PERCENT ? held : (held * pct) / HUNDRED_PERCENT;
    if (amountRaw === 0n) throw new GdexValidationError(`${params.amount} of the balance rounds to zero raw units`, 'amount');
    // Sign the token address as the holding spells it, as gdex.pro does.
    return submitManagedTrade(client, 'sell', creds, chain, holding.tokenAddress, amountRaw, holding.decimals, opts, held);
  }

  if (holding && params.tokenDecimals !== undefined && params.tokenDecimals !== holding.decimals) {
    throw new GdexValidationError(`tokenDecimals ${params.tokenDecimals} does not match the token's ${holding.decimals}`, 'tokenDecimals');
  }
  const decimals = holding?.decimals ?? params.tokenDecimals;
  if (decimals === undefined) {
    throw new GdexValidationError(
      `${params.tokenAddress} is not in the managed portfolio on chain ${chain.id}; pass tokenDecimals to sell an absolute amount of it`,
      'tokenDecimals'
    );
  }
  const amountRaw = parseAmountUnits(params.amount, decimals, 'amount');
  if (held !== undefined && amountRaw > held) {
    throw new GdexValidationError(`amount ${params.amount} exceeds the held balance ${holding?.balance}`, 'amount');
  }
  return submitManagedTrade(client, 'sell', creds, chain, holding?.tokenAddress ?? params.tokenAddress, amountRaw, decimals, opts, held);
}

const TERMINAL = new Set(['success', 'error']);

/**
 * Poll `GET /v1/trade-status/:requestId` until the trade is terminal
 * (`success` / `error`) or `timeoutMs` passes. A timeout returns
 * `outcome: 'pending'`: the trade may still settle, so never resubmit it.
 */
export async function waitForTrade(client: GdexApiClient, params: WaitForTradeParams): Promise<ManagedTradeWaitResult> {
  validateRequired(params.requestId, 'requestId');
  const intervalMs = params.intervalMs ?? 2000;
  const deadline = Date.now() + (params.timeoutMs ?? 120000);
  const path = Endpoints.tradeStatusPath(params.requestId);
  let last: Record<string, unknown> | undefined;
  let lastStatus = '';
  let lastError: string | undefined;
  for (;;) {
    try {
      const state = await client.get<Record<string, unknown>>(path);
      lastError = undefined;
      if (state && typeof state === 'object') {
        last = state;
        const status = String(state.status ?? '').toLowerCase();
        if (status !== lastStatus) {
          lastStatus = status;
          params.onUpdate?.(state);
        }
        if (TERMINAL.has(status)) {
          const filled = status === 'success' && state.isSuccess !== false;
          return describe(params.requestId, filled ? 'filled' : 'failed', state);
        }
      }
    } catch (err) {
      if (err instanceof GdexApiError && err.code === GdexErrorCode.NOT_FOUND) {
        return { outcome: 'not_found', requestId: params.requestId, error: 'Trade request not found or expired' };
      }
      if (err instanceof GdexValidationError) throw err;
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (Date.now() + intervalMs > deadline) {
      const out = describe(params.requestId, 'pending', last);
      if (lastError) out.lastError = lastError;
      return out;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function describe(requestId: string, outcome: ManagedTradeWaitResult['outcome'], state?: Record<string, unknown>): ManagedTradeWaitResult {
  const out: ManagedTradeWaitResult = { outcome, requestId };
  if (!state) return out;
  out.trade = state;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : undefined);
  const status = str(state.status);
  if (status) out.status = status;
  const hash = str(state.hash);
  if (hash) out.hash = hash;
  const tokenAmount = str(state.tokenAmount);
  if (tokenAmount) out.tokenAmount = tokenAmount;
  const ethAmount = str(state.ethAmount);
  if (ethAmount) out.ethAmount = ethAmount;
  const error = str(state.error);
  if (error) out.error = error;
  const errorCode = str(state.errorCode);
  if (errorCode) out.errorCode = errorCode;
  return out;
}
