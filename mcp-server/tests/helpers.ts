/**
 * Test helper — creates a mock McpServer that captures registered tool handlers
 * and a mock GdexSkill SDK instance with jest.fn() stubs for all methods.
 */
import { jest, expect } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ── Mock SDK ────────────────────────────────────────────────────────────

export function createMockSdk(): Record<string, jest.Mock> {
  return new Proxy({} as Record<string, jest.Mock>, {
    get(target, prop: string) {
      if (!(prop in target)) {
        target[prop] = jest.fn().mockResolvedValue({ ok: true });
      }
      return target[prop];
    },
  });
}

// ── Mock McpServer ──────────────────────────────────────────────────────

export interface CapturedTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (params: any) => Promise<any>;
}

export function createMockServer(): { server: McpServer; getTools: () => Map<string, CapturedTool> } {
  const tools = new Map<string, CapturedTool>();

  const server = {
    tool: jest.fn((...args: any[]) => {
      // server.tool(name, description, schema, handler)
      const [name, description, schema, handler] = args;
      tools.set(name, { name, description, schema, handler });
    }),
  } as unknown as McpServer;

  return { server, getTools: () => tools };
}

// ── Assertions ──────────────────────────────────────────────────────────

/** Assert that calling the tool handler returns a valid MCP text response */
export async function expectMcpSuccess(
  handler: (params: any) => Promise<any>,
  params: Record<string, unknown>,
): Promise<any> {
  const result = await handler(params);
  expect(result).toHaveProperty('content');
  expect(result.content).toBeInstanceOf(Array);
  expect(result.content.length).toBeGreaterThan(0);
  expect(result.content[0]).toHaveProperty('type', 'text');
  expect(result.content[0]).toHaveProperty('text');
  // Should NOT be an error
  expect(result.content[0].text).not.toMatch(/^❌ Error:/);
  return JSON.parse(result.content[0].text);
}

/** Assert that the tool handler wraps errors in the MCP error format */
export async function expectMcpError(
  handler: (params: any) => Promise<any>,
  params: Record<string, unknown>,
  errorMessageSubstr?: string,
): Promise<string> {
  const result = await handler(params);
  expect(result).toHaveProperty('content');
  expect(result.content[0]).toHaveProperty('type', 'text');
  expect(result.content[0].text).toMatch(/^❌ Error:/);
  if (errorMessageSubstr) {
    expect(result.content[0].text).toContain(errorMessageSubstr);
  }
  return result.content[0].text;
}
