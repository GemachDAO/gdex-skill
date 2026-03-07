/**
 * Pre-configured API keys for the GdexSkill SDK.
 *
 * These are shared API keys that any AI agent can use to authenticate
 * with the Gbot backend without needing to sign wallet transactions.
 *
 * @example
 * ```typescript
 * import { GdexSkill, GDEX_API_KEYS } from '@gdexsdk/gdex-skill';
 *
 * const skill = new GdexSkill();
 * skill.loginWithApiKey(GDEX_API_KEYS[0]);
 * ```
 */

/**
 * Shared API keys available for AI agent authentication.
 * Use any one of these keys to authenticate via `loginWithApiKey()`.
 */
export const GDEX_API_KEYS: readonly string[] = [
  '3f6c9e12-7b41-4c2a-9d5e-1a8f3b7e6c90',
  '8d2a5f47-2e13-4b9c-a6f1-0c9e7d3a5b21',
];

/**
 * The primary shared API key (first entry in GDEX_API_KEYS).
 */
export const GDEX_API_KEY_PRIMARY = GDEX_API_KEYS[0];

/**
 * The secondary shared API key (second entry in GDEX_API_KEYS).
 */
export const GDEX_API_KEY_SECONDARY = GDEX_API_KEYS[1];
