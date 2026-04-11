import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSdk, handleToolCall } from '../sdk.js';

export function registerDirectExecTools(server: McpServer): void {
  server.tool(
    'execute_cross_perp',
    'Execute a cross-margin perpetual trade directly with a private key (no managed custody). Supports TP/SL and builder fees.',
    {
      privateKey: z.string().describe('Wallet private key (hex)'),
      coin: z.string().describe("Asset symbol, e.g. 'BTC'"),
      isLong: z.boolean().describe('True for long, false for short'),
      price: z.string().describe('Price in USD'),
      positionSize: z.string().describe('Position size'),
      reduceOnly: z.boolean().optional().default(false),
      leverage: z.number().optional().describe('Leverage for cross-margin (calls updateLeverage before placing)'),
      isMarket: z.boolean().optional().default(true).describe('True for market, false for limit'),
      takeProfitPrice: z.string().optional().describe('Take-profit price'),
      takeProfitTrigger: z.string().optional().describe('Take-profit trigger price'),
      stopLossPrice: z.string().optional().describe('Stop-loss price'),
      stopLossTrigger: z.string().optional().describe('Stop-loss trigger price'),
      builderFeeAddress: z.string().optional().describe('Builder fee wallet address'),
      builderFeeRate: z.number().optional().describe('Builder fee rate in basis points'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      const tradeParams: any = {
        coin: params.coin,
        isLong: params.isLong,
        price: params.price,
        positionSize: params.positionSize,
        reduceOnly: params.reduceOnly,
        leverage: params.leverage,
      };
      if (params.takeProfitPrice && params.takeProfitTrigger) {
        tradeParams.takeProfit = { price: params.takeProfitPrice, triggerPrice: params.takeProfitTrigger };
      }
      if (params.stopLossPrice && params.stopLossTrigger) {
        tradeParams.stopLoss = { price: params.stopLossPrice, triggerPrice: params.stopLossTrigger };
      }
      if (params.builderFeeAddress && params.builderFeeRate) {
        tradeParams.builderFee = { address: params.builderFeeAddress, feeRate: params.builderFeeRate };
      }
      return sdk.hlExecuteCrossPerp(params.privateKey, tradeParams, params.isMarket);
    }),
  );

  server.tool(
    'execute_isolated_perp',
    'Execute an isolated-margin perpetual trade directly with a private key. Requires explicit leverage.',
    {
      privateKey: z.string().describe('Wallet private key (hex)'),
      coin: z.string().describe('Asset symbol'),
      isLong: z.boolean().describe('True for long, false for short'),
      price: z.string().describe('Price in USD'),
      positionSize: z.string().describe('Position size'),
      leverage: z.number().describe('Leverage (required for isolated margin)'),
      reduceOnly: z.boolean().optional().default(false),
      isMarket: z.boolean().optional().default(true),
      takeProfitPrice: z.string().optional(),
      takeProfitTrigger: z.string().optional(),
      stopLossPrice: z.string().optional(),
      stopLossTrigger: z.string().optional(),
      builderFeeAddress: z.string().optional(),
      builderFeeRate: z.number().optional(),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      const tradeParams: any = {
        coin: params.coin,
        isLong: params.isLong,
        price: params.price,
        positionSize: params.positionSize,
        leverage: params.leverage,
        reduceOnly: params.reduceOnly,
      };
      if (params.takeProfitPrice && params.takeProfitTrigger) {
        tradeParams.takeProfit = { price: params.takeProfitPrice, triggerPrice: params.takeProfitTrigger };
      }
      if (params.stopLossPrice && params.stopLossTrigger) {
        tradeParams.stopLoss = { price: params.stopLossPrice, triggerPrice: params.stopLossTrigger };
      }
      if (params.builderFeeAddress && params.builderFeeRate) {
        tradeParams.builderFee = { address: params.builderFeeAddress, feeRate: params.builderFeeRate };
      }
      return sdk.hlExecuteIsolatedPerp(params.privateKey, tradeParams, params.isMarket);
    }),
  );

  server.tool(
    'execute_spot',
    'Execute a spot trade directly on HyperLiquid with a private key.',
    {
      privateKey: z.string().describe('Wallet private key (hex)'),
      coin: z.string().describe('Asset symbol'),
      isBuy: z.boolean().describe('True for buy, false for sell'),
      price: z.string().describe('Price'),
      size: z.string().describe('Trade size'),
      isMarket: z.boolean().optional().default(true),
      builderFeeAddress: z.string().optional(),
      builderFeeRate: z.number().optional(),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      const spotParams: any = {
        coin: params.coin,
        isBuy: params.isBuy,
        price: params.price,
        size: params.size,
      };
      if (params.builderFeeAddress && params.builderFeeRate) {
        spotParams.builderFee = { address: params.builderFeeAddress, feeRate: params.builderFeeRate };
      }
      return sdk.hlExecuteSpot(params.privateKey, spotParams, params.isMarket);
    }),
  );

  server.tool(
    'direct_cancel_order',
    'Cancel an open order directly with a private key on HyperLiquid.',
    {
      privateKey: z.string().describe('Wallet private key (hex)'),
      coin: z.string().describe('Asset symbol'),
      orderId: z.number().describe('Order ID (numeric)'),
    },
    async ({ privateKey, coin, orderId }) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.hlDirectCancelOrder(privateKey, coin, orderId);
    }),
  );
}
