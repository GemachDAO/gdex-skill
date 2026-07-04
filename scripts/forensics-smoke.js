'use strict';
/**
 * Live smoke test for reverseEngineerWinners — READ-ONLY.
 *
 * Pulls the HL month board (thin feed is expected: the live board is
 * MM-dominated) and prints the returned WinnerIntel universe + desk_text.
 *
 *   GDEX_API_KEY=... node scripts/forensics-smoke.js
 */
const { GdexSkill, GDEX_API_KEY_PRIMARY } = require('../dist');

(async () => {
  const skill = new GdexSkill({ timeout: 30000, maxRetries: 1 });
  skill.loginWithApiKey(process.env.GDEX_API_KEY || GDEX_API_KEY_PRIMARY);
  const intel = await skill.reverseEngineerWinners({ max: 8 });
  console.log('UNIVERSE:', JSON.stringify(intel.universe, null, 2));
  console.log('SCORECARDS:', intel.scorecards.length, 'AGG_FEATURES:', intel.aggregate_features.length);
  console.log('DESK_TEXT:');
  console.log(intel.desk_text);
  process.exit(0); // HL transport keeps a keep-alive socket open; exit cleanly.
})().catch((err) => {
  console.error('SMOKE FAILED:', err && err.message ? err.message : err);
  process.exit(1);
});
