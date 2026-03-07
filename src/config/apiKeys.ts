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
  '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54',
  '2c8f0a91-5d34-4e7b-9a62-f1c3d8e4b705',
];

/**
 * The primary shared API key (first entry in GDEX_API_KEYS).
 */
export const GDEX_API_KEY_PRIMARY = GDEX_API_KEYS[0];

/**
 * The secondary shared API key (second entry in GDEX_API_KEYS).
 */
export const GDEX_API_KEY_SECONDARY = GDEX_API_KEYS[1];
