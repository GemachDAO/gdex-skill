/**
 * Spot trading actions — buy and sell tokens on supported chains.
 */
import { parseUnits } from 'ethers';
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import { BuyTokenParams, SellTokenParams, TradeResult } from '../types/trading';
import { validateTokenAddress, validateAmount, validateChain, validateSlippage } from '../utils/validation';
import { buildChainAliases, buildTokenAliases, buildWalletAliases } from '../utils/apiAliases';
import { toBackendSlippage } from '../utils/slippage';
import { buildGdexManagedTradeComputedData, generateGdexNonce } from '../utils/gdexManagedCrypto';

/**
 * Submit a managed-custody EVM buy via the session-signed `purchase_v2` flow.
 *
 * Managed-custody trades cannot use the plain-param path — the backend rejects
 * them as "missing params". The spend is the chain's native token; `amount` is a
 * decimal native amount (18 decimals) converted to wei here.
 */
async function submitManagedBuy(client: GdexApiClient, params: BuyTokenParams): Promise<TradeResult> {
  const amountWei = parseUnits(params.amount, 18).toString();
  const { computedData } = buildGdexManagedTradeComputedData({
    apiKey: params.apiKey as string,
    action: 'purchase',
    userId: params.walletAddress as string,
    tokenAddress: params.tokenAddress,
    amount: amountWei,
    nonce: String(generateGdexNonce()),
    sessionPrivateKey: params.sessionPrivateKey as string,
  });
  const body: Record<string, unknown> = { computedData, chainId: params.chain };
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
  // pass a session key keep the original plain-param behaviour.
  if (typeof params.chain === 'number' && params.sessionPrivateKey && params.walletAddress && params.apiKey) {
    return submitManagedBuy(client, params);
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
