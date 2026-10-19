/**
 * MCP tools for Hyperliquid HIP-4 outcome markets (v110.ts).
 * Write tools must take EITHER structured fields OR computedData alone.
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
      const name = err instanceof Error ? err.name : 'Error';
      return { content: [{ type: 'text' as const, text: `❌ Error: [${name}] ${message}` }] };
    }
  }),
}));

const { registerV110Tools } = await import('../../src/tools/v110.js');

const creds = { apiKey: 'k', walletAddress: '0xC0', sessionPrivateKey: '0x01' };

describe('HIP-4 outcome MCP tools', () => {
  const { server, getTools } = createMockServer();
  const tool = (name: string) => getTools().get(name)!;

  beforeAll(() => registerV110Tools(server));
  beforeEach(() => jest.clearAllMocks());

  it('registers the outcome tools with HIP-4 (not HIP-3 / Polymarket) wording', () => {
    for (const name of ['hl_outcomes', 'get_hl_outcome_volumes', 'hl_outcome_account', 'hl_outcome_check_collateral', 'hl_create_outcome_order', 'hl_cancel_outcome_order', 'hl_close_outcome_order']) {
      expect(getTools().has(name)).toBe(true);
    }
    expect(tool('hl_outcomes').description).toMatch(/HIP-4/);
    expect(tool('hl_outcomes').description).toMatch(/no Polymarket\/Kalshi/);
    for (const name of ['hl_outcomes', 'hl_create_outcome_order', 'hl_close_outcome_order']) {
      expect(tool(name).description).not.toMatch(/HIP-3/);
    }
    expect(Object.keys(tool('hl_create_outcome_order').schema)).not.toContain('dex');
  });

  it('hl_outcomes returns normalised markets by default and the raw payload on request', async () => {
    await expectMcpSuccess(tool('hl_outcomes').handler, { state: 'active', query: 'BTC', withVolume: true, volumeTimeoutMs: 500 });
    expect(mockSdk.getHlOutcomeMarkets).toHaveBeenCalledWith({ state: 'active', query: 'BTC', withVolume: true, volumeTimeoutMs: 500 });
    await expectMcpSuccess(tool('hl_outcomes').handler, { raw: true });
    expect(mockSdk.getHlOutcomes).toHaveBeenCalled();
    await expectMcpSuccess(tool('hl_outcomes').handler, { raw: true, withVolume: true });
    expect(mockSdk.getHlOutcomesWithVolume).toHaveBeenCalled();
  });

  it('hl_outcome_account returns the normalised state by default', async () => {
    await expectMcpSuccess(tool('hl_outcome_account').handler, { userAddress: '0xM', outcomeId: 14315 });
    expect(mockSdk.getHlOutcomeAccountState).toHaveBeenCalledWith({ userAddress: '0xM', outcomeId: 14315 });
    await expectMcpSuccess(tool('hl_outcome_account').handler, { userAddress: '0xM', outcomeId: 14315, raw: true });
    expect(mockSdk.getHlOutcomeAccount).toHaveBeenCalled();
  });

  it('create: structured params pass through', async () => {
    const p = { ...creds, outcomeId: 14315, sideLabel: 'Yes', isBuy: true, price: '0.12', size: '120' };
    await expectMcpSuccess(tool('hl_create_outcome_order').handler, p);
    expect(mockSdk.createHlOutcomeOrder).toHaveBeenCalledWith(p);
  });

  it('create: computedData alone passes through; isBuy=false counts as present', async () => {
    await expectMcpSuccess(tool('hl_create_outcome_order').handler, { computedData: 'deadbeef' });
    expect(mockSdk.createHlOutcomeOrder).toHaveBeenCalledWith({ computedData: 'deadbeef' });
    await expectMcpSuccess(tool('hl_create_outcome_order').handler, { ...creds, outcomeId: 1, coin: '#10', isBuy: false, price: '0.5', size: '30' });
  });

  it.each([
    ['hl_create_outcome_order', { computedData: 'abc', ...creds, outcomeId: 1 }],
    ['hl_cancel_outcome_order', { computedData: 'abc', orderId: '5' }],
    ['hl_close_outcome_order', { computedData: 'abc', price: '0.5' }],
  ])('%s rejects computedData mixed with structured fields before calling the SDK', async (name, params) => {
    await expectMcpError(tool(name).handler, params, 'GdexValidationError');
    await expectMcpError(tool(name).handler, params, 'either computedData alone');
    expect(mockSdk.createHlOutcomeOrder).not.toHaveBeenCalled();
    expect(mockSdk.cancelHlOutcomeOrder).not.toHaveBeenCalled();
    expect(mockSdk.closeHlOutcomeOrder).not.toHaveBeenCalled();
  });

  it.each([
    ['hl_create_outcome_order', { ...creds, outcomeId: 1, isBuy: true }, 'Missing size'],
    ['hl_create_outcome_order', { outcomeId: 1, isBuy: true, size: '20' }, 'Missing apiKey, walletAddress, sessionPrivateKey'],
    ['hl_cancel_outcome_order', { ...creds, outcomeId: 1, coin: '#10' }, 'Missing orderId'],
    ['hl_close_outcome_order', { apiKey: 'k', outcomeId: 1 }, 'Missing walletAddress, sessionPrivateKey'],
  ])('%s rejects incomplete structured params', async (name, params, msg) => {
    await expectMcpError(tool(name).handler, params, msg);
  });

  it('hl_outcome_check_collateral forwards to the SDK', async () => {
    const p = { managedAddress: '0xM', quoteToken: 'USDC', size: '120', price: '0.12' };
    await expectMcpSuccess(tool('hl_outcome_check_collateral').handler, p);
    expect(mockSdk.checkHlOutcomeCollateral).toHaveBeenCalledWith(p);
  });
});
