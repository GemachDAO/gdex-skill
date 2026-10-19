/**
 * E2E tests for unified USDC wallet tools (usdc.ts)
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

const { registerUsdcTools } = await import('../../src/tools/usdc.js');

const creds = { apiKey: 'k', walletAddress: '0xabc', sessionPrivateKey: '0x01' };

const TOOL_TO_SDK: Record<string, string> = {
  usdc_get_balances: 'getUsdcBalances',
  usdc_get_trade_quote: 'getUsdcTradeQuote',
  usdc_get_funding_status: 'getUsdcFundingStatus',
  usdc_get_deferred_trade: 'getUsdcDeferredTrade',
  usdc_get_pending_trades: 'getUsdcPendingTrades',
  usdc_get_convert_quote: 'getUsdcConvertQuote',
  usdc_get_bridge_status: 'getUsdcBridgeStatus',
  usdc_get_bridge_orders: 'getUsdcBridgeOrders',
  usdc_buy: 'buyWithUsdc',
  usdc_sell: 'sellToUsdc',
  usdc_buy_with_native: 'buyWithNative',
  usdc_retry_sell: 'retryUsdcSell',
  usdc_convert_native: 'convertNativeToUsdc',
  usdc_estimate_bridge: 'estimateUsdcBridge',
  usdc_execute_bridge: 'executeUsdcBridge',
};

describe('Unified USDC Tools', () => {
  const { server, getTools } = createMockServer();

  beforeAll(() => {
    registerUsdcTools(server);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers all 15 USDC tools', () => {
    const tools = getTools();
    for (const name of Object.keys(TOOL_TO_SDK)) expect(tools.has(name)).toBe(true);
    expect(tools.size).toBe(15);
  });

  it('usdc_get_balances returns the unified balance', async () => {
    const balances = { totalUsdc: '12.5', chains: [{ chainId: 8453, usdc: '12.5' }] };
    mockSdk.getUsdcBalances.mockResolvedValue(balances);
    const result = await expectMcpSuccess(getTools().get('usdc_get_balances')!.handler, creds);
    expect(result).toEqual(balances);
    expect(mockSdk.getUsdcBalances).toHaveBeenCalledWith(creds);
  });

  it('usdc_buy passes the trade through to buyWithUsdc', async () => {
    mockSdk.buyWithUsdc.mockResolvedValue({ status: 'pending', requestId: 'r1' });
    const params = { ...creds, chainId: 8453, tokenAddress: '0xt', usdcAmountRaw: '5000000', minTokenOutRaw: '1' };
    const result = await expectMcpSuccess(getTools().get('usdc_buy')!.handler, params);
    expect(result).toEqual({ status: 'pending', requestId: 'r1' });
    expect(mockSdk.buyWithUsdc).toHaveBeenCalledWith(params);
  });

  it('usdc_execute_bridge surfaces a signed-cap rejection', async () => {
    mockSdk.executeUsdcBridge.mockRejectedValue(new Error('EXCEEDS_SIGNED_MAX'));
    await expectMcpError(getTools().get('usdc_execute_bridge')!.handler, {
      ...creds, fromChainId: 8453, toChainId: 42161, amountRaw: '1000000', maxFromAmountRaw: '1010000',
    }, 'EXCEEDS_SIGNED_MAX');
  });

  it.each(Object.entries(TOOL_TO_SDK))('%s calls sdk.%s', async (tool, method) => {
    (mockSdk as any)[method].mockResolvedValue({ ok: true });
    await expectMcpSuccess(getTools().get(tool)!.handler, { ...creds });
    expect((mockSdk as any)[method]).toHaveBeenCalledTimes(1);
  });
});
