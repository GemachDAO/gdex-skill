/**
 * E2E tests for auth tools (auth.ts)
 * Tools: auth_login, generate_session_keypair, managed_sign_in, build_sign_in_payload
 */
import { jest, describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import { createMockSdk, createMockServer, expectMcpSuccess, expectMcpError } from '../helpers.js';

// Mock the sdk module before importing the tool registrar
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

const { registerAuthTools } = await import('../../src/tools/auth.js');

describe('Auth Tools', () => {
  const { server, getTools } = createMockServer();

  beforeAll(() => {
    registerAuthTools(server);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registration', () => {
    it('should register all 4 auth tools', () => {
      const tools = getTools();
      expect(tools.has('auth_login')).toBe(true);
      expect(tools.has('generate_session_keypair')).toBe(true);
      expect(tools.has('managed_sign_in')).toBe(true);
      expect(tools.has('build_sign_in_payload')).toBe(true);
      expect(tools.size).toBe(4);
    });
  });

  describe('auth_login', () => {
    it('should call loginWithApiKey and return success', async () => {
      mockSdk.loginWithApiKey.mockReturnValue(undefined);
      const tool = getTools().get('auth_login')!;
      const result = await expectMcpSuccess(tool.handler, { apiKey: 'test-uuid-key' });
      expect(result).toEqual({ success: true, message: 'Logged in with API key' });
      expect(mockSdk.loginWithApiKey).toHaveBeenCalledWith('test-uuid-key');
    });

    it('should wrap errors in MCP error format', async () => {
      mockSdk.loginWithApiKey.mockImplementation(() => { throw new Error('Invalid API key'); });
      const tool = getTools().get('auth_login')!;
      await expectMcpError(tool.handler, { apiKey: 'bad-key' }, 'Invalid API key');
    });
  });

  describe('generate_session_keypair', () => {
    it('should return keypair from SDK', async () => {
      const keypair = { sessionPrivateKey: '0xabc', sessionKey: '0x02def' };
      mockSdk.generateManagedSessionKeyPair.mockResolvedValue(keypair);
      const tool = getTools().get('generate_session_keypair')!;
      const result = await expectMcpSuccess(tool.handler, {});
      expect(result).toEqual(keypair);
    });
  });

  describe('managed_sign_in', () => {
    it('should call signInWithComputedData with chainId as number', async () => {
      mockSdk.signInWithComputedData.mockResolvedValue({ token: 'session-tok' });
      const tool = getTools().get('managed_sign_in')!;
      const result = await expectMcpSuccess(tool.handler, {
        computedData: 'encrypted-payload',
        chainId: '622112261',
      });
      expect(result).toEqual({ token: 'session-tok' });
      expect(mockSdk.signInWithComputedData).toHaveBeenCalledWith({
        computedData: 'encrypted-payload',
        chainId: 622112261,
      });
    });
  });

  describe('build_sign_in_payload', () => {
    it('should call buildManagedSignInComputedData with all params', async () => {
      mockSdk.buildManagedSignInComputedData.mockResolvedValue({ computedData: 'enc-payload' });
      const tool = getTools().get('build_sign_in_payload')!;
      const params = {
        apiKey: 'key-1',
        userId: '0xUser',
        sessionKey: '0x02abc',
        nonce: 'nonce123',
        signature: '0xSig',
      };
      const result = await expectMcpSuccess(tool.handler, params);
      expect(result).toEqual({ computedData: 'enc-payload' });
      expect(mockSdk.buildManagedSignInComputedData).toHaveBeenCalledWith(params);
    });
  });
});
