/**
 * Spot trading actions — buy and sell tokens on supported chains.
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import { BuyTokenParams, SellTokenParams, TradeResult } from '../types/trading';
import { validateTokenAddress, validateAmount, validateChain, validateSlippage, parseAmountUnits } from '../utils/validation';
import { normalizeChain, NormalizedChain } from '../config/chains';
import { buildChainAliases, buildTokenAliases, buildWalletAliases } from '../utils/apiAliases';
import { toBackendSlippage } from '../utils/slippage';
import { buildGdexManagedTradeComputedData, generateGdexNonce } from '../utils/gdexManagedCrypto';

/**
 * Submit a managed-custody EVM buy via the session-signed `purchase_v2` flow.
 *
 * Managed-custody trades cannot use the plain-param path — the backend rejects
 * them as "missing params". The spend is the chain's native token; `amount` is a
 * decimal native amount converted exactly to the chain's native decimals here.
 */
async function submitManagedBuy(
  client: GdexApiClient,
  params: BuyTokenParams,
  chain: NormalizedChain
): Promise<TradeResult> {
  const amountWei = parseAmountUnits(params.amount, chain.nativeDecimals, 'amount').toString();
  const { computedData } = buildGdexManagedTradeComputedData({
    apiKey: params.apiKey as string,
    action: 'purchase',
    userId: params.walletAddress as string,
    tokenAddress: params.tokenAddress,
    amount: amountWei,
    nonce: String(generateGdexNonce()),
    sessionPrivateKey: params.sessionPrivateKey as string,
  });
  const body: Record<string, unknown> = { computedData, chainId: chain.id };
  if (params.slippage !== undefined) body.slippage = toBackendSlippage(params.slippage);
  return client.post<TradeResult>(Endpoints.PURCHASE_V2, body);
}

/**
 * Buy a token on a supported chain.
 *
 * Submits a buy order to the backend trade queue (async by default).
 *
 * @param client - Authenticated API client
 * @param params - Buy parameters
 * @returns Trade result including job ID and transaction details
 */
export async function buyToken(client: GdexApiClient, params: BuyTokenParams): Promise<TradeResult> {
  // Validate inputs
  validateChain(params.chain);
  validateTokenAddress(params.tokenAddress, params.chain, 'tokenAddress');
  validateAmount(params.amount, 'amount');
  if (params.slippage !== undefined) validateSlippage(params.slippage);

  // Managed-custody EVM swap path (session-signed). Additive: callers that don't
  // pass a session key keep the original plain-param behaviour. Decided by chain
  // family, so numeric Solana/Sui IDs never take the EVM path.
  const chain = normalizeChain(params.chain);
  if (chain.family === 'evm' && params.sessionPrivateKey && params.walletAddress && params.apiKey) {
    return submitManagedBuy(client, params, chain);
  }

  const payload = {
    ...buildChainAliases(params.chain),
    ...buildTokenAliases(params.tokenAddress),
    amount: params.amount,
    slippage: toBackendSlippage(params.slippage ?? 1),
    dex: params.dex,
    ...buildWalletAliases(params.walletAddress),
    referrer: params.referrer,
    priorityFee: params.priorityFee,
    inputToken: params.inputToken,
  };

  const response = await client.post<TradeResult>(Endpoints.PURCHASE_V2, payload);
  return response;
}

/**
 * Sell a token on a supported chain.
 *
 * @param client - Authenticated API client
 * @param params - Sell parameters
 * @returns Trade result including job ID and transaction details
 */
export async function sellToken(client: GdexApiClient, params: SellTokenParams): Promise<TradeResult> {
  // Validate inputs
  validateChain(params.chain);
  validateTokenAddress(params.tokenAddress, params.chain, 'tokenAddress');
  validateAmount(params.amount, 'amount', true); // allow percentage strings
  if (params.slippage !== undefined) validateSlippage(params.slippage);

  const payload = {
    ...buildChainAliases(params.chain),
    ...buildTokenAliases(params.tokenAddress),
    amount: params.amount,
    slippage: toBackendSlippage(params.slippage ?? 1),
    dex: params.dex,
    ...buildWalletAliases(params.walletAddress),
    referrer: params.referrer,
    priorityFee: params.priorityFee,
    outputToken: params.outputToken,
  };

  const response = await client.post<TradeResult>(Endpoints.SELL_V2, payload);
  return response;
}
