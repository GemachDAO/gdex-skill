/**
 * Strict numeric input validation on signed and authenticated paths.
 *
 * Every malformed or over-precise input must be rejected before any network
 * call or signing (the client mock is never called), and valid inputs must be
 * encoded exactly as the backend decodes them
 * (gbotTradingDashboardBackend src/shared/parser/evm/decoder.ts).
 */
import { AbiCoder } from 'ethers';
import { GdexApiClient } from '../../src/client';
import { estimateBridge, requestBridge } from '../../src/actions/bridge';
import { limitBuy, limitSell, updateOrder, cancelLimitOrder } from '../../src/actions/limitOrders';
import { hlCreateOrder, hlPlaceOrder, hlExecuteCrossPerp, closePerpPosition } from '../../src/actions/perpTrade';
import { getWalletInfo } from '../../src/actions/wallet';
import { createCopyTrade, updateCopyTrade } from '../../src/actions/copyTrade';
import { createHlCopyTrade } from '../../src/actions/hlCopyTrade';
import { hlSwapCollateral } from '../../src/actions/hlExtras';
import { GdexValidationError } from '../../src/utils/errors';
import { decryptGdexComputedData, generateGdexSessionKeyPair } from '../../src/utils/gdexManagedCrypto';
import { validateHlPrice, validateHlSize, parseRawAmount, parseIntegerPercent } from '../../src/utils/validation';

jest.mock('../../src/client');
const MockedClient = GdexApiClient as jest.MockedClass<typeof GdexApiClient>;

const apiKey = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';
const { sessionPrivateKey } = generateGdexSessionKeyPair();
const userId = '0x1234567890123456789012345678901234567890';
const abi = AbiCoder.defaultAbiCoder();

/** Decrypt a posted computedData and ABI-decode its `data` with the backend's types. */
function decodePosted(client: jest.Mocked<GdexApiClient>, types: string[]): unknown[] {
  const body = (client.post as jest.Mock).mock.calls[0][1] as { computedData: string };
  const parsed = JSON.parse(decryptGdexComputedData(body.computedData, apiKey)) as { data: string };
  return abi.decode(types, '0x' + parsed.data).toArray();
}

const BAD_RAW = ['1.5', '1e18', '0', '-1', '100abc', ' 100', '0x10', '', 'Infinity'];
const BAD_DECIMAL = ['1e3', '-1', '0', '1.2.3', '1abc', ' 1', 'Infinity', 'NaN', '.5', '5.'];

function getMockTrader() {
  return require('@gdexsdk/hyper-liquid-trader').__mockTrader;
}

describe('strict numeric inputs', () => {
  let client: jest.Mocked<GdexApiClient>;

  beforeEach(() => {
    client = new MockedClient() as jest.Mocked<GdexApiClient>;
    client.post = jest.fn().mockResolvedValue({ isSuccess: true });
    client.get = jest.fn().mockResolvedValue({});
    const hl = require('@gdexsdk/hyper-liquid-trader');
    hl.HyperLiquidTrading.mockImplementation(() => hl.__mockTrader);
    hl.__mockTrader.getMidPrice.mockResolvedValue(0);
    hl.__mockTrader.executeCrossPerp.mockResolvedValue({ status: 'ok' });
  });

  // ── helpers ────────────────────────────────────────────────────────────────

  describe('validation helpers', () => {
    it('parseRawAmount accepts positive integers only', () => {
      expect(parseRawAmount('1000000')).toBe(1000000n);
      for (const v of BAD_RAW) expect(() => parseRawAmount(v)).toThrow(GdexValidationError);
    });

    it('parseIntegerPercent enforces whole numbers and range', () => {
      expect(parseIntegerPercent('25', 'p')).toBe('25');
      expect(parseIntegerPercent('007', 'p')).toBe('7');
      expect(() => parseIntegerPercent('2.5', 'p')).toThrow(GdexValidationError);
      expect(() => parseIntegerPercent('100', 'p', { max: 100, maxExclusive: true })).toThrow(/below 100/);
    });

    it('validateHlPrice applies 5 significant figures and 6 - szDecimals decimals', () => {
      expect(() => validateHlPrice('65432.1')).not.toThrow(); // format only without szDecimals
      expect(() => validateHlPrice('65432.1', 'price', 5)).toThrow(/significant figures/);
      expect(() => validateHlPrice('1.25', 'price', 5)).toThrow(/at most 1/); // 6 - 5 decimals
      expect(() => validateHlPrice('1234.56', 'price', 2)).toThrow(/significant figures/);
      expect(() => validateHlPrice('1234.5', 'price', 2)).not.toThrow();
      expect(() => validateHlPrice('123456', 'price', 2)).not.toThrow(); // integers always allowed
      expect(() => validateHlPrice('0.0001234', 'price', 0)).toThrow(/at most 6/);
      expect(() => validateHlPrice('0.001234', 'price', 0)).not.toThrow();
      expect(() => validateHlPrice('0.00001234', 'price', 0, 'spot')).not.toThrow();
      expect(() => validateHlPrice('100.50', 'price', 4)).not.toThrow(); // trailing zero is not a decimal
      for (const v of BAD_DECIMAL) expect(() => validateHlPrice(v)).toThrow(GdexValidationError);
    });

    it('validateHlSize enforces szDecimals', () => {
      expect(() => validateHlSize('0.001', 'size', 3)).not.toThrow();
      expect(() => validateHlSize('0.0010', 'size', 3)).not.toThrow();
      expect(() => validateHlSize('0.0001', 'size', 3)).toThrow(/3 decimals/);
      expect(() => validateHlSize('1', 'size', 9)).toThrow(/szDecimals/);
    });
  });

  // ── bridge ─────────────────────────────────────────────────────────────────

  describe('bridge', () => {
    const base = { fromChainId: 8453, toChainId: 622112261, userId, sessionPrivateKey, apiKey };

    it.each(BAD_RAW)('rejects amount %j before quoting or signing', async (amount) => {
      await expect(estimateBridge(client, { ...base, amount })).rejects.toBeInstanceOf(GdexValidationError);
      await expect(requestBridge(client, { ...base, amount })).rejects.toBeInstanceOf(GdexValidationError);
      expect(client.get).not.toHaveBeenCalled();
      expect(client.post).not.toHaveBeenCalled();
    });

    it('rejects same or non-integer chains', async () => {
      await expect(requestBridge(client, { ...base, toChainId: 8453, amount: '1' })).rejects.toBeInstanceOf(GdexValidationError);
      await expect(requestBridge(client, { ...base, fromChainId: 1.5, amount: '1' })).rejects.toBeInstanceOf(GdexValidationError);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('encodes the raw amount exactly as [string, uint64, uint64, string]', async () => {
      await requestBridge(client, { ...base, amount: '250000000000000000' });
      const [amount, from, to] = decodePosted(client, ['string', 'uint64', 'uint64', 'string']);
      expect(amount).toBe('250000000000000000');
      expect(from).toBe(8453n);
      expect(to).toBe(622112261n);
    });

    it('sends the canonical raw amount on estimate', async () => {
      await estimateBridge(client, { fromChainId: 1, toChainId: 56, amount: '0010' });
      expect(client.get).toHaveBeenCalledWith('/v1/bridge/estimate_bridge', { fromChainId: 1, toChainId: 56, amount: '10' });
    });
  });

  // ── limit orders ───────────────────────────────────────────────────────────

  describe('limit orders', () => {
    const creds = { apiKey, userId, sessionPrivateKey, chainId: 8453 };
    const token = '0x' + 'b'.repeat(40);

    it.each(BAD_RAW)('limitBuy / limitSell reject amount %j before signing', async (amount) => {
      await expect(limitBuy(client, { ...creds, tokenAddress: token, amount, triggerPrice: '1' })).rejects.toBeInstanceOf(GdexValidationError);
      await expect(limitSell(client, { ...creds, tokenAddress: token, amount, triggerPrice: '1' })).rejects.toBeInstanceOf(GdexValidationError);
      expect(client.post).not.toHaveBeenCalled();
    });

    it.each(BAD_DECIMAL)('rejects triggerPrice %j', async (triggerPrice) => {
      await expect(limitBuy(client, { ...creds, tokenAddress: token, amount: '1', triggerPrice })).rejects.toBeInstanceOf(GdexValidationError);
      expect(client.post).not.toHaveBeenCalled();
    });

    it.each([['profitPercent', '2.5'], ['profitPercent', '-1'], ['lossPercent', '100'], ['lossPercent', '1e1']])(
      'limitBuy rejects %s %j',
      async (field, value) => {
        await expect(
          limitBuy(client, { ...creds, tokenAddress: token, amount: '1', triggerPrice: '1', [field]: value }),
        ).rejects.toBeInstanceOf(GdexValidationError);
        expect(client.post).not.toHaveBeenCalled();
      },
    );

    it('limitBuy encodes [string, string, string, uint64, uint64, string] exactly', async () => {
      await limitBuy(client, { ...creds, tokenAddress: token, amount: '1000000000000000', triggerPrice: '0.00042', profitPercent: '50', lossPercent: '25' });
      const v = decodePosted(client, ['string', 'string', 'string', 'uint64', 'uint64', 'string']);
      expect(v.slice(0, 5)).toEqual([token, '1000000000000000', '0.00042', 50n, 25n]);
    });

    it('updateOrder requires the full new order state instead of defaulting to 0', async () => {
      for (const omit of ['amount', 'triggerPrice', 'profitPercent', 'lossPercent']) {
        const full: Record<string, string> = { amount: '5', triggerPrice: '2', profitPercent: '0', lossPercent: '0' };
        delete full[omit];
        await expect(updateOrder(client, { ...creds, orderId: 'o1', ...full })).rejects.toThrow(new RegExp(omit));
      }
      expect(client.post).not.toHaveBeenCalled();
    });

    it('updateOrder rejects a malformed amount', async () => {
      await expect(
        updateOrder(client, { ...creds, orderId: 'o1', amount: '1.5', triggerPrice: '2', profitPercent: '0', lossPercent: '0' }),
      ).rejects.toBeInstanceOf(GdexValidationError);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('updateOrder encodes isDelete as a real bool, so an update is not read as a delete', async () => {
      await updateOrder(client, { ...creds, orderId: 'o1', amount: '5', triggerPrice: '2.5', profitPercent: '10', lossPercent: '5' });
      const v = decodePosted(client, ['string', 'string', 'string', 'uint64', 'uint64', 'string', 'bool']);
      expect(v.slice(0, 5)).toEqual(['o1', '5', '2.5', 10n, 5n]);
      expect(v[6]).toBe(false);
    });

    it('cancelLimitOrder encodes isDelete=true and needs no order fields', async () => {
      await cancelLimitOrder(client, { ...creds, orderId: 'o2' });
      const v = decodePosted(client, ['string', 'string', 'string', 'uint64', 'uint64', 'string', 'bool']);
      expect(v[0]).toBe('o2');
      expect(v[6]).toBe(true);
    });
  });

  // ── perps ──────────────────────────────────────────────────────────────────

  describe('perp orders', () => {
    const creds = { apiKey, walletAddress: userId, sessionPrivateKey };

    it.each(BAD_DECIMAL.filter((v) => v !== '0'))('hlCreateOrder rejects price %j before any fetch or signing', async (price) => {
      await expect(hlCreateOrder(client, { ...creds, coin: 'BTC', isLong: true, price, size: '0.01', isMarket: false })).rejects.toBeInstanceOf(GdexValidationError);
      expect(getMockTrader().getMidPrice).not.toHaveBeenCalled();
      expect(client.post).not.toHaveBeenCalled();
    });

    it('rejects a zero limit price but accepts the market-order 0 placeholder', async () => {
      await expect(hlCreateOrder(client, { ...creds, coin: 'BTC', isLong: true, price: '0', size: '0.01', isMarket: false })).rejects.toBeInstanceOf(GdexValidationError);
      getMockTrader().getMidPrice.mockResolvedValue(100000);
      await hlCreateOrder(client, { ...creds, coin: 'BTC', isLong: true, price: '0', size: '0.01', isMarket: true });
      expect(decodePosted(client, ['string', 'bool', 'string', 'string', 'bool', 'string', 'string', 'string', 'bool'])[2]).toBe('100000');
    });

    it('refuses to send a market order when no mark price is available', async () => {
      await expect(hlCreateOrder(client, { ...creds, coin: 'BTC', isLong: true, price: '0', size: '0.01' })).rejects.toThrow(/mark price/);
      expect(client.post).not.toHaveBeenCalled();
    });

    it.each(BAD_DECIMAL)('hlCreateOrder / hlPlaceOrder reject size %j', async (size) => {
      await expect(hlCreateOrder(client, { ...creds, coin: 'BTC', isLong: true, price: '100', size })).rejects.toBeInstanceOf(GdexValidationError);
      await expect(hlPlaceOrder(client, { ...creds, coin: 'BTC', isLong: true, price: '100', size, reduceOnly: true })).rejects.toBeInstanceOf(GdexValidationError);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('tp/sl: "" means none; anything else must be a positive decimal, and both are set together', async () => {
      const o = { ...creds, coin: 'ETH', isLong: true, price: '3000', size: '1', isMarket: false };
      await expect(hlCreateOrder(client, { ...o, tpPrice: '0', slPrice: '2900' })).rejects.toThrow(/tpPrice/);
      await expect(hlCreateOrder(client, { ...o, tpPrice: '3,100', slPrice: '2900' })).rejects.toThrow(/tpPrice/);
      await expect(hlCreateOrder(client, { ...o, tpPrice: '3100', slPrice: '-1' })).rejects.toThrow(/slPrice/);
      await expect(hlCreateOrder(client, { ...o, tpPrice: '3100' })).rejects.toThrow(/set together/);
      await expect(hlCreateOrder(client, { ...o, tpPrice: '', slPrice: '2900' })).rejects.toThrow(/set together/);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('applies Hyperliquid precision when szDecimals is given', async () => {
      const o = { ...creds, coin: 'BTC', isLong: true, isMarket: false, szDecimals: 5 };
      await expect(hlCreateOrder(client, { ...o, price: '65000', size: '0.000001' })).rejects.toThrow(/szDecimals/);
      await expect(hlCreateOrder(client, { ...o, price: '6500.25', size: '0.001' })).rejects.toThrow(/at most 1/);
      await expect(hlCreateOrder(client, { ...o, price: '65000', size: '0.001', tpPrice: '70000.25', slPrice: '60000' })).rejects.toThrow(/tpPrice/);
      await expect(hlPlaceOrder(client, { ...o, price: '65432.1', size: '0.001', reduceOnly: true })).rejects.toThrow(/significant figures/);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('encodes a valid limit order with TP/SL exactly', async () => {
      await hlCreateOrder(client, { ...creds, coin: 'eth', isLong: false, price: '3000.5', size: '0.25', isMarket: false, tpPrice: '2800', slPrice: '3100.5', szDecimals: 4 });
      const v = decodePosted(client, ['string', 'bool', 'string', 'string', 'bool', 'string', 'string', 'string', 'bool']);
      expect([v[0], v[1], v[2], v[3], v[4], v[6], v[7], v[8]]).toEqual(['ETH', false, '3000.5', '0.25', false, '2800', '3100.5', false]);
    });

    it('closePerpPosition rejects a malformed price before reading the position', async () => {
      await expect(closePerpPosition(client, { ...creds, coin: 'BTC', price: '1e5' })).rejects.toBeInstanceOf(GdexValidationError);
      expect(client.get).not.toHaveBeenCalled();
      expect(client.post).not.toHaveBeenCalled();
    });

    it('direct execution validates price, size and TP/SL legs before calling Hyperliquid', async () => {
      const trader = getMockTrader();
      trader.executeCrossPerp.mockClear();
      await expect(hlExecuteCrossPerp('0xkey', { coin: 'BTC', isLong: true, price: '1e5', positionSize: '1' })).rejects.toBeInstanceOf(GdexValidationError);
      await expect(hlExecuteCrossPerp('0xkey', { coin: 'BTC', isLong: true, price: '100', positionSize: '0' })).rejects.toBeInstanceOf(GdexValidationError);
      await expect(
        hlExecuteCrossPerp('0xkey', { coin: 'BTC', isLong: true, price: '100', positionSize: '1', takeProfit: { price: '110', triggerPrice: 'x' } }),
      ).rejects.toBeInstanceOf(GdexValidationError);
      expect(trader.executeCrossPerp).not.toHaveBeenCalled();
    });
  });

  // ── wallet info ────────────────────────────────────────────────────────────

  describe('getWalletInfo', () => {
    it('refuses an address-only read: the backend has no public balance route', async () => {
      await expect(getWalletInfo(client, { walletAddress: userId, chain: 'base' as never })).rejects.toThrow(/session/);
      expect(client.get).not.toHaveBeenCalled();
    });

    it('reads /v1/user and /v1/portfolio with userId, data and the normalized chainId', async () => {
      client.get = jest.fn().mockImplementation(async (path: string) =>
        path === '/v1/user'
          ? { address: '0xManaged', balance: 0.5 }
          : { holding: [{ amount: '1500000', tokenInfo: { address: '0xT', decimals: 6, symbol: 'USDC', priceUsd: '1' } }] },
      );
      const info = await getWalletInfo(client, { walletAddress: userId, data: 'enc', chain: 'Base' as never });
      expect(client.get).toHaveBeenCalledWith('/v1/user', { userId, data: 'enc', chainId: 8453 });
      expect(client.get).toHaveBeenCalledWith('/v1/portfolio', { userId, data: 'enc', chainId: 8453 });
      expect(info).toEqual({
        address: '0xManaged',
        userId,
        chain: 8453,
        chainId: 8453,
        nativeBalance: '0.5',
        nativeSymbol: 'ETH',
        precision: 'approximate',
        tokenCount: 1,
        totalValueUsd: '1.5',
      });
    });
  });

  // ── other signed amounts ───────────────────────────────────────────────────

  describe('copy trades and HL swaps', () => {
    const sol = { apiKey, userId, sessionPrivateKey, chainId: 622112261, traderWallet: 'T', copyTradeName: 'n' };

    it('createCopyTrade checks copyBuyAmount per buyMode and the TP/SL ranges', async () => {
      const ok = { ...sol, buyMode: 1 as const, copyBuyAmount: '0.5', lossPercent: '30', profitPercent: '50' };
      for (const bad of [
        { copyBuyAmount: '0.0000000001' }, // > 9 SOL decimals
        { copyBuyAmount: '1e-3' },
        { buyMode: 2 as const, copyBuyAmount: '150' },
        { lossPercent: '100' },
        { profitPercent: '0' },
      ]) {
        await expect(createCopyTrade(client, { ...ok, ...bad })).rejects.toBeInstanceOf(GdexValidationError);
      }
      expect(client.post).not.toHaveBeenCalled();
    });

    it('updateCopyTrade does not re-judge stored values on delete', async () => {
      await updateCopyTrade(client, { ...sol, copyTradeId: 'c', buyMode: 1, copyBuyAmount: '0', lossPercent: '30', profitPercent: '50', isDelete: true });
      expect(client.post).toHaveBeenCalledTimes(1);
    });

    it('createHlCopyTrade needs a raw USDC integer in copyMode 1', async () => {
      const ok = { apiKey, userId, sessionPrivateKey, traderWallet: '0xT', copyTradeName: 'n', copyMode: 1 as const, fixedAmountCostPerOrder: '50000000', lossPercent: '20', profitPercent: '40' };
      await expect(createHlCopyTrade(client, { ...ok, fixedAmountCostPerOrder: '50.5' })).rejects.toThrow(/raw base units/);
      await expect(createHlCopyTrade(client, { ...ok, lossPercent: '0' })).rejects.toBeInstanceOf(GdexValidationError);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('hlSwapCollateral rejects a malformed amount', async () => {
      await expect(
        hlSwapCollateral(client, { apiKey, walletAddress: userId, sessionPrivateKey, fromToken: 'USDC', toToken: 'USDH', amount: '1e3' }),
      ).rejects.toBeInstanceOf(GdexValidationError);
      expect(client.post).not.toHaveBeenCalled();
    });
  });
});
