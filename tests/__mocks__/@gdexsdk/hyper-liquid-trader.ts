/**
 * Jest manual mock for @gdexsdk/hyper-liquid-trader.
 *
 * Prevents ESM import errors in the test environment
 * and provides controllable mock instances.
 */

const mockTrader = {
  getAccountState: jest.fn().mockResolvedValue({
    marginSummary: { accountValue: '0', totalNtlPos: '0', totalRawUsd: '0', totalMarginUsed: '0' },
    assetPositions: [],
  }),
  getMidPrice: jest.fn().mockResolvedValue(0),
  getAllMids: jest.fn().mockResolvedValue({}),
  getBalance: jest.fn().mockResolvedValue(0),
  getOpenOrders: jest.fn().mockResolvedValue([]),
  getTradeHistory: jest.fn().mockResolvedValue([]),
  getSpotState: jest.fn().mockResolvedValue(undefined),
  getTraderLeverageContext: jest.fn().mockResolvedValue(undefined),
  executeCrossPerp: jest.fn().mockResolvedValue({ status: 'ok' }),
  executeIsolatedPerp: jest.fn().mockResolvedValue({ status: 'ok' }),
  executeSpot: jest.fn().mockResolvedValue({ status: 'ok' }),
  cancelOrder: jest.fn().mockResolvedValue({ status: 'ok' }),
  setTargetWallets: jest.fn(),
  setAssets: jest.fn(),
  startCopyTrade: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn(),
};

export const HyperLiquidTrading = jest.fn(() => mockTrader);
export const DEFAULT_WSS = 'wss://api.hyperliquid.xyz/ws';
export const __mockTrader = mockTrader;
