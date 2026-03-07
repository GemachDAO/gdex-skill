/**
 * Bridge action — cross-chain asset bridging.
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import { BridgeParams, BridgeResult, BridgeQuote } from '../types/bridge';
import { validateAmount, validateChain, validateSlippage } from '../utils/validation';

/**
 * Bridge tokens from one chain to another.
 *
 * @param client - Authenticated API client
 * @param params - Bridge parameters
 */
export async function bridge(client: GdexApiClient, params: BridgeParams): Promise<BridgeResult> {
  validateChain(params.fromChain);
  validateChain(params.toChain);
  validateAmount(params.amount, 'amount');
  if (params.slippage !== undefined) validateSlippage(params.slippage);

  const payload = {
    fromChain: params.fromChain,
    toChain: params.toChain,
    tokenAddress: params.tokenAddress,
    amount: params.amount,
    destinationAddress: params.destinationAddress,
    slippage: params.slippage ?? 0.5,
    walletAddress: params.walletAddress,
  };

  return client.post<BridgeResult>(Endpoints.BRIDGE, payload);
}

/**
 * Get a bridge quote without executing the transaction.
 *
 * @param client - API client
 * @param params - Bridge parameters (amount required)
 */
export async function getBridgeQuote(
  client: GdexApiClient,
  params: BridgeParams
): Promise<BridgeQuote> {
  validateChain(params.fromChain);
  validateChain(params.toChain);
  validateAmount(params.amount, 'amount');

  const queryParams = {
    fromChain: params.fromChain,
    toChain: params.toChain,
    tokenAddress: params.tokenAddress,
    amount: params.amount,
  };

  return client.get<BridgeQuote>(Endpoints.BRIDGE_QUOTE, queryParams);
}
