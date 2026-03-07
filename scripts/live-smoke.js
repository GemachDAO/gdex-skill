#!/usr/bin/env node
/*
 * Live smoke test for @gdexsdk/gdex-skill.
 *
 * This script hits production API endpoints with safe, non-destructive calls.
 * It is intended for release gating before publishing the skill for autonomous agents.
 */

const { GdexSkill, GDEX_API_KEY_PRIMARY } = require('../dist/index.js');

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[92m';
const RED = '\x1b[91m';
const YELLOW = '\x1b[93m';
const WHITE = '\x1b[97m';

let passed = 0;
let failed = 0;
let skipped = 0;

function ok(label, detail) {
  const suffix = detail ? ` ${detail}` : '';
  console.log(`  ${GREEN}OK${RESET} ${label}${suffix}`);
  passed++;
}

function fail(label, err) {
  const msg = err && err.message ? err.message : String(err);
  console.log(`  ${RED}FAIL${RESET} ${label}`);
  console.log(`      ${RED}${msg}${RESET}`);
  failed++;
}

function skip(label, reason) {
  const suffix = reason ? ` (${reason})` : '';
  console.log(`  ${YELLOW}SKIP${RESET} ${label}${suffix}`);
  skipped++;
}

function section(title) {
  console.log(`\n${BOLD}${WHITE}${title}${RESET}`);
}

async function check(label, fn) {
  try {
    const detail = await fn();
    ok(label, detail);
  } catch (err) {
    fail(label, err);
  }
}

async function main() {
  const skill = new GdexSkill({
    timeout: 45000,
    maxRetries: 1,
  });

  section('1. Public API live checks');

  await check('Token details (SOL)', async () => {
    const token = await skill.getTokenDetails({
      chain: 'solana',
      tokenAddress: 'So11111111111111111111111111111111111111112',
    });
    if (!token || typeof token !== 'object') throw new Error('Expected object response');
    return `-> keys=${Object.keys(token).length}`;
  });

  section('2. Authenticated live checks');

  await check('API key login', async () => {
    skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);
    if (!skill.isAuthenticated()) throw new Error('Client should be authenticated after loginWithApiKey()');
    return '-> authenticated';
  });

  const walletAddress = process.env.GDEX_SMOKE_WALLET || '0x0000000000000000000000000000000000000000';

  await check(`Portfolio route (${walletAddress.slice(0, 8)}...)`, async () => {
    try {
      await skill.getPortfolio({ walletAddress });
      return '-> fetched';
    } catch (err) {
      if (err && typeof err === 'object' && (err.status === 400 || err.statusCode === 400)) {
        return '-> reachable (400 validation response)';
      }
      throw err;
    }
  });

  section('3. Summary');
  console.log(`  Passed:  ${GREEN}${passed}${RESET}`);
  console.log(`  Failed:  ${failed > 0 ? RED : GREEN}${failed}${RESET}`);
  console.log(`  Skipped: ${skipped}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`${RED}Unhandled failure:${RESET}`, err && err.message ? err.message : err);
  process.exit(1);
});
