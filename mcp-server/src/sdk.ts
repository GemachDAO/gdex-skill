/**
 * SDK initialization and shared utilities for MCP tools.
 * Creates a GdexSkill instance configured from environment variables.
 */
import { GdexSkill } from '@gdexsdk/gdex-skill';

let _sdk: GdexSkill | null = null;

export function getSdk(): GdexSkill {
  if (!_sdk) {
    const apiUrl = process.env.GDEX_API_URL || 'https://trade-api.gemach.io/v1';
    _sdk = new GdexSkill({ apiUrl });

    // Auto-login with API key from env if available
    const apiKey = process.env.GDEX_API_KEY;
    if (apiKey) {
      _sdk.loginWithApiKey(apiKey);
    }
  }
  return _sdk;
}

/** Wraps an async handler to normalize errors into MCP text responses */
export async function handleToolCall<T>(
  fn: () => Promise<T>,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const result = await fn();
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    return { content: [{ type: 'text' as const, text }] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return {
      content: [{
        type: 'text' as const,
        text: `❌ Error: ${message}${stack ? `\n\nStack: ${stack}` : ''}`,
      }],
    };
  }
}
