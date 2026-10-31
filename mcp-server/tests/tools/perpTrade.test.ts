/**
 * E2E tests for perp trade tools (perpTrade.ts)
 * Tools: open_perp_position, place_perp_order, close_perp_position, close_all_positions,
 *        cancel_perp_order, cancel_all_perp_orders, set_leverage, perp_deposit, perp_withdraw
 */
import { jest, describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import { createMockSdk, createMockServer, expectMcpSuccess, expectMcpError } from '../helpers.js';

const mockSdk = createMockSdk();
jest.unstable_mockModule('../../src/sdk.js', () => ({
  getSdk: () => mockSdk,
  handleToolCall: jest.fn(async (fn: () => Promise<any>) => {
    try {
      const result = await fn();
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return { content: [{ type: 'text' as const, text }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text: `❌ Error: ${message}` }] };
    }
  }),
}));

const { registerPerpTradeTools } = await import('../../src/tools/perpTrade.js');
// The real SDK close logic, driven through a stub client, so these tests
// cover side/size resolution end to end (down to the encrypted order).
const { closePerpPosition, decryptGdexComputedData } = await import('@gemachdao/gdex-skill');
const { AbiCoder } = await import('ethers');

const hlCreds = {
  apiKey: 'test-api-key',
  walletAddress: '0xWallet',
  sessionPrivateKey: '0xSessionKey',
};

const closeCreds = {
  apiKey: 'test-api-key-00000000',
  walletAddress: '0x1234567890123456789012345678901234567890',
  sessionPrivateKey: '0x' + 'a'.repeat(64),
};

/** Stub GdexApiClient: clearinghouse reads per dex, captured create_order posts. */
function makeHlClient(byDex: Record<string, Array<{ coin: string; szi: string }>>) {
  const toAssetPositions = (list: Array<{ coin: string; szi: string }>) =>
    list.map((position) => ({ type: 'oneWay', position }));
  return {
    get: jest.fn(async (path: string, query: any) => {
      if (path === '/v1/hl/clearinghouse_state') {
        const dex = query?.dex ?? '';
        return { isSuccess: true, state: { assetPositions: toAssetPositions(byDex[dex] ?? []) } };
      }
      if (path === '/v1/hl/clearinghouse_state_all') {
        return {
          isSuccess: true,
          allPositions: Object.entries(byDex).flatMap(([dex, list]) =>
            toAssetPositions(list).map((ap) => ({ ...ap, dex }))),
        };
      }
      throw new Error(`unexpected GET ${path}`);
    }),
    post: jest.fn(async (_path: string, _body: any) => ({ isSuccess: true, message: 'ok' })),
  };
}

/** Decrypt + ABI-decode the hl_create_order payload the client posted. */
function decodeCreateOrder(client: ReturnType<typeof makeHlClient>) {
  expect(client.post).toHaveBeenCalledTimes(1);
  const [path, body] = client.post.mock.calls[0] as [string, any];
  expect(path).toBe('/v1/hl/create_order');
  const { data } = JSON.parse(decryptGdexComputedData(body.computedData, closeCreds.apiKey));
  const [coin, isLong, price, size, reduceOnly, , tpPrice, slPrice, isMarket] = AbiCoder.defaultAbiCoder().decode(
    ['string', 'bool', 'string', 'string', 'bool', 'string', 'string', 'string', 'bool'],
    '0x' + data,
  );
  return { coin, isLong, price, size, reduceOnly, tpPrice, slPrice, isMarket };
}

describe('Perp Trade Tools', () => {
  const { server, getTools } = createMockServer();

  beforeAll(() => {
    registerPerpTradeTools(server);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registration', () => {
    it('should register all 9 perp trade tools', () => {
      const tools = getTools();
      expect(tools.has('open_perp_position')).toBe(true);
      expect(tools.has('place_perp_order')).toBe(true);
      expect(tools.has('close_perp_position')).toBe(true);
      expect(tools.has('close_all_positions')).toBe(true);
      expect(tools.has('cancel_perp_order')).toBe(true);
      expect(tools.has('cancel_all_perp_orders')).toBe(true);
      expect(tools.has('set_leverage')).toBe(true);
      expect(tools.has('perp_deposit')).toBe(true);
      expect(tools.has('perp_withdraw')).toBe(true);
      expect(tools.size).toBe(9);
    });

    it('should flag the known-broken backend endpoints in descriptions', () => {
      expect(getTools().get('close_all_positions')!.description).toMatch(/unreliable/i);
      expect(getTools().get('set_leverage')!.description).toMatch(/404/);
    });
  });

  describe('open_perp_position', () => {
    it('should call hlCreateOrder with full params', async () => {
      const orderResult = { orderId: '12345', status: 'filled' };
      mockSdk.hlCreateOrder.mockResolvedValue(orderResult);
      const tool = getTools().get('open_perp_position')!;
      const params = {
        ...hlCreds,
        coin: 'BTC',
        isLong: true,
        price: '50000',
        size: '0.1',
        reduceOnly: false,
        tpPrice: '55000',
        slPrice: '48000',
        isMarket: true,
      };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual(orderResult);
      expect(mockSdk.hlCreateOrder).toHaveBeenCalledWith(params);
    });

    it('should handle market orders with no TP/SL', async () => {
      mockSdk.hlCreateOrder.mockResolvedValue({ orderId: '999' });
      const tool = getTools().get('open_perp_position')!;
      await expectMcpSuccess(tool.handler, {
        ...hlCreds,
        coin: 'ETH',
        isLong: false,
        price: '3000',
        size: '1',
        reduceOnly: false,
        tpPrice: '',
        slPrice: '',
        isMarket: true,
      });
    });

    it('should propagate SDK errors', async () => {
      mockSdk.hlCreateOrder.mockRejectedValue(new Error('Position limit exceeded'));
      const tool = getTools().get('open_perp_position')!;
      await expectMcpError(tool.handler, {
        ...hlCreds, coin: 'BTC', isLong: true, price: '50000', size: '10',
        reduceOnly: false, tpPrice: '', slPrice: '', isMarket: true,
      }, 'Position limit exceeded');
    });
  });

  describe('place_perp_order', () => {
    it('should send limit orders (isMarket=false) via hlPlaceOrder without isMarket', async () => {
      mockSdk.hlPlaceOrder.mockResolvedValue({ orderId: '777' });
      const tool = getTools().get('place_perp_order')!;
      const params = { ...hlCreds, coin: 'SOL', isLong: true, price: '100', size: '5', reduceOnly: true, isMarket: false };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ orderId: '777' });
      const { isMarket: _drop, ...expected } = params;
      expect(mockSdk.hlPlaceOrder).toHaveBeenCalledWith(expected);
      expect(mockSdk.hlCreateOrder).not.toHaveBeenCalled();
    });

    it('should route market orders (isMarket=true) via hlCreateOrder so intent is kept', async () => {
      mockSdk.hlCreateOrder.mockResolvedValue({ orderId: '778' });
      const tool = getTools().get('place_perp_order')!;
      const params = { ...hlCreds, coin: 'SOL', isLong: false, price: '0', size: '5', reduceOnly: false, isMarket: true };
      await expectMcpSuccess(tool.handler, params);
      expect(mockSdk.hlCreateOrder).toHaveBeenCalledWith({ ...params, isMarket: true, tpPrice: '', slPrice: '' });
      expect(mockSdk.hlPlaceOrder).not.toHaveBeenCalled();
    });

    it('should describe the market/limit routing', () => {
      expect(getTools().get('place_perp_order')!.description).toMatch(/create_order/);
    });
  });

  describe('close_perp_position', () => {
    let client: ReturnType<typeof makeHlClient>;
    const useState = (byDex: Record<string, Array<{ coin: string; szi: string }>>) => {
      client = makeHlClient(byDex);
      mockSdk.closePerpPosition.mockImplementation((p: any) => closePerpPosition(client as any, p));
    };
    const run = (params: Record<string, unknown>) =>
      getTools().get('close_perp_position')!.handler({ ...closeCreds, ...params });

    it('should SELL to fully close a long', async () => {
      useState({ '': [{ coin: 'BTC', szi: '0.0123' }] });
      const tool = getTools().get('close_perp_position')!;
      const result = await expectMcpSuccess(tool.handler, { ...closeCreds, coin: 'BTC', price: '100000' });
      expect(result).toEqual(expect.objectContaining({
        coin: 'BTC', positionSide: 'long', closeSide: 'sell', isLong: false,
        size: '0.0123', positionSize: '0.0123', remainingSize: '0', isFullClose: true,
      }));
      expect(decodeCreateOrder(client)).toEqual({
        coin: 'BTC', isLong: false, price: '100000', size: '0.0123',
        reduceOnly: true, tpPrice: '', slPrice: '', isMarket: true,
      });
    });

    it('should BUY to fully close a short', async () => {
      useState({ '': [{ coin: 'ETH', szi: '-2.5' }] });
      const tool = getTools().get('close_perp_position')!;
      const result = await expectMcpSuccess(tool.handler, { ...closeCreds, coin: 'eth', price: '3000' });
      expect(result).toEqual(expect.objectContaining({ positionSide: 'short', closeSide: 'buy', size: '2.5' }));
      expect(decodeCreateOrder(client)).toEqual(expect.objectContaining({
        coin: 'ETH', isLong: true, size: '2.5', reduceOnly: true, isMarket: true,
      }));
    });

    it('should partially close and report the remaining size', async () => {
      useState({ '': [{ coin: 'SOL', szi: '-0.3' }] });
      const tool = getTools().get('close_perp_position')!;
      const result = await expectMcpSuccess(tool.handler, { ...closeCreds, coin: 'SOL', size: '0.1', price: '150' });
      expect(result).toEqual(expect.objectContaining({
        closeSide: 'buy', size: '0.1', remainingSize: '0.2', isFullClose: false,
      }));
      expect(decodeCreateOrder(client)).toEqual(expect.objectContaining({ isLong: true, size: '0.1' }));
    });

    it('should reject a flat position and place no order', async () => {
      useState({ '': [{ coin: 'BTC', szi: '0.0' }] });
      await expectMcpError((p) => run(p), { coin: 'BTC', price: '100000' }, 'No open BTC position');
      expect(client.post).not.toHaveBeenCalled();
    });

    it('should reject a size larger than the position', async () => {
      useState({ '': [{ coin: 'BTC', szi: '0.01' }] });
      await expectMcpError((p) => run(p), { coin: 'BTC', size: '0.02', price: '100000' }, 'exceeds the open BTC position');
      expect(client.post).not.toHaveBeenCalled();
    });

    it('should close a dex-prefixed builder coin from its dex', async () => {
      useState({ '': [{ coin: 'TSLA', szi: '9' }], xyz: [{ coin: 'xyz:TSLA', szi: '-4' }] });
      const tool = getTools().get('close_perp_position')!;
      const result = await expectMcpSuccess(tool.handler, { ...closeCreds, coin: 'xyz:TSLA', price: '250' });
      expect(client.get).toHaveBeenCalledWith('/v1/hl/clearinghouse_state', {
        address: closeCreds.walletAddress, dex: 'xyz',
      });
      expect(result).toEqual(expect.objectContaining({ coin: 'xyz:TSLA', dex: 'xyz', closeSide: 'buy', size: '4' }));
      expect(decodeCreateOrder(client)).toEqual(expect.objectContaining({ coin: 'xyz:TSLA', isLong: true, size: '4' }));
    });

    it('should reject a bare coin open on several builder DEXes', async () => {
      useState({ '': [], xyz: [{ coin: 'xyz:TSLA', szi: '1' }], para: [{ coin: 'para:TSLA', szi: '-1' }] });
      await expectMcpError((p) => run(p), { coin: 'TSLA', price: '250' }, 'Ambiguous close');
      expect(client.post).not.toHaveBeenCalled();
    });

    it('should forward positionAddress to the position read', async () => {
      useState({ '': [] });
      const managed = '0x9967179de55bd67e6b90fcc4f908556d93938c0f';
      await run({ coin: 'BTC', positionAddress: managed });
      expect(client.get).toHaveBeenCalledWith('/v1/hl/clearinghouse_state', { address: managed });
    });
  });

  describe('close_all_positions', () => {
    it('should call hlCloseAll', async () => {
      mockSdk.hlCloseAll.mockResolvedValue({ closed: 3 });
      const tool = getTools().get('close_all_positions')!;
      const result = await expectMcpSuccess(tool.handler, hlCreds);
      expect(result).toEqual({ closed: 3 });
      expect(mockSdk.hlCloseAll).toHaveBeenCalledWith(hlCreds);
    });
  });

  describe('cancel_perp_order', () => {
    it('should call hlCancelOrder with coin and orderId', async () => {
      mockSdk.hlCancelOrder.mockResolvedValue({ cancelled: true });
      const tool = getTools().get('cancel_perp_order')!;
      const params = { ...hlCreds, coin: 'ETH', orderId: '12345' };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ cancelled: true });
      expect(mockSdk.hlCancelOrder).toHaveBeenCalledWith(params);
    });
  });

  describe('cancel_all_perp_orders', () => {
    it('should call hlCancelAllOrders', async () => {
      mockSdk.hlCancelAllOrders.mockResolvedValue({ cancelled: 5 });
      const tool = getTools().get('cancel_all_perp_orders')!;
      const result = await expectMcpSuccess(tool.handler, hlCreds);
      expect(result).toEqual({ cancelled: 5 });
    });
  });

  describe('set_leverage', () => {
    it('should call hlUpdateLeverage', async () => {
      mockSdk.hlUpdateLeverage.mockResolvedValue({ leverage: 10 });
      const tool = getTools().get('set_leverage')!;
      const params = { ...hlCreds, coin: 'BTC', leverage: 10, isCross: true };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ leverage: 10 });
      expect(mockSdk.hlUpdateLeverage).toHaveBeenCalledWith(params);
    });
  });

  describe('perp_deposit', () => {
    it('should call perpDeposit', async () => {
      mockSdk.perpDeposit.mockResolvedValue({ txHash: '0xDeposit' });
      const tool = getTools().get('perp_deposit')!;
      const params = { ...hlCreds, tokenAddress: '0xUSDC', amount: '100', chainId: 42161 };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ txHash: '0xDeposit' });
      expect(mockSdk.perpDeposit).toHaveBeenCalledWith(params);
    });
  });

  describe('perp_withdraw', () => {
    it('should call perpWithdraw', async () => {
      mockSdk.perpWithdraw.mockResolvedValue({ txHash: '0xWithdraw' });
      const tool = getTools().get('perp_withdraw')!;
      const params = { ...hlCreds, amount: '50' };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ txHash: '0xWithdraw' });
      expect(mockSdk.perpWithdraw).toHaveBeenCalledWith(params);
    });
  });
});
