/**
 * Spot trading actions — buy and sell tokens on supported chains.
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import { BuyTokenParams, SellTokenParams, TradeResult } from '../types/trading';
import { validateTokenAddress, validateAmount, validateChain, validateSlippage } from '../utils/validation';

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

  const payload = {
    chain: params.chain,
    tokenAddress: params.tokenAddress,
    amount: params.amount,
    slippage: params.slippage ?? 1,
    dex: params.dex,
    walletAddress: params.walletAddress,
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
    chain: params.chain,
    tokenAddress: params.tokenAddress,
    amount: params.amount,
    slippage: params.slippage ?? 1,
    dex: params.dex,
    walletAddress: params.walletAddress,
    referrer: params.referrer,
    priorityFee: params.priorityFee,
    outputToken: params.outputToken,
  };

  const response = await client.post<TradeResult>(Endpoints.SELL_V2, payload);
  return response;
}
