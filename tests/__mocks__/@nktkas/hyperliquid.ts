/**
 * Jest manual mock for @nktkas/hyperliquid.
 *
 * Prevents ESM import errors in the test environment
 * and provides controllable mock instances.
 */

const mockInfoClient = {
  clearinghouseState: jest.fn().mockResolvedValue({
    crossMarginSummary: { accountValue: '0', totalNtlPos: '0', totalRawUsd: '0', totalMarginUsed: '0' },
    withdrawable: '0',
    assetPositions: [],
  }),
  l2Book: jest.fn().mockResolvedValue({ levels: [[], []] }),
  frontendOpenOrders: jest.fn().mockResolvedValue([]),
  userFills: jest.fn().mockResolvedValue([]),
};

export const InfoClient = jest.fn(() => mockInfoClient);
export const HttpTransport = jest.fn();
export const ExchangeClient = jest.fn();
export const __mockInfoClient = mockInfoClient;
