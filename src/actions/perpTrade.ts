/**
 * Perpetual futures trading actions on HyperLiquid.
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import {
  OpenPerpParams,
  ClosePerpParams,
  SetLeverageParams,
  GetPositionsParams,
  PerpDepositParams,
  PerpWithdrawParams,
  PerpResult,
  PerpPosition,
} from '../types/perp';
import { TransactionResult } from '../types/common';
import {
  validateAmount,
  validateCoin,
  validateLeverage,
  validateRequired,
  validateSlippage,
} from '../utils/validation';

/**
 * Open a perpetual position on HyperLiquid.
 *
 * @param client - Authenticated API client
 * @param params - Position parameters
 */
export async function openPerpPosition(client: GdexApiClient, params: OpenPerpParams): Promise<PerpResult> {
  validateCoin(params.coin);
  validateRequired(params.side, 'side');
  validateAmount(params.sizeUsd, 'sizeUsd');
  if (params.leverage !== undefined) validateLeverage(params.leverage);
  if (params.slippage !== undefined) validateSlippage(params.slippage);

  const payload = {
    coin: params.coin.toUpperCase(),
    side: params.side,
    sizeUsd: params.sizeUsd,
    leverage: params.leverage ?? 5,
    slippage: params.slippage ?? 1,
    takeProfitPrice: params.takeProfitPrice,
    stopLossPrice: params.stopLossPrice,
    marginMode: params.marginMode ?? 'cross',
    walletAddress: params.walletAddress,
  };

  return client.post<PerpResult>(Endpoints.HL_TRADE, payload);
}

/**
 * Close a perpetual position on HyperLiquid.
 *
 * @param client - Authenticated API client
 * @param params - Close parameters
 */
export async function closePerpPosition(client: GdexApiClient, params: ClosePerpParams): Promise<PerpResult> {
  validateCoin(params.coin);

  const closePercent = params.closePercent ?? 100;
  if (closePercent <= 0 || closePercent > 100) {
    throw new Error('closePercent must be between 1 and 100');
  }
  if (params.slippage !== undefined) validateSlippage(params.slippage);

  const payload = {
    coin: params.coin.toUpperCase(),
    action: 'close',
    closePercent,
    slippage: params.slippage ?? 1,
    walletAddress: params.walletAddress,
  };

  return client.post<PerpResult>(Endpoints.HL_TRADE, payload);
}

/**
 * Set leverage for a perpetual asset on HyperLiquid.
 *
 * @param client - Authenticated API client
 * @param params - Leverage parameters
 */
export async function setPerpLeverage(client: GdexApiClient, params: SetLeverageParams): Promise<void> {
  validateCoin(params.coin);
  validateLeverage(params.leverage);

  const payload = {
    coin: params.coin.toUpperCase(),
    leverage: params.leverage,
    marginMode: params.marginMode ?? 'cross',
    walletAddress: params.walletAddress,
  };

  await client.post<void>(Endpoints.HL_LEVERAGE, payload);
}

/**
 * Get open perpetual positions on HyperLiquid.
 *
 * @param client - Authenticated API client
 * @param params - Query parameters
 */
export async function getPerpPositions(
  client: GdexApiClient,
  params: GetPositionsParams
): Promise<PerpPosition[]> {
  validateRequired(params.walletAddress, 'walletAddress');

  const queryParams: Record<string, unknown> = {
    walletAddress: params.walletAddress,
  };
  if (params.coin) {
    queryParams.coin = params.coin.toUpperCase();
  }

  return client.get<PerpPosition[]>(Endpoints.HL_POSITIONS, queryParams);
}

/**
 * Deposit USDC into HyperLiquid perpetual account.
 *
 * @param client - Authenticated API client
 * @param params - Deposit parameters
 */
export async function perpDeposit(
  client: GdexApiClient,
  params: PerpDepositParams
): Promise<TransactionResult> {
  validateAmount(params.amount, 'amount');

  const payload = {
    amount: params.amount,
    walletAddress: params.walletAddress,
  };

  return client.post<TransactionResult>(Endpoints.HL_DEPOSIT, payload);
}

/**
 * Withdraw USDC from HyperLiquid perpetual account.
 *
 * @param client - Authenticated API client
 * @param params - Withdraw parameters
 */
export async function perpWithdraw(
  client: GdexApiClient,
  params: PerpWithdrawParams
): Promise<TransactionResult> {
  validateAmount(params.amount, 'amount');

  const payload = {
    amount: params.amount,
    walletAddress: params.walletAddress,
  };

  return client.post<TransactionResult>(Endpoints.HL_WITHDRAW, payload);
}
