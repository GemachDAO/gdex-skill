/**
 * E2E tests for spot trade tools (spotTrade.ts)
 * Tools: buy_token, sell_token, wait_for_trade
 */
import { jest, describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createMockSdk, createMockServer, expectMcpSuccess, expectMcpError } from '../helpers.js';

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'gdex-spot-'));
process.env.GDEX_HOME = home;

const mockSdk = createMockSdk();
jest.unstable_mockModule('../../src/sdk.js', () => ({
  getSdk: () => mockSdk,
  readEnv: (n: string) => process.env[n],
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

const { registerSpotTradeTools } = await import('../../src/tools/spotTrade.js');
const { enableAccountRefs } = await import('../../src/credentials.js');

const creds = { walletAddress: '0xW', sessionPrivateKey: '0x' + '11'.repeat(32), apiKey: 'key' };
const accepted = { requestId: 'req-1', status: 'pending', side: 'buy', chainId: 8453, tokenAddress: '0xT', amountRaw: '1', amountDecimals: 18 };

describe('Spot Trade Tools', () => {
  const { server, getTools } = createMockServer();

  beforeAll(() => {
    registerSpotTradeTools(server);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registration', () => {
    it('should register buy_token, sell_token and wait_for_trade', () => {
      const tools = getTools();
      expect([...tools.keys()].sort()).toEqual(['buy_token', 'sell_token', 'wait_for_trade']);
    });

    it('declares the credential fields so accountRef applies', () => {
      for (const name of ['buy_token', 'sell_token']) {
        const schema = getTools().get(name)!.schema as Record<string, any>;
        for (const f of ['walletAddress', 'sessionPrivateKey', 'apiKey']) expect(schema[f]).toBeDefined();
        // No implicit slippage default: on EVM the backend ignores request slippage.
        expect(schema.slippage.isOptional()).toBe(true);
        expect(schema.slippage.parse(undefined)).toBeUndefined();
      }
    });
  });

  describe('buy_token', () => {
    it('dispatches to sdk.buyToken and returns the requestId with a next step', async () => {
      mockSdk.buyToken.mockResolvedValue(accepted);
      const params = { chain: 8453, tokenAddress: '0xT', amount: '0.5', ...creds };
      const result = await expectMcpSuccess(getTools().get('buy_token')!.handler, params);
      expect(mockSdk.buyToken).toHaveBeenCalledWith(params);
      expect(result.requestId).toBe('req-1');
      expect(result.next).toMatch(/wait_for_trade/);
    });

    it('should wrap SDK errors', async () => {
      mockSdk.buyToken.mockRejectedValue(new Error('slippage is not applied to EVM managed trades'));
      await expectMcpError(getTools().get('buy_token')!.handler, {
        chain: 8453, tokenAddress: '0xT', amount: '1', slippage: 1, ...creds,
      }, 'slippage is not applied');
    });
  });

  describe('sell_token', () => {
    it('dispatches percentage sells to sdk.sellToken', async () => {
      mockSdk.sellToken.mockResolvedValue({ ...accepted, side: 'sell', heldRaw: '10' });
      const params = { chain: 'solana', tokenAddress: 'Mint', amount: '50%', slippage: 1, ...creds };
      const result = await expectMcpSuccess(getTools().get('sell_token')!.handler, params);
      expect(mockSdk.sellToken).toHaveBeenCalledWith(params);
      expect(result.heldRaw).toBe('10');
    });
  });

  describe('wait_for_trade', () => {
    it('converts timeoutSec and returns the outcome', async () => {
      mockSdk.waitForTrade.mockResolvedValue({ outcome: 'filled', requestId: 'req-1', hash: '0xh' });
      const result = await expectMcpSuccess(getTools().get('wait_for_trade')!.handler, { requestId: 'req-1', timeoutSec: 30 });
      expect(mockSdk.waitForTrade).toHaveBeenCalledWith({ requestId: 'req-1', timeoutMs: 30000 });
      expect(result.outcome).toBe('filled');
    });
  });

  describe('accountRef', () => {
    it('fills the trade credentials from the account store', async () => {
      const ref = 'acct_0123456789ab';
      await fs.mkdir(path.join(home, 'accounts'), { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(home, 'accounts', `${ref}.json`), JSON.stringify({
        version: 1, accountRef: ref, walletAddress: '0xControl', controlPrivateKey: '0x' + '33'.repeat(32),
        sessionPrivateKey: '0x' + '44'.repeat(32), sessionKey: '0x02' + '55'.repeat(32), apiKey: 'stored-key',
        source: 'generated', createdAt: 0, sessionAt: 0,
      }));
      const { server: wrapped, getTools: wrappedTools } = createMockServer();
      enableAccountRefs(wrapped);
      registerSpotTradeTools(wrapped);
      mockSdk.sellToken.mockResolvedValue(accepted);
      await expectMcpSuccess(wrappedTools().get('sell_token')!.handler, { accountRef: ref, chain: 8453, tokenAddress: '0xT', amount: '100%' });
      expect(mockSdk.sellToken).toHaveBeenCalledWith(expect.objectContaining({
        walletAddress: '0xControl', sessionPrivateKey: '0x' + '44'.repeat(32), apiKey: 'stored-key', amount: '100%',
      }));
    });
  });
});
