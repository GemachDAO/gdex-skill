/**
 * SDK initialization and shared utilities for MCP tools.
 * Creates a GdexSkill instance configured from environment variables.
 */
import { GdexSkill } from '@gemachdao/gdex-skill';

let _sdk: GdexSkill | null = null;

/**
 * Read an env var, treating empty values and unexpanded `${...}` placeholders as unset.
 * Some MCP clients (e.g. Codex installing the Claude Code plugin) pass the plugin's
 * `${user_config.*}` placeholder through literally instead of substituting the user's value.
 */
export function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value || /^\$\{[^}]*\}$/.test(value)) return undefined;
  return value;
}

export function getSdk(): GdexSkill {
  if (!_sdk) {
    const apiUrl = readEnv('GDEX_API_URL') || 'https://trade-api.gemach.io/v1';
    _sdk = new GdexSkill({ apiUrl });

    // Auto-login with API key from env if available
    const apiKey = readEnv('GDEX_API_KEY');
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
