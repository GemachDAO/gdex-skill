/**
 * Feature flags for optional surfaces, read from the environment at startup.
 *
 *   GDEX_PRACTICE=off  → no gdex_replay_trade / gdex_make_challenge / gdex_run_challenge
 *   GDEX_INVITES=off   → no gdex_invite, no includeInvite, no gdex_connect inviteCode
 *
 * Both default on. Turning either off never affects core trading tools.
 */
import { readEnv } from './sdk.js';

export interface Features { practice: boolean; invites: boolean }

const off = (v: string | undefined) => /^(0|off|false|no|disabled)$/i.test(v ?? '');

export function features(): Features {
  return { practice: !off(readEnv('GDEX_PRACTICE')), invites: !off(readEnv('GDEX_INVITES')) };
}
