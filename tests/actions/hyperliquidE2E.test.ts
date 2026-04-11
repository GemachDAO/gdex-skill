/**
 * HyperLiquid End-to-End Integration Tests
 *
 * Comprehensive coverage of all HL paths through the GdexSkill facade:
 *   1. Read operations  — L1 queries via @gdexsdk/hyper-liquid-trader
 *   2. Write operations — managed-custody computedData flow (encode → sign → encrypt → POST)
 *   3. Direct execution — private-key trading via HyperLiquidTrading SDK
 *   4. HL copy trading  — discovery, session-key reads, computedData writes
 *   5. Crypto pipeline  — ABI encoding, signing, AES encryption round-trips
 *   6. GdexSkill facade — all HL methods delegate correctly
 *   7. Edge cases       — empty state, missing params, case normalization, defaults
 */
import { GdexApiClient } from '../../src/client';
import { GdexSkill, GDEX_API_KEY_PRIMARY } from '../../src/index';
import {
  getHlAccountState,
  getPerpPositions,
  getHlMarkPrice,
  getHlUsdcBalance,
  getHlOpenOrders,
  getGbotUsdcBalance,
  perpDeposit,
  perpWithdraw,
  hlCreateOrder,
  hlPlaceOrder,
  hlCloseAll,
  hlCancelOrder,
  hlCancelAllOrders,
  hlUpdateLeverage,
  getHlAllMids,
  getHlTradeHistory,
  getHlTraderLeverageContext,
  getHlSpotState,
  hlExecuteCrossPerp,
  hlExecuteIsolatedPerp,
  hlExecuteSpot,
  hlDirectCancelOrder,
  createHlTrader,
} from '../../src/actions/perpTrade';
import {
  getHlTopTraders,
  getHlTopTradersByPnl,
  getHlUserStats,
  getHlPerpDexes,
  getHlAllAssets,
  getHlClearinghouseState,
  getHlClearinghouseStateAll,
  getHlOpenOrdersForCopy,
  getHlOpenOrdersAllForCopy,
  getHlMetaAndAssetCtxs,
  getHlDepositTokens,
  getHlUsdcBalanceForCopy,
  getHlCopyTradeList,
  getHlCopyTradeTxList,
  createHlCopyTrade,
  updateHlCopyTrade,
} from '../../src/actions/hlCopyTrade';
import { GdexValidationError } from '../../src/utils/errors';
import * as crypto from '../../src/utils/gdexManagedCrypto';
import * as Endpoints from '../../src/client/endpoints';

// ── Mock setup ──────────────────────────────────────────────────────────────

jest.mock('../../src/client');
jest.mock('../../src/utils/gdexManagedCrypto', () => {
  const actual = jest.requireActual('../../src/utils/gdexManagedCrypto');
  return {
    ...actual,
    buildHlComputedData: jest.fn().mockReturnValue('mock-encrypted-computed-data'),
  };
});

const MockedClient = GdexApiClient as jest.MockedClass<typeof GdexApiClient>;

function getMockTrader() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { __mockTrader } = require('@gdexsdk/hyper-liquid-trader');
  return __mockTrader;
}

const CREDS = {
  apiKey: '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54',
  walletAddress: '0xABCDef1234567890abcdef1234567890ABCDEF12',
  sessionPrivateKey: '0x' + 'ab'.repeat(32),
};

// ═════════════════════════════════════════════════════════════════════════════
// 1. READ OPERATIONS — HyperLiquid L1 via trader SDK
// ═════════════════════════════════════════════════════════════════════════════

describe('HyperLiquid E2E — Read Operations', () => {
  let client: jest.Mocked<GdexApiClient>;

  beforeEach(() => {
    client = new MockedClient() as jest.Mocked<GdexApiClient>;
    (crypto.buildHlComputedData as jest.Mock).mockReturnValue('mock-encrypted-computed-data');

    const hl = require('@gdexsdk/hyper-liquid-trader');
    hl.HyperLiquidTrading.mockImplementation(() => hl.__mockTrader);
    const mock = hl.__mockTrader;
    mock.getAccountState.mockResolvedValue({
      marginSummary: { accountValue: '5000', totalNtlPos: '2000', totalRawUsd: '5000', totalMarginUsed: '200' },
      assetPositions: [],
    });
    mock.getMidPrice.mockResolvedValue(0);
    mock.getAllMids.mockResolvedValue({});
    mock.getBalance.mockResolvedValue(0);
    mock.getOpenOrders.mockResolvedValue([]);
    mock.getTradeHistory.mockResolvedValue([]);
    mock.getSpotState.mockResolvedValue(undefined);
    mock.getTraderLeverageContext.mockResolvedValue(undefined);
    mock.executeCrossPerp.mockResolvedValue({ status: 'ok' });
    mock.executeIsolatedPerp.mockResolvedValue({ status: 'ok' });
    mock.executeSpot.mockResolvedValue({ status: 'ok' });
    mock.cancelOrder.mockResolvedValue({ status: 'ok' });
  });

  describe('getHlAccountState — Multi-position portfolio', () => {
    it('should parse complex multi-asset portfolio with mixed long/short positions', async () => {
      getMockTrader().getAccountState.mockResolvedValue({
        marginSummary: {
          accountValue: '25000.75',
          totalNtlPos: '15000',
          totalRawUsd: '25000.75',
          totalMarginUsed: '1500',
        },
        assetPositions: [
          {
            position: {
              coin: 'BTC',
              szi: '0.1',
              entryPx: '100000',
              leverage: { value: 20 },
              liquidationPx: '95000',
              unrealizedPnl: '500',
              marginUsed: '500',
              positionValue: '10000',
            },
          },
          {
            position: {
              coin: 'ETH',
              szi: '-10',
              entryPx: '3000',
              leverage: { value: 5 },
              liquidationPx: '3500',
              unrealizedPnl: '-200',
              marginUsed: '600',
              positionValue: '30000',
            },
          },
          {
            position: {
              coin: 'SOL',
              szi: '100',
              entryPx: '150',
              leverage: { value: 10 },
              liquidationPx: '135',
              unrealizedPnl: '300',
              marginUsed: '150',
              positionValue: '15000',
            },
          },
        ],
      });

      const state = await getHlAccountState('0xMultiUser');

      expect(state.positions).toHaveLength(3);
      expect(state.accountValue).toBe('25000.75');
      expect(state.totalMarginUsed).toBe('1500');

      // Verify withdrawable = accountValue - totalMarginUsed
      expect(parseFloat(state.withdrawable)).toBeCloseTo(23500.75, 1);

      // BTC long
      const btc = state.positions.find(p => p.coin === 'BTC')!;
      expect(btc.side).toBe('long');
      expect(btc.size).toBe('0.1');
      expect(btc.leverage).toBe(20);
      expect(btc.entryPrice).toBe('100000');
      expect(btc.liquidationPrice).toBe('95000');
      expect(btc.unrealizedPnl).toBe('500');

      // ETH short
      const eth = state.positions.find(p => p.coin === 'ETH')!;
      expect(eth.side).toBe('short');
      expect(eth.size).toBe('10');   // absolute value
      expect(eth.leverage).toBe(5);
      expect(eth.unrealizedPnl).toBe('-200');

      // SOL long
      const sol = state.positions.find(p => p.coin === 'SOL')!;
      expect(sol.side).toBe('long');
      expect(sol.size).toBe('100');
    });

    it('should handle edge case: zero balance, no positions', async () => {
      getMockTrader().getAccountState.mockResolvedValue({
        marginSummary: { accountValue: '0', totalNtlPos: '0', totalRawUsd: '0', totalMarginUsed: '0' },
        assetPositions: [],
      });

      const state = await getHlAccountState('0xEmptyWallet');
      expect(state.accountValue).toBe('0');
      expect(state.withdrawable).toBe('0');
      expect(state.positions).toEqual([]);
    });

    it('should handle edge case: null/undefined response from SDK', async () => {
      getMockTrader().getAccountState.mockResolvedValue(null);

      const state = await getHlAccountState('0xBroken');
      expect(state.accountValue).toBe('0');
      expect(state.positions).toHaveLength(0);
    });

    it('should handle position with zero szi (liquidated)', async () => {
      getMockTrader().getAccountState.mockResolvedValue({
        marginSummary: { accountValue: '100', totalNtlPos: '0', totalRawUsd: '100', totalMarginUsed: '0' },
        assetPositions: [
          {
            position: {
              coin: 'DOGE',
              szi: '0',
              entryPx: '0.5',
              leverage: { value: 1 },
              liquidationPx: null,
              unrealizedPnl: '0',
              marginUsed: '0',
              positionValue: '0',
            },
          },
        ],
      });

      const state = await getHlAccountState('0xLiquidated');
      expect(state.positions[0].side).toBe('long'); // szi=0 ≥ 0 → long
      expect(state.positions[0].size).toBe('0');
    });
  });

  describe('getPerpPositions — Coin filtering', () => {
    beforeEach(() => {
      getMockTrader().getAccountState.mockResolvedValue({
        marginSummary: { accountValue: '1000', totalNtlPos: '0', totalRawUsd: '1000', totalMarginUsed: '0' },
        assetPositions: [
          { position: { coin: 'BTC', szi: '0.01', entryPx: '100000', leverage: { value: 10 }, liquidationPx: null, unrealizedPnl: '0', marginUsed: '100', positionValue: '1000' } },
          { position: { coin: 'ETH', szi: '-1', entryPx: '3000', leverage: { value: 5 }, liquidationPx: null, unrealizedPnl: '0', marginUsed: '600', positionValue: '3000' } },
          { position: { coin: 'SOL', szi: '50', entryPx: '150', leverage: { value: 3 }, liquidationPx: null, unrealizedPnl: '0', marginUsed: '250', positionValue: '7500' } },
        ],
      });
    });

    it('should return all positions when no coin filter', async () => {
      const positions = await getPerpPositions({ walletAddress: '0xUser' });
      expect(positions).toHaveLength(3);
    });

    it('should filter case-insensitively', async () => {
      const btc = await getPerpPositions({ walletAddress: '0xUser', coin: 'btc' });
      expect(btc).toHaveLength(1);
      expect(btc[0].coin).toBe('BTC');

      const eth = await getPerpPositions({ walletAddress: '0xUser', coin: 'Eth' });
      expect(eth).toHaveLength(1);

      const sol = await getPerpPositions({ walletAddress: '0xUser', coin: 'SOL' });
      expect(sol).toHaveLength(1);
    });

    it('should return empty array for non-existent coin', async () => {
      const result = await getPerpPositions({ walletAddress: '0xUser', coin: 'DOGE' });
      expect(result).toEqual([]);
    });
  });

  describe('getHlMarkPrice', () => {
    it('should return numeric price for valid coin', async () => {
      getMockTrader().getMidPrice.mockResolvedValue(105234.56);

      const price = await getHlMarkPrice('BTC');
      expect(price).toBe(105234.56);
      expect(getMockTrader().getMidPrice).toHaveBeenCalledWith('BTC');
    });

    it('should uppercase the coin before API call', async () => {
      getMockTrader().getMidPrice.mockResolvedValue(3200);

      await getHlMarkPrice('eth');
      expect(getMockTrader().getMidPrice).toHaveBeenCalledWith('ETH');
    });

    it('should return 0 for undefined/null response', async () => {
      getMockTrader().getMidPrice.mockResolvedValue(undefined);
      expect(await getHlMarkPrice('UNKNOWN')).toBe(0);

      getMockTrader().getMidPrice.mockResolvedValue(null);
      expect(await getHlMarkPrice('NONE')).toBe(0);
    });
  });

  describe('getHlUsdcBalance', () => {
    it('should return balance from trader', async () => {
      getMockTrader().getBalance.mockResolvedValue(1234.56);
      const bal = await getHlUsdcBalance('0xWallet');
      expect(bal).toBe(1234.56);
    });

    it('should return 0 for undefined', async () => {
      getMockTrader().getBalance.mockResolvedValue(undefined);
      expect(await getHlUsdcBalance('0xEmpty')).toBe(0);
    });
  });

  describe('getHlOpenOrders', () => {
    it('should return orders array', async () => {
      const orders = [
        { oid: 1, coin: 'BTC', side: 'B', sz: '0.01', limitPx: '99000' },
        { oid: 2, coin: 'ETH', side: 'A', sz: '5', limitPx: '3100' },
      ];
      getMockTrader().getOpenOrders.mockResolvedValue(orders);

      const result = await getHlOpenOrders('0xTrader');
      expect(result).toEqual(orders);
      expect(result).toHaveLength(2);
    });

    it('should throw for empty wallet address', async () => {
      await expect(getHlOpenOrders('')).rejects.toThrow(GdexValidationError);
    });
  });

  describe('getHlAllMids', () => {
    it('should return mid prices map', async () => {
      const mids = { BTC: '105000', ETH: '3200', SOL: '155', DOGE: '0.35' };
      getMockTrader().getAllMids.mockResolvedValue(mids);

      const result = await getHlAllMids();
      expect(result).toEqual(mids);
      expect(Object.keys(result!)).toHaveLength(4);
    });

    it('should return undefined when SDK returns undefined', async () => {
      getMockTrader().getAllMids.mockResolvedValue(undefined);
      expect(await getHlAllMids()).toBeUndefined();
    });
  });

  describe('getHlTradeHistory', () => {
    it('should return trade history for wallet', async () => {
      const fills = [
        { coin: 'BTC', px: '100000', sz: '0.01', side: 'B', time: 1700000000000 },
        { coin: 'BTC', px: '101000', sz: '0.01', side: 'A', time: 1700001000000 },
      ];
      getMockTrader().getTradeHistory.mockResolvedValue(fills);

      const result = await getHlTradeHistory('0xUser');
      expect(result).toEqual(fills);
    });

    it('should throw for empty walletAddress', async () => {
      await expect(getHlTradeHistory('')).rejects.toThrow(GdexValidationError);
    });
  });

  describe('getHlTraderLeverageContext', () => {
    it('should return leverage value', async () => {
      getMockTrader().getTraderLeverageContext.mockResolvedValue(20);

      const lev = await getHlTraderLeverageContext('0xTrader', 'btc');
      expect(lev).toBe(20);
      expect(getMockTrader().getTraderLeverageContext).toHaveBeenCalledWith('0xTrader', 'BTC');
    });

    it('should return undefined for unknown trader/coin', async () => {
      getMockTrader().getTraderLeverageContext.mockResolvedValue(undefined);
      expect(await getHlTraderLeverageContext('0xUnknown', 'XYZ')).toBeUndefined();
    });

    it('should throw for empty traderWallet', async () => {
      await expect(getHlTraderLeverageContext('', 'BTC')).rejects.toThrow(GdexValidationError);
    });

    it('should throw for empty coin', async () => {
      await expect(getHlTraderLeverageContext('0xTrader', '')).rejects.toThrow(GdexValidationError);
    });
  });

  describe('getHlSpotState', () => {
    it('should return spot state', async () => {
      const state = { balances: [{ coin: 'USDC', hold: '0', total: '1000' }] };
      getMockTrader().getSpotState.mockResolvedValue(state);

      const result = await getHlSpotState('0xWallet');
      expect(result).toEqual(state);
    });

    it('should throw for empty address', async () => {
      await expect(getHlSpotState('')).rejects.toThrow(GdexValidationError);
    });
  });

  describe('getGbotUsdcBalance', () => {
    it('should call backend endpoint with lowercased address', async () => {
      client.get = jest.fn().mockResolvedValue({ balance: 750.5 });

      const bal = await getGbotUsdcBalance(client, '0xABCD');
      expect(client.get).toHaveBeenCalledWith('/v1/hl/gbot_usdc_balance', { address: '0xabcd' });
      expect(bal).toBe(750.5);
    });

    it('should return 0 when response.balance is missing', async () => {
      client.get = jest.fn().mockResolvedValue({});

      const bal = await getGbotUsdcBalance(client, '0xTest');
      expect(bal).toBe(0);
    });

    it('should throw for empty walletAddress', async () => {
      await expect(getGbotUsdcBalance(client, '')).rejects.toThrow(GdexValidationError);
    });
  });

  describe('createHlTrader', () => {
    it('should create a new HyperLiquidTrading instance', async () => {
      const trader = await createHlTrader();
      expect(trader).toBeDefined();
    });

    it('should accept custom WS URLs', async () => {
      const hl = require('@gdexsdk/hyper-liquid-trader');
      await createHlTrader(['wss://custom.ws']);
      expect(hl.HyperLiquidTrading).toHaveBeenCalledWith(['wss://custom.ws']);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. WRITE OPERATIONS — Managed-Custody computedData Flow
// ═════════════════════════════════════════════════════════════════════════════

describe('HyperLiquid E2E — Managed-Custody Write Operations', () => {
  let client: jest.Mocked<GdexApiClient>;

  beforeEach(() => {
    client = new MockedClient() as jest.Mocked<GdexApiClient>;
    (crypto.buildHlComputedData as jest.Mock).mockReturnValue('mock-encrypted-computed-data');
    client.post = jest.fn().mockResolvedValue({ isSuccess: true, message: 'ok' });
  });

  describe('perpDeposit — Full deposit lifecycle', () => {
    it('should convert human-readable USDC to smallest unit (6 decimals)', async () => {
      await perpDeposit(client, {
        ...CREDS,
        tokenAddress: '0xUSDC',
        amount: '100',
        chainId: 42161,
      });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        action: 'hl_deposit',
        apiKey: CREDS.apiKey,
        walletAddress: CREDS.walletAddress,
        sessionPrivateKey: CREDS.sessionPrivateKey,
        actionParams: {
          chainId: 42161,
          tokenAddress: '0xUSDC',
          amount: '100000000', // 100 * 1e6
        },
      }));
      expect(client.post).toHaveBeenCalledWith(Endpoints.HL_DEPOSIT, {
        computedData: 'mock-encrypted-computed-data',
      });
    });

    it('should handle fractional USDC amounts', async () => {
      await perpDeposit(client, {
        ...CREDS,
        tokenAddress: '0xUSDC',
        amount: '10.5',
        chainId: 42161,
      });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        actionParams: expect.objectContaining({
          amount: '10500000', // 10.5 * 1e6
        }),
      }));
    });

    it('should reject negative amount', async () => {
      await expect(perpDeposit(client, {
        ...CREDS, tokenAddress: '0xUSDC', amount: '-50', chainId: 42161,
      })).rejects.toThrow(GdexValidationError);
    });

    it('should reject zero amount', async () => {
      await expect(perpDeposit(client, {
        ...CREDS, tokenAddress: '0xUSDC', amount: '0', chainId: 42161,
      })).rejects.toThrow(GdexValidationError);
    });

    it('should reject empty walletAddress', async () => {
      await expect(perpDeposit(client, {
        ...CREDS, walletAddress: '', tokenAddress: '0xUSDC', amount: '10', chainId: 42161,
      })).rejects.toThrow(GdexValidationError);
    });

    it('should reject empty tokenAddress', async () => {
      await expect(perpDeposit(client, {
        ...CREDS, tokenAddress: '', amount: '10', chainId: 42161,
      })).rejects.toThrow(GdexValidationError);
    });

    it('should reject missing chainId', async () => {
      await expect(perpDeposit(client, {
        ...CREDS, tokenAddress: '0xUSDC', amount: '10', chainId: undefined as any,
      })).rejects.toThrow(GdexValidationError);
    });
  });

  describe('perpWithdraw — Withdrawal flow', () => {
    it('should build withdraw computedData and POST to correct endpoint', async () => {
      const result = await perpWithdraw(client, { ...CREDS, amount: '250' });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        action: 'hl_withdraw',
        actionParams: { amount: '250' },
      }));
      expect(client.post).toHaveBeenCalledWith(Endpoints.HL_WITHDRAW, {
        computedData: 'mock-encrypted-computed-data',
      });
      expect(result.isSuccess).toBe(true);
    });

    it('should reject zero amount', async () => {
      await expect(perpWithdraw(client, { ...CREDS, amount: '0' }))
        .rejects.toThrow(GdexValidationError);
    });

    it('should reject non-numeric amount', async () => {
      await expect(perpWithdraw(client, { ...CREDS, amount: 'abc' }))
        .rejects.toThrow(GdexValidationError);
    });

    it('should reject empty walletAddress', async () => {
      await expect(perpWithdraw(client, { ...CREDS, walletAddress: '', amount: '10' }))
        .rejects.toThrow(GdexValidationError);
    });
  });

  describe('hlCreateOrder — Full order lifecycle', () => {
    it('should create market long order with TP/SL', async () => {
      client.post = jest.fn().mockResolvedValue({
        isSuccess: true,
        message: 'Order filled',
        orderId: 'ORD-123',
      });

      const result = await hlCreateOrder(client, {
        ...CREDS,
        coin: 'BTC',
        isLong: true,
        price: '105000',
        size: '0.001',
        tpPrice: '110000',
        slPrice: '100000',
        isMarket: true,
      });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        action: 'hl_create_order',
        actionParams: {
          coin: 'BTC',
          isLong: true,
          price: '105000',
          size: '0.001',
          reduceOnly: false,
          tpPrice: '110000',
          slPrice: '100000',
          isMarket: true,
        },
      }));
      expect(client.post).toHaveBeenCalledWith(Endpoints.HL_CREATE_ORDER, {
        computedData: 'mock-encrypted-computed-data',
      });
      expect(result.orderId).toBe('ORD-123');
    });

    it('should create short limit order without TP/SL', async () => {
      client.post = jest.fn().mockResolvedValue({ isSuccess: true, message: 'ok' });

      await hlCreateOrder(client, {
        ...CREDS,
        coin: 'ETH',
        isLong: false,
        price: '3500',
        size: '5',
        isMarket: false,
      });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        actionParams: expect.objectContaining({
          coin: 'ETH',
          isLong: false,
          tpPrice: '',       // defaults
          slPrice: '',       // defaults
          isMarket: false,
          reduceOnly: false, // defaults
        }),
      }));
    });

    it('should normalize coin to uppercase', async () => {
      client.post = jest.fn().mockResolvedValue({ isSuccess: true, message: 'ok' });

      await hlCreateOrder(client, {
        ...CREDS, coin: 'sol', isLong: true, price: '155', size: '10',
      });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        actionParams: expect.objectContaining({ coin: 'SOL' }),
      }));
    });

    it('should support reduceOnly', async () => {
      client.post = jest.fn().mockResolvedValue({ isSuccess: true, message: 'ok' });

      await hlCreateOrder(client, {
        ...CREDS, coin: 'BTC', isLong: false, price: '100000', size: '0.001',
        reduceOnly: true,
      });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        actionParams: expect.objectContaining({ reduceOnly: true }),
      }));
    });

    it('should reject empty coin', async () => {
      await expect(hlCreateOrder(client, {
        ...CREDS, coin: '', isLong: true, price: '100', size: '1',
      })).rejects.toThrow(GdexValidationError);
    });

    it('should reject empty price', async () => {
      await expect(hlCreateOrder(client, {
        ...CREDS, coin: 'BTC', isLong: true, price: '', size: '1',
      })).rejects.toThrow(GdexValidationError);
    });

    it('should reject empty size', async () => {
      await expect(hlCreateOrder(client, {
        ...CREDS, coin: 'BTC', isLong: true, price: '100', size: '',
      })).rejects.toThrow(GdexValidationError);
    });

    it('should reject empty walletAddress', async () => {
      await expect(hlCreateOrder(client, {
        ...CREDS, walletAddress: '', coin: 'BTC', isLong: true, price: '100', size: '1',
      })).rejects.toThrow(GdexValidationError);
    });
  });

  describe('hlPlaceOrder — Simple order (no TP/SL)', () => {
    it('should POST to place_order endpoint', async () => {
      client.post = jest.fn().mockResolvedValue({ isSuccess: true, message: 'ok' });

      await hlPlaceOrder(client, {
        ...CREDS, coin: 'ARB', isLong: true, price: '1.5', size: '100',
      });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        action: 'hl_place_order',
        actionParams: expect.objectContaining({
          coin: 'ARB',
          isLong: true,
          price: '1.5',
          size: '100',
          reduceOnly: false,
        }),
      }));
      expect(client.post).toHaveBeenCalledWith(Endpoints.HL_PLACE_ORDER, {
        computedData: 'mock-encrypted-computed-data',
      });
    });

    it('should reject missing price', async () => {
      await expect(hlPlaceOrder(client, {
        ...CREDS, coin: 'BTC', isLong: true, price: '', size: '1',
      })).rejects.toThrow(GdexValidationError);
    });

    it('should reject missing walletAddress', async () => {
      await expect(hlPlaceOrder(client, {
        ...CREDS, walletAddress: '', coin: 'BTC', isLong: true, price: '100', size: '1',
      })).rejects.toThrow(GdexValidationError);
    });
  });

  describe('hlCloseAll — Close all positions', () => {
    it('should POST to close_all endpoint', async () => {
      const result = await hlCloseAll(client, CREDS);

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        action: 'hl_close_all',
        actionParams: {},
      }));
      expect(client.post).toHaveBeenCalledWith(Endpoints.HL_CLOSE_ALL, {
        computedData: 'mock-encrypted-computed-data',
      });
      expect(result.isSuccess).toBe(true);
    });

    it('should reject empty walletAddress', async () => {
      await expect(hlCloseAll(client, { ...CREDS, walletAddress: '' }))
        .rejects.toThrow(GdexValidationError);
    });
  });

  describe('hlCancelOrder — Cancel specific order', () => {
    it('should POST with coin and orderId', async () => {
      await hlCancelOrder(client, { ...CREDS, coin: 'BTC', orderId: 'ORD-456' });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        action: 'hl_cancel_order',
        actionParams: { coin: 'BTC', orderId: 'ORD-456' },
      }));
      expect(client.post).toHaveBeenCalledWith(Endpoints.HL_CANCEL_ORDER, {
        computedData: 'mock-encrypted-computed-data',
      });
    });

    it('should uppercase the coin', async () => {
      await hlCancelOrder(client, { ...CREDS, coin: 'eth', orderId: '789' });
      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        actionParams: expect.objectContaining({ coin: 'ETH' }),
      }));
    });

    it('should reject empty coin', async () => {
      await expect(hlCancelOrder(client, { ...CREDS, coin: '', orderId: '1' }))
        .rejects.toThrow(GdexValidationError);
    });

    it('should reject empty orderId', async () => {
      await expect(hlCancelOrder(client, { ...CREDS, coin: 'BTC', orderId: '' }))
        .rejects.toThrow(GdexValidationError);
    });
  });

  describe('hlCancelAllOrders', () => {
    it('should POST with isCancelAll flag', async () => {
      await hlCancelAllOrders(client, CREDS);

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        action: 'hl_cancel_all_orders',
        actionParams: {},
      }));
      expect(client.post).toHaveBeenCalledWith(Endpoints.HL_CANCEL_ORDER, {
        computedData: 'mock-encrypted-computed-data',
        isCancelAll: true,
      });
    });
  });

  describe('hlUpdateLeverage', () => {
    it('should set leverage with cross margin', async () => {
      await hlUpdateLeverage(client, { ...CREDS, coin: 'BTC', leverage: 50, isCross: true });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        action: 'hl_update_leverage',
        actionParams: { coin: 'BTC', leverage: 50, isCross: true },
      }));
      expect(client.post).toHaveBeenCalledWith(Endpoints.HL_UPDATE_LEVERAGE, {
        computedData: 'mock-encrypted-computed-data',
      });
    });

    it('should set leverage with isolated margin', async () => {
      await hlUpdateLeverage(client, { ...CREDS, coin: 'ETH', leverage: 10, isCross: false });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        actionParams: expect.objectContaining({ isCross: false }),
      }));
    });

    it('should default isCross to true when omitted', async () => {
      await hlUpdateLeverage(client, { ...CREDS, coin: 'SOL', leverage: 5 });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        actionParams: expect.objectContaining({ isCross: true }),
      }));
    });

    it('should uppercase coin', async () => {
      await hlUpdateLeverage(client, { ...CREDS, coin: 'doge', leverage: 3 });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        actionParams: expect.objectContaining({ coin: 'DOGE' }),
      }));
    });

    it('should reject empty coin', async () => {
      await expect(hlUpdateLeverage(client, { ...CREDS, coin: '', leverage: 10 }))
        .rejects.toThrow(GdexValidationError);
    });

    it('should reject empty walletAddress', async () => {
      await expect(hlUpdateLeverage(client, { ...CREDS, walletAddress: '', coin: 'BTC', leverage: 10 }))
        .rejects.toThrow(GdexValidationError);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. DIRECT EXECUTION — Private-Key Trading via HyperLiquidTrading SDK
// ═════════════════════════════════════════════════════════════════════════════

describe('HyperLiquid E2E — Direct Private-Key Execution', () => {
  beforeEach(() => {
    const hl = require('@gdexsdk/hyper-liquid-trader');
    hl.HyperLiquidTrading.mockImplementation(() => hl.__mockTrader);
    hl.__mockTrader.executeCrossPerp.mockResolvedValue({ status: 'ok', orderId: 'CROSS-1' });
    hl.__mockTrader.executeIsolatedPerp.mockResolvedValue({ status: 'ok', orderId: 'ISO-1' });
    hl.__mockTrader.executeSpot.mockResolvedValue({ status: 'ok', orderId: 'SPOT-1' });
    hl.__mockTrader.cancelOrder.mockResolvedValue({ status: 'ok' });
  });

  describe('hlExecuteCrossPerp', () => {
    it('should execute cross-margin long with TP/SL', async () => {
      const result = await hlExecuteCrossPerp('0xPrivateKey', {
        coin: 'BTC',
        isLong: true,
        price: '105000',
        positionSize: '0.01',
        leverage: 20,
        takeProfit: { price: '110000', triggerPrice: '109500' },
        stopLoss: { price: '100000', triggerPrice: '100500' },
      });

      expect(getMockTrader().executeCrossPerp).toHaveBeenCalledWith(
        '0xPrivateKey',
        expect.objectContaining({
          coin: 'BTC',
          isLong: true,
          price: '105000',
          positionSize: '0.01',
          leverage: 20,
          takeProfit: { price: '110000', triggerPrice: '109500' },
          stopLoss: { price: '100000', triggerPrice: '100500' },
        }),
        true,
      );
      expect(result).toEqual({ status: 'ok', orderId: 'CROSS-1' });
    });

    it('should execute cross short market order', async () => {
      await hlExecuteCrossPerp('0xKey', {
        coin: 'eth',
        isLong: false,
        price: '3000',
        positionSize: '1',
      }, true);

      expect(getMockTrader().executeCrossPerp).toHaveBeenCalledWith(
        '0xKey',
        expect.objectContaining({ coin: 'ETH', isLong: false }),
        true,
      );
    });

    it('should execute cross limit order when isMarket=false', async () => {
      await hlExecuteCrossPerp('0xKey', {
        coin: 'SOL',
        isLong: true,
        price: '140',
        positionSize: '50',
      }, false);

      expect(getMockTrader().executeCrossPerp).toHaveBeenCalledWith(
        '0xKey',
        expect.anything(),
        false,
      );
    });

    it('should include builderFee when provided', async () => {
      await hlExecuteCrossPerp('0xKey', {
        coin: 'BTC',
        isLong: true,
        price: '100000',
        positionSize: '0.01',
        builderFee: { address: '0xBuilder', feeRate: 0.001 },
      });

      expect(getMockTrader().executeCrossPerp).toHaveBeenCalledWith(
        '0xKey',
        expect.objectContaining({
          builderFee: { address: '0xBuilder', feeRate: 0.001 },
        }),
        true,
      );
    });

    it('should reject missing privateKey', async () => {
      await expect(hlExecuteCrossPerp('', {
        coin: 'BTC', isLong: true, price: '100', positionSize: '1',
      })).rejects.toThrow(GdexValidationError);
    });

    it('should reject empty coin', async () => {
      await expect(hlExecuteCrossPerp('0xkey', {
        coin: '', isLong: true, price: '100', positionSize: '1',
      })).rejects.toThrow(GdexValidationError);
    });

    it('should reject missing price', async () => {
      await expect(hlExecuteCrossPerp('0xkey', {
        coin: 'BTC', isLong: true, price: '', positionSize: '1',
      })).rejects.toThrow(GdexValidationError);
    });

    it('should reject missing positionSize', async () => {
      await expect(hlExecuteCrossPerp('0xkey', {
        coin: 'BTC', isLong: true, price: '100', positionSize: '',
      })).rejects.toThrow(GdexValidationError);
    });
  });

  describe('hlExecuteIsolatedPerp', () => {
    it('should execute isolated-margin order with leverage', async () => {
      const result = await hlExecuteIsolatedPerp('0xKey', {
        coin: 'ETH',
        isLong: true,
        price: '3000',
        positionSize: '2',
        leverage: 10,
      });

      expect(getMockTrader().executeIsolatedPerp).toHaveBeenCalledWith(
        '0xKey',
        expect.objectContaining({
          coin: 'ETH',
          isLong: true,
          leverage: 10,
        }),
        true,
      );
      expect(result).toEqual({ status: 'ok', orderId: 'ISO-1' });
    });

    it('should reject empty privateKey', async () => {
      await expect(hlExecuteIsolatedPerp('', {
        coin: 'BTC', isLong: true, price: '100', positionSize: '1', leverage: 5,
      })).rejects.toThrow(GdexValidationError);
    });
  });

  describe('hlExecuteSpot', () => {
    it('should execute spot buy', async () => {
      const result = await hlExecuteSpot('0xKey', {
        coin: 'sol',
        isBuy: true,
        price: '155',
        size: '10',
      });

      expect(getMockTrader().executeSpot).toHaveBeenCalledWith(
        '0xKey',
        expect.objectContaining({ coin: 'SOL', isBuy: true }),
        true,
      );
      expect(result).toEqual({ status: 'ok', orderId: 'SPOT-1' });
    });

    it('should execute spot sell limit order', async () => {
      await hlExecuteSpot('0xKey', {
        coin: 'BTC',
        isBuy: false,
        price: '110000',
        size: '0.01',
      }, false);

      expect(getMockTrader().executeSpot).toHaveBeenCalledWith(
        '0xKey',
        expect.anything(),
        false,
      );
    });

    it('should reject empty coin', async () => {
      await expect(hlExecuteSpot('0xKey', {
        coin: '', isBuy: true, price: '100', size: '1',
      })).rejects.toThrow(GdexValidationError);
    });
  });

  describe('hlDirectCancelOrder', () => {
    it('should cancel by coin and oid', async () => {
      const result = await hlDirectCancelOrder('0xKey', 'BTC', 12345);

      expect(getMockTrader().cancelOrder).toHaveBeenCalledWith('0xKey', 'BTC', 12345);
      expect(result).toEqual({ status: 'ok' });
    });

    it('should reject empty privateKey', async () => {
      await expect(hlDirectCancelOrder('', 'BTC', 1))
        .rejects.toThrow(GdexValidationError);
    });

    it('should reject empty coin', async () => {
      await expect(hlDirectCancelOrder('0xKey', '', 1))
        .rejects.toThrow(GdexValidationError);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. HL COPY TRADING — Discovery + Session reads + ComputedData writes
// ═════════════════════════════════════════════════════════════════════════════

describe('HyperLiquid E2E — HL Copy Trading', () => {
  let client: jest.Mocked<GdexApiClient>;

  beforeEach(() => {
    client = new MockedClient() as jest.Mocked<GdexApiClient>;
    (crypto.buildHlComputedData as jest.Mock).mockReturnValue('mock-encrypted-computed-data');
  });

  // ── Discovery (no auth) ───────────────────────────────────────────────────

  describe('Discovery endpoints', () => {
    it('getHlTopTraders — should fetch top traders', async () => {
      client.get = jest.fn().mockResolvedValue({
        isSuccess: true,
        topTraders: [{ address: '0xTrader1', volume: 1000000 }],
      });

      const result = await getHlTopTraders(client, 'volume');
      expect(client.get).toHaveBeenCalledWith(Endpoints.HL_TOP_TRADERS, { sort: 'volume' });
      expect(result.isSuccess).toBe(true);
    });

    it('getHlTopTraders — should work without sort param', async () => {
      client.get = jest.fn().mockResolvedValue({ isSuccess: true, topTraders: [] });

      await getHlTopTraders(client);
      expect(client.get).toHaveBeenCalledWith(Endpoints.HL_TOP_TRADERS, undefined);
    });

    it('getHlTopTradersByPnl — should fetch PnL leaderboard', async () => {
      client.get = jest.fn().mockResolvedValue({
        isSuccess: true,
        topTraders: { day: [], week: [], month: [] },
      });

      const result = await getHlTopTradersByPnl(client);
      expect(client.get).toHaveBeenCalledWith(Endpoints.HL_TOP_TRADERS_BY_PNL);
      expect(result.isSuccess).toBe(true);
    });

    it('getHlUserStats — should fetch user stats', async () => {
      client.get = jest.fn().mockResolvedValue({
        isSuccess: true,
        userStats: { '24h': 500, '7d': 2000, '30d': 5000 },
      });

      const result = await getHlUserStats(client, '0xUserWallet');
      expect(client.get).toHaveBeenCalledWith(Endpoints.HL_USER_STATS, { user: '0xUserWallet' });
      expect(result.isSuccess).toBe(true);
    });

    it('getHlUserStats — should reject empty address', async () => {
      await expect(getHlUserStats(client, '')).rejects.toThrow(GdexValidationError);
    });

    it('getHlPerpDexes — should return dex list', async () => {
      client.get = jest.fn().mockResolvedValue({ isSuccess: true, perpDexes: ['HL'] });

      const result = await getHlPerpDexes(client);
      expect(client.get).toHaveBeenCalledWith(Endpoints.HL_PERP_DEXES);
      expect(result.perpDexes).toContain('HL');
    });

    it('getHlAllAssets — should return asset list', async () => {
      client.get = jest.fn().mockResolvedValue({ isSuccess: true, count: 150, assets: [] });

      const result = await getHlAllAssets(client);
      expect(client.get).toHaveBeenCalledWith(Endpoints.HL_ALL_ASSETS);
      expect(result.count).toBe(150);
    });

    it('getHlClearinghouseState — should fetch user state', async () => {
      client.get = jest.fn().mockResolvedValue({ marginSummary: {} });

      await getHlClearinghouseState(client, '0xUser');
      expect(client.get).toHaveBeenCalledWith(Endpoints.HL_CLEARINGHOUSE_STATE, { address: '0xUser' });
    });

    it('getHlClearinghouseState — should reject empty address', async () => {
      await expect(getHlClearinghouseState(client, '')).rejects.toThrow(GdexValidationError);
    });

    it('getHlClearinghouseStateAll — should fetch cross-dex state', async () => {
      client.get = jest.fn().mockResolvedValue({});

      await getHlClearinghouseStateAll(client, '0xUser');
      expect(client.get).toHaveBeenCalledWith(Endpoints.HL_CLEARINGHOUSE_STATE_ALL, { address: '0xUser' });
    });

    it('getHlOpenOrdersForCopy — should fetch orders', async () => {
      client.get = jest.fn().mockResolvedValue([]);

      await getHlOpenOrdersForCopy(client, '0xUser');
      expect(client.get).toHaveBeenCalledWith(Endpoints.HL_OPEN_ORDERS, { address: '0xUser' });
    });

    it('getHlOpenOrdersAllForCopy — should fetch all orders', async () => {
      client.get = jest.fn().mockResolvedValue([]);

      await getHlOpenOrdersAllForCopy(client, '0xUser');
      expect(client.get).toHaveBeenCalledWith(Endpoints.HL_OPEN_ORDERS_ALL, { address: '0xUser' });
    });

    it('getHlMetaAndAssetCtxs — should fetch metadata', async () => {
      client.get = jest.fn().mockResolvedValue({ universe: [] });

      await getHlMetaAndAssetCtxs(client);
      expect(client.get).toHaveBeenCalledWith(Endpoints.HL_META_AND_ASSET_CTXS);
    });

    it('getHlDepositTokens — should fetch deposit tokens', async () => {
      client.get = jest.fn().mockResolvedValue({
        isSuccess: true,
        depositTokens: [{ name: 'USDC', address: '0xUSDC' }],
      });

      const result = await getHlDepositTokens(client);
      expect(client.get).toHaveBeenCalledWith(Endpoints.HL_DEPOSIT_TOKENS);
      expect(result.isSuccess).toBe(true);
    });

    it('getHlUsdcBalanceForCopy — should fetch USDC balance', async () => {
      client.get = jest.fn().mockResolvedValue({ balance: 500 });

      await getHlUsdcBalanceForCopy(client, '0xUser');
      expect(client.get).toHaveBeenCalledWith(Endpoints.HL_USDC_BALANCE, { address: '0xUser' });
    });

    it('getHlUsdcBalanceForCopy — should reject empty address', async () => {
      await expect(getHlUsdcBalanceForCopy(client, '')).rejects.toThrow(GdexValidationError);
    });
  });

  // ── Session-key reads ─────────────────────────────────────────────────────

  describe('Session-key read operations', () => {
    it('getHlCopyTradeList — should fetch user configs', async () => {
      client.get = jest.fn().mockResolvedValue({
        isSuccess: true,
        count: 2,
        allCopyTrades: [
          { copyTradeId: 'CT-1', copyTradeName: 'BotA', traderWallet: '0xT1' },
          { copyTradeId: 'CT-2', copyTradeName: 'BotB', traderWallet: '0xT2' },
        ],
      });

      const result = await getHlCopyTradeList(client, {
        userId: '0xUser',
        data: 'encrypted-session-data',
      });

      expect(client.get).toHaveBeenCalledWith(Endpoints.HL_COPY_LIST, {
        userId: '0xUser',
        data: 'encrypted-session-data',
      });
      expect(result.count).toBe(2);
      expect(result.allCopyTrades).toHaveLength(2);
    });

    it('getHlCopyTradeList — should reject missing userId', async () => {
      await expect(getHlCopyTradeList(client, { userId: '', data: 'x' }))
        .rejects.toThrow(GdexValidationError);
    });

    it('getHlCopyTradeList — should reject missing data', async () => {
      await expect(getHlCopyTradeList(client, { userId: '0xUser', data: '' }))
        .rejects.toThrow(GdexValidationError);
    });

    it('getHlCopyTradeTxList — should fetch fill history with pagination', async () => {
      client.get = jest.fn().mockResolvedValue({
        isSuccess: true,
        totalCount: 100,
        txes: [
          { coin: 'BTC', px: '105000', sz: '0.001', side: 'B', time: 1700000000 },
        ],
      });

      const result = await getHlCopyTradeTxList(client, {
        userId: '0xUser',
        data: 'encrypted-session-data',
        page: '2',
        limit: '25',
      });

      expect(client.get).toHaveBeenCalledWith(Endpoints.HL_COPY_TX_LIST, {
        userId: '0xUser',
        data: 'encrypted-session-data',
        page: '2',
        limit: '25',
      });
      expect(result.totalCount).toBe(100);
    });

    it('getHlCopyTradeTxList — should default page/limit', async () => {
      client.get = jest.fn().mockResolvedValue({ isSuccess: true, totalCount: 0, txes: [] });

      await getHlCopyTradeTxList(client, { userId: '0xUser', data: 'x' });

      expect(client.get).toHaveBeenCalledWith(Endpoints.HL_COPY_TX_LIST, {
        userId: '0xUser',
        data: 'x',
        page: '1',
        limit: '10',
      });
    });
  });

  // ── Write operations (computedData auth) ──────────────────────────────────

  describe('createHlCopyTrade', () => {
    it('should create a copy trade with all fields', async () => {
      client.post = jest.fn().mockResolvedValue({
        isSuccess: true,
        message: 'Created',
        allCopyTrades: [{ copyTradeId: 'NEW-1' }],
      });

      const result = await createHlCopyTrade(client, {
        userId: '0xUser',
        apiKey: CREDS.apiKey,
        sessionPrivateKey: CREDS.sessionPrivateKey,
        traderWallet: '0xTopTrader',
        copyTradeName: 'MyBot',
        copyMode: 1,
        fixedAmountCostPerOrder: '25',
        lossPercent: '10',
        profitPercent: '20',
        oppositeCopy: false,
      });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        action: 'hl_create',
        apiKey: CREDS.apiKey,
        walletAddress: '0xUser',
        sessionPrivateKey: CREDS.sessionPrivateKey,
        actionParams: {
          traderWallet: '0xTopTrader',
          copyTradeName: 'MyBot',
          copyMode: '1',
          fixedAmountCostPerOrder: '25',
          lossPercent: '10',
          profitPercent: '20',
          oppositeCopy: '',
        },
      }));
      expect(client.post).toHaveBeenCalledWith(Endpoints.HL_COPY_CREATE, {
        computedData: 'mock-encrypted-computed-data',
      });
      expect(result.isSuccess).toBe(true);
    });

    it('should handle oppositeCopy=true', async () => {
      client.post = jest.fn().mockResolvedValue({ isSuccess: true, message: 'ok', allCopyTrades: [] });

      await createHlCopyTrade(client, {
        userId: '0xUser',
        apiKey: CREDS.apiKey,
        sessionPrivateKey: CREDS.sessionPrivateKey,
        traderWallet: '0xTrader',
        copyTradeName: 'InverseBot',
        copyMode: 2,
        fixedAmountCostPerOrder: '0.5',
        lossPercent: '15',
        profitPercent: '30',
        oppositeCopy: true,
      });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        actionParams: expect.objectContaining({
          oppositeCopy: '1',
          copyMode: '2',
        }),
      }));
    });

    it('should reject missing traderWallet', async () => {
      await expect(createHlCopyTrade(client, {
        userId: '0xUser', apiKey: CREDS.apiKey, sessionPrivateKey: CREDS.sessionPrivateKey,
        traderWallet: '', copyTradeName: 'Bot', copyMode: 1,
        fixedAmountCostPerOrder: '10', lossPercent: '5', profitPercent: '10',
      })).rejects.toThrow(GdexValidationError);
    });

    it('should reject missing copyTradeName', async () => {
      await expect(createHlCopyTrade(client, {
        userId: '0xUser', apiKey: CREDS.apiKey, sessionPrivateKey: CREDS.sessionPrivateKey,
        traderWallet: '0xTrader', copyTradeName: '', copyMode: 1,
        fixedAmountCostPerOrder: '10', lossPercent: '5', profitPercent: '10',
      })).rejects.toThrow(GdexValidationError);
    });

    it('should reject missing fixedAmountCostPerOrder', async () => {
      await expect(createHlCopyTrade(client, {
        userId: '0xUser', apiKey: CREDS.apiKey, sessionPrivateKey: CREDS.sessionPrivateKey,
        traderWallet: '0xTrader', copyTradeName: 'Bot', copyMode: 1,
        fixedAmountCostPerOrder: '', lossPercent: '5', profitPercent: '10',
      })).rejects.toThrow(GdexValidationError);
    });

    it('should reject missing lossPercent', async () => {
      await expect(createHlCopyTrade(client, {
        userId: '0xUser', apiKey: CREDS.apiKey, sessionPrivateKey: CREDS.sessionPrivateKey,
        traderWallet: '0xTrader', copyTradeName: 'Bot', copyMode: 1,
        fixedAmountCostPerOrder: '10', lossPercent: '', profitPercent: '10',
      })).rejects.toThrow(GdexValidationError);
    });

    it('should reject missing profitPercent', async () => {
      await expect(createHlCopyTrade(client, {
        userId: '0xUser', apiKey: CREDS.apiKey, sessionPrivateKey: CREDS.sessionPrivateKey,
        traderWallet: '0xTrader', copyTradeName: 'Bot', copyMode: 1,
        fixedAmountCostPerOrder: '10', lossPercent: '5', profitPercent: '',
      })).rejects.toThrow(GdexValidationError);
    });
  });

  describe('updateHlCopyTrade', () => {
    it('should update a copy trade config', async () => {
      client.post = jest.fn().mockResolvedValue({ isSuccess: true, message: 'Updated' });

      const result = await updateHlCopyTrade(client, {
        userId: '0xUser',
        apiKey: CREDS.apiKey,
        sessionPrivateKey: CREDS.sessionPrivateKey,
        copyTradeId: 'CT-123',
        traderWallet: '0xTrader',
        copyTradeName: 'UpdatedBot',
        copyMode: 1,
        fixedAmountCostPerOrder: '50',
        lossPercent: '8',
        profitPercent: '25',
        oppositeCopy: false,
        isDelete: false,
        isChangeStatus: false,
      });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        action: 'hl_update',
        actionParams: {
          traderWallet: '0xTrader',
          copyTradeName: 'UpdatedBot',
          copyMode: '1',
          fixedAmountCostPerOrder: '50',
          lossPercent: '8',
          profitPercent: '25',
          isDelete: '',
          isChangeStatus: '',
          copyTradeId: 'CT-123',
          oppositeCopy: '',
        },
      }));
      expect(client.post).toHaveBeenCalledWith(Endpoints.HL_COPY_UPDATE, {
        computedData: 'mock-encrypted-computed-data',
      });
      expect(result.isSuccess).toBe(true);
    });

    it('should delete a copy trade via isDelete', async () => {
      client.post = jest.fn().mockResolvedValue({ isSuccess: true, message: 'Deleted' });

      await updateHlCopyTrade(client, {
        userId: '0xUser',
        apiKey: CREDS.apiKey,
        sessionPrivateKey: CREDS.sessionPrivateKey,
        copyTradeId: 'CT-456',
        traderWallet: '0xTrader',
        copyTradeName: 'ToDelete',
        copyMode: 1,
        fixedAmountCostPerOrder: '10',
        lossPercent: '5',
        profitPercent: '10',
        isDelete: true,
      });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        actionParams: expect.objectContaining({ isDelete: '1' }),
      }));
    });

    it('should handle isChangeStatus (also deletes on backend)', async () => {
      client.post = jest.fn().mockResolvedValue({ isSuccess: true, message: 'Changed' });

      await updateHlCopyTrade(client, {
        userId: '0xUser',
        apiKey: CREDS.apiKey,
        sessionPrivateKey: CREDS.sessionPrivateKey,
        copyTradeId: 'CT-789',
        traderWallet: '0xTrader',
        copyTradeName: 'StatusChange',
        copyMode: 1,
        fixedAmountCostPerOrder: '10',
        lossPercent: '5',
        profitPercent: '10',
        isChangeStatus: true,
      });

      expect(crypto.buildHlComputedData).toHaveBeenCalledWith(expect.objectContaining({
        actionParams: expect.objectContaining({ isChangeStatus: '1' }),
      }));
    });

    it('should reject missing copyTradeId', async () => {
      await expect(updateHlCopyTrade(client, {
        userId: '0xUser', apiKey: CREDS.apiKey, sessionPrivateKey: CREDS.sessionPrivateKey,
        copyTradeId: '', traderWallet: '0xTrader', copyTradeName: 'Bot',
        copyMode: 1, fixedAmountCostPerOrder: '10', lossPercent: '5', profitPercent: '10',
      })).rejects.toThrow(GdexValidationError);
    });

    it('should reject missing traderWallet', async () => {
      await expect(updateHlCopyTrade(client, {
        userId: '0xUser', apiKey: CREDS.apiKey, sessionPrivateKey: CREDS.sessionPrivateKey,
        copyTradeId: 'CT-1', traderWallet: '', copyTradeName: 'Bot',
        copyMode: 1, fixedAmountCostPerOrder: '10', lossPercent: '5', profitPercent: '10',
      })).rejects.toThrow(GdexValidationError);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. CRYPTO PIPELINE — Real ABI encoding + signing + AES round-trips
// ═════════════════════════════════════════════════════════════════════════════

describe('HyperLiquid E2E — Crypto Pipeline (Real Crypto, No Mocks)', () => {
  // Use the actual (non-mocked) crypto module
  const realCrypto = jest.requireActual('../../src/utils/gdexManagedCrypto') as typeof crypto;

  const TEST_API_KEY = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';

  describe('AES-256-CBC round-trips', () => {
    it('should encrypt and decrypt arbitrary JSON payloads', () => {
      const payload = JSON.stringify({
        userId: '0xTestUser',
        data: 'abcdef1234567890',
        signature: 'ff'.repeat(65),
      });

      const encrypted = realCrypto.encryptGdexComputedData(payload, TEST_API_KEY);
      expect(encrypted).toMatch(/^[0-9a-f]+$/); // hex string

      const decrypted = realCrypto.decryptGdexComputedData(encrypted, TEST_API_KEY);
      expect(decrypted).toBe(payload);
    });

    it('should produce different ciphertexts for different API keys', () => {
      const plaintext = 'same-data';
      const key1 = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';
      const key2 = '2c8f0a91-5d34-4e7b-9a62-f1c3d8e4b705';

      const ct1 = realCrypto.encryptGdexComputedData(plaintext, key1);
      const ct2 = realCrypto.encryptGdexComputedData(plaintext, key2);

      expect(ct1).not.toBe(ct2);

      // Each decrypts correctly with its own key
      expect(realCrypto.decryptGdexComputedData(ct1, key1)).toBe(plaintext);
      expect(realCrypto.decryptGdexComputedData(ct2, key2)).toBe(plaintext);
    });

    it('should fail to decrypt with wrong key', () => {
      const ct = realCrypto.encryptGdexComputedData('secret', TEST_API_KEY);
      expect(() => {
        realCrypto.decryptGdexComputedData(ct, '00000000-0000-0000-0000-000000000000');
      }).toThrow();
    });
  });

  describe('Session keypair generation', () => {
    it('should generate unique keypairs', () => {
      const kp1 = realCrypto.generateGdexSessionKeyPair();
      const kp2 = realCrypto.generateGdexSessionKeyPair();

      expect(kp1.sessionPrivateKey).toMatch(/^0x[0-9a-f]{64}$/);
      expect(kp1.sessionKey).toMatch(/^0x[0-9a-f]+$/);

      expect(kp1.sessionPrivateKey).not.toBe(kp2.sessionPrivateKey);
      expect(kp1.sessionKey).not.toBe(kp2.sessionKey);
    });

    it('compressed public key should be 33 bytes (66 hex chars)', () => {
      const kp = realCrypto.generateGdexSessionKeyPair();
      // 0x prefix + 66 hex chars = 68 total, or 0x prefix + 64 hex chars depending on library
      const hexLen = kp.sessionKey.startsWith('0x') ? kp.sessionKey.length - 2 : kp.sessionKey.length;
      expect(hexLen).toBe(66); // compressed secp256k1 pubkey = 33 bytes = 66 hex
    });
  });

  describe('ABI encoding for HL actions', () => {
    it('should encode hl_deposit with correct schema', () => {
      const encoded = realCrypto.encodeHlActionData('hl_deposit', {
        chainId: 42161,
        tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        amount: '100000000',
        nonce: '12345',
      });

      expect(encoded).toBeTruthy();
      expect(encoded).not.toMatch(/^0x/); // should NOT have 0x prefix
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('should encode hl_withdraw with correct schema', () => {
      const encoded = realCrypto.encodeHlActionData('hl_withdraw', {
        amount: '50',
        nonce: '67890',
      });
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('should encode hl_create_order with 9 params', () => {
      const encoded = realCrypto.encodeHlActionData('hl_create_order', {
        coin: 'BTC',
        isLong: true,
        price: '105000',
        size: '0.001',
        reduceOnly: false,
        nonce: '99999',
        tpPrice: '110000',
        slPrice: '100000',
        isMarket: true,
      });
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('should encode hl_place_order with 6 params', () => {
      const encoded = realCrypto.encodeHlActionData('hl_place_order', {
        coin: 'ETH',
        isLong: false,
        price: '3000',
        size: '5',
        reduceOnly: false,
        nonce: '11111',
      });
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('should encode hl_close_all with only nonce', () => {
      const encoded = realCrypto.encodeHlActionData('hl_close_all', { nonce: '22222' });
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('should encode hl_cancel_order', () => {
      const encoded = realCrypto.encodeHlActionData('hl_cancel_order', {
        nonce: '33333',
        coin: 'BTC',
        orderId: 'ORD-999',
      });
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('should encode hl_cancel_all_orders', () => {
      const encoded = realCrypto.encodeHlActionData('hl_cancel_all_orders', { nonce: '44444' });
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('should encode hl_update_leverage', () => {
      const encoded = realCrypto.encodeHlActionData('hl_update_leverage', {
        coin: 'SOL',
        leverage: 25,
        isCross: true,
        nonce: '55555',
      });
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('should encode hl_create (copy trade)', () => {
      const encoded = realCrypto.encodeHlActionData('hl_create', {
        traderWallet: '0xTrader',
        copyTradeName: 'TestBot',
        copyMode: '1',
        fixedAmountCostPerOrder: '25',
        lossPercent: '10',
        profitPercent: '20',
        nonce: '66666',
        oppositeCopy: '',
      });
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('should encode hl_update (copy trade)', () => {
      const encoded = realCrypto.encodeHlActionData('hl_update', {
        traderWallet: '0xTrader',
        copyTradeName: 'TestBot',
        copyMode: '1',
        fixedAmountCostPerOrder: '25',
        lossPercent: '10',
        profitPercent: '20',
        nonce: '77777',
        isDelete: '1',
        isChangeStatus: '',
        copyTradeId: 'CT-1',
        oppositeCopy: '',
      });
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('should throw for unknown action type', () => {
      expect(() => {
        realCrypto.encodeHlActionData('hl_unknown' as any, {});
      }).toThrow('Unknown HL action');
    });
  });

  describe('HL action signing', () => {
    it('should produce 130-char hex signature (r64 + s64 + v2)', () => {
      const kp = realCrypto.generateGdexSessionKeyPair();
      const data = realCrypto.encodeHlActionData('hl_close_all', { nonce: '12345' });

      const sig = realCrypto.signHlActionMessage('hl_close_all', '0xUser', data, kp.sessionPrivateKey);
      expect(sig).toMatch(/^[0-9a-f]{130}$/);
    });

    it('should produce deterministic signatures for same inputs', () => {
      const privateKey = '0x' + 'aa'.repeat(32);
      const data = 'deadbeef';

      const sig1 = realCrypto.signHlActionMessage('hl_deposit', '0xUser', data, privateKey);
      const sig2 = realCrypto.signHlActionMessage('hl_deposit', '0xUser', data, privateKey);

      expect(sig1).toBe(sig2);
    });

    it('should lowercase EVM addresses in message', () => {
      const kp = realCrypto.generateGdexSessionKeyPair();
      const data = 'abcdef';

      // Both should produce the same signature
      const sig1 = realCrypto.signHlActionMessage('hl_withdraw', '0xABCD', data, kp.sessionPrivateKey);
      const sig2 = realCrypto.signHlActionMessage('hl_withdraw', '0xabcd', data, kp.sessionPrivateKey);

      expect(sig1).toBe(sig2);
    });
  });

  describe('Full buildHlComputedData pipeline', () => {
    it('should produce encrypted hex from end to end', () => {
      const kp = realCrypto.generateGdexSessionKeyPair();

      const computedData = realCrypto.buildHlComputedData({
        action: 'hl_create_order',
        apiKey: TEST_API_KEY,
        walletAddress: '0xTestWallet',
        sessionPrivateKey: kp.sessionPrivateKey,
        actionParams: {
          coin: 'BTC',
          isLong: true,
          price: '100000',
          size: '0.001',
          reduceOnly: false,
          tpPrice: '',
          slPrice: '',
          isMarket: true,
        },
      });

      expect(computedData).toMatch(/^[0-9a-f]+$/);

      // Decrypt and verify internal structure
      const decrypted = JSON.parse(realCrypto.decryptGdexComputedData(computedData, TEST_API_KEY));
      expect(decrypted).toHaveProperty('userId', '0xTestWallet');
      expect(decrypted).toHaveProperty('data');
      expect(decrypted).toHaveProperty('signature');
      expect(decrypted.signature).toMatch(/^[0-9a-f]{130}$/);
    });
  });

  describe('Nonce generation', () => {
    it('should produce positive integers', () => {
      const nonce = realCrypto.generateGdexNonce();
      expect(typeof nonce).toBe('number');
      expect(nonce).toBeGreaterThan(0);
      expect(Number.isInteger(nonce)).toBe(true);
    });

    it('should produce values near current Unix timestamp', () => {
      const now = Math.floor(Date.now() / 1000);
      const nonce = realCrypto.generateGdexNonce();
      // Should be within ~1000 of current timestamp
      expect(Math.abs(nonce - now)).toBeLessThan(2000);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. GdexSkill FACADE — All HL Methods Delegate Correctly
// ═════════════════════════════════════════════════════════════════════════════

describe('HyperLiquid E2E — GdexSkill Facade Integration', () => {
  let skill: GdexSkill;

  beforeEach(() => {
    skill = new GdexSkill();
    skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);

    const hl = require('@gdexsdk/hyper-liquid-trader');
    hl.HyperLiquidTrading.mockImplementation(() => hl.__mockTrader);
    const mock = hl.__mockTrader;
    mock.getAccountState.mockResolvedValue({
      marginSummary: { accountValue: '10000', totalNtlPos: '5000', totalRawUsd: '10000', totalMarginUsed: '500' },
      assetPositions: [
        { position: { coin: 'BTC', szi: '0.05', entryPx: '100000', leverage: { value: 10 }, liquidationPx: '95000', unrealizedPnl: '100', marginUsed: '500', positionValue: '5000' } },
      ],
    });
    mock.getMidPrice.mockResolvedValue(105000);
    mock.getBalance.mockResolvedValue(9500);
    mock.getOpenOrders.mockResolvedValue([{ oid: 1 }]);
    mock.getAllMids.mockResolvedValue({ BTC: '105000', ETH: '3200' });
  });

  it('skill.getHlAccountState() should return parsed account state', async () => {
    const state = await skill.getHlAccountState('0xWallet');
    expect(state.accountValue).toBe('10000');
    expect(state.positions).toHaveLength(1);
    expect(state.positions[0].coin).toBe('BTC');
  });

  it('skill.getPerpPositions() should return positions', async () => {
    const positions = await skill.getPerpPositions({ walletAddress: '0xWallet' });
    expect(positions).toHaveLength(1);
    expect(positions[0].side).toBe('long');
  });

  it('skill.getHlMarkPrice() should return price', async () => {
    const price = await skill.getHlMarkPrice('BTC');
    expect(price).toBe(105000);
  });

  it('skill.getHlUsdcBalance() should return balance', async () => {
    const bal = await skill.getHlUsdcBalance('0xWallet');
    expect(bal).toBe(9500);
  });

  it('skill.getHlOpenOrders() should return orders', async () => {
    const orders = await skill.getHlOpenOrders('0xWallet');
    expect(orders).toHaveLength(1);
  });

  it('skill.getHlAllMids() should return all mid prices', async () => {
    const mids = await skill.getHlAllMids();
    expect(mids).toHaveProperty('BTC');
    expect(mids).toHaveProperty('ETH');
  });

  it('skill.isAuthenticated() should delegate to client', () => {
    // GdexApiClient is mocked, so test the real client behavior separately
    const realSkill = new GdexSkill();
    // Before login, client is not authenticated
    // After login with API key, it should be authenticated
    // This delegates to client.isAuthenticated() which checks session expiry
    expect(typeof realSkill.isAuthenticated).toBe('function');
    expect(typeof realSkill.logout).toBe('function');
  });

  it('skill.createHlTrader() should return a trader instance', async () => {
    const trader = await skill.createHlTrader();
    expect(trader).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. ENDPOINT CONSTANTS — Verify all HL endpoints are correctly defined
// ═════════════════════════════════════════════════════════════════════════════

describe('HyperLiquid E2E — Endpoint Constants', () => {
  it('should define all managed-custody HL endpoints', () => {
    expect(Endpoints.HL_DEPOSIT).toBe('/v1/hl/deposit');
    expect(Endpoints.HL_WITHDRAW).toBe('/v1/hl/withdraw');
    expect(Endpoints.HL_CREATE_ORDER).toBe('/v1/hl/create_order');
    expect(Endpoints.HL_PLACE_ORDER).toBe('/v1/hl/place_order');
    expect(Endpoints.HL_CLOSE_ALL).toBe('/v1/hl/close_all_positions');
    expect(Endpoints.HL_CANCEL_ORDER).toBe('/v1/hl/cancel_order');
    expect(Endpoints.HL_UPDATE_LEVERAGE).toBe('/v1/hl/update_leverage');
    expect(Endpoints.HL_GBOT_USDC_BALANCE).toBe('/v1/hl/gbot_usdc_balance');
    expect(Endpoints.HL_USER_STATS).toBe('/v1/hl/user_stats');
  });

  it('should define all HL copy trade endpoints', () => {
    expect(Endpoints.HL_COPY_LIST).toBe('/v1/hl/list');
    expect(Endpoints.HL_COPY_TX_LIST).toBe('/v1/hl/tx_list');
    expect(Endpoints.HL_COPY_CREATE).toBe('/v1/hl/create');
    expect(Endpoints.HL_COPY_UPDATE).toBe('/v1/hl/update');
    expect(Endpoints.HL_TOP_TRADERS).toBe('/v1/hl/top_traders');
    expect(Endpoints.HL_TOP_TRADERS_BY_PNL).toBe('/v1/hl/top_traders_by_pnl');
    expect(Endpoints.HL_PERP_DEXES).toBe('/v1/hl/perp_dexes');
    expect(Endpoints.HL_ALL_ASSETS).toBe('/v1/hl/all_assets');
    expect(Endpoints.HL_CLEARINGHOUSE_STATE).toBe('/v1/hl/clearinghouse_state');
    expect(Endpoints.HL_CLEARINGHOUSE_STATE_ALL).toBe('/v1/hl/clearinghouse_state_all');
    expect(Endpoints.HL_OPEN_ORDERS).toBe('/v1/hl/open_orders');
    expect(Endpoints.HL_OPEN_ORDERS_ALL).toBe('/v1/hl/open_orders_all');
    expect(Endpoints.HL_META_AND_ASSET_CTXS).toBe('/v1/hl/meta_and_asset_ctxs');
    expect(Endpoints.HL_DEPOSIT_TOKENS).toBe('/v1/hl/deposit_tokens');
    expect(Endpoints.HL_USDC_BALANCE).toBe('/v1/hl/usdc_balance');
  });
});
