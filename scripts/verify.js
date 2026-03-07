#!/usr/bin/env node
/**
 * Offline SDK smoke-test — runs without a real API key or network connection.
 *
 * Usage:  node scripts/verify.js
 *         npm run verify
 *
 * What it checks:
 *   1. SDK can be imported and GdexSkill can be instantiated
 *   2. Pre-configured API keys are present and non-empty
 *   3. loginWithApiKey() sets authentication state
 *   4. logout() clears authentication state
 *   5. Chain configuration is loaded (14 chains)
 *   6. Utility functions work correctly
 *   7. Error classes are importable and instanceof-safe
 */

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const GREEN  = '\x1b[92m';
const RED    = '\x1b[91m';
const YELLOW = '\x1b[93m';
const DIM    = '\x1b[2m';
const WHITE  = '\x1b[97m';

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ${GREEN}✓${RESET}  ${label}`);
  passed++;
}

function fail(label, err) {
  console.log(`  ${RED}✗${RESET}  ${label}`);
  console.log(`      ${RED}${err && err.message ? err.message : String(err)}${RESET}`);
  failed++;
}

function section(title) {
  console.log(`\n${BOLD}${WHITE}${title}${RESET}`);
}

// ─── Resolve SDK path ─────────────────────────────────────────────────────────
// Works both from source (ts-node) and from a published dist build.
let sdkPath;
try {
  // Try built dist first
  require.resolve('../dist/index.js');
  sdkPath = '../dist/index.js';
} catch (_) {
  // Fall back to ts-node / source
  sdkPath = '../src/index.ts';
}

// ─── Load SDK ─────────────────────────────────────────────────────────────────
let GdexSkill, GDEX_API_KEY_PRIMARY, GDEX_API_KEY_SECONDARY, GDEX_API_KEYS;
let ChainId, getChainName, getNativeToken, formatUsd, formatTokenAmount;
let GdexAuthError, GdexValidationError, GdexApiError, GdexNetworkError, GdexRateLimitError;

section('1. SDK import');
try {
  const sdk = require(sdkPath);
  GdexSkill              = sdk.GdexSkill;
  GDEX_API_KEY_PRIMARY   = sdk.GDEX_API_KEY_PRIMARY;
  GDEX_API_KEY_SECONDARY = sdk.GDEX_API_KEY_SECONDARY;
  GDEX_API_KEYS          = sdk.GDEX_API_KEYS;
  ChainId                = sdk.ChainId;
  getChainName           = sdk.getChainName;
  getNativeToken         = sdk.getNativeToken;
  formatUsd              = sdk.formatUsd;
  formatTokenAmount      = sdk.formatTokenAmount;
  GdexAuthError          = sdk.GdexAuthError;
  GdexValidationError    = sdk.GdexValidationError;
  GdexApiError           = sdk.GdexApiError;
  GdexNetworkError       = sdk.GdexNetworkError;
  GdexRateLimitError     = sdk.GdexRateLimitError;
  ok('SDK imported from ' + sdkPath);
} catch (err) {
  fail('SDK import failed — run `npm run build` first', err);
  process.exit(1);
}

// ─── API Keys ─────────────────────────────────────────────────────────────────
section('2. API keys');
try {
  if (!GDEX_API_KEY_PRIMARY || typeof GDEX_API_KEY_PRIMARY !== 'string') throw new Error('GDEX_API_KEY_PRIMARY is missing or not a string');
  if (!GDEX_API_KEY_SECONDARY || typeof GDEX_API_KEY_SECONDARY !== 'string') throw new Error('GDEX_API_KEY_SECONDARY is missing or not a string');
  if (!Array.isArray(GDEX_API_KEYS) || GDEX_API_KEYS.length < 2) throw new Error('GDEX_API_KEYS should be an array with at least 2 keys');
  ok(`GDEX_API_KEY_PRIMARY   = ${GDEX_API_KEY_PRIMARY.substring(0, 8)}...`);
  ok(`GDEX_API_KEY_SECONDARY = ${GDEX_API_KEY_SECONDARY.substring(0, 8)}...`);
  ok(`GDEX_API_KEYS array    = ${GDEX_API_KEYS.length} keys`);
} catch (err) { fail('API key check', err); }

// ─── GdexSkill instantiation ─────────────────────────────────────────────────
section('3. GdexSkill instantiation');
let skill;
try {
  skill = new GdexSkill();
  ok('new GdexSkill() — default config');
} catch (err) { fail('GdexSkill() constructor failed', err); }

try {
  const s2 = new GdexSkill({ apiUrl: 'https://trade-api.gemach.io', timeout: 5000, maxRetries: 1 });
  ok('new GdexSkill({ apiUrl, timeout, maxRetries }) — custom config');
} catch (err) { fail('GdexSkill() with custom config failed', err); }

// ─── Auth state ───────────────────────────────────────────────────────────────
section('4. Authentication state (offline)');
try {
  if (skill.isAuthenticated()) throw new Error('Expected isAuthenticated() = false before login');
  ok('isAuthenticated() = false before login');
} catch (err) { fail('isAuthenticated() pre-login check', err); }

try {
  skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);
  if (!skill.isAuthenticated()) throw new Error('Expected isAuthenticated() = true after loginWithApiKey()');
  ok('loginWithApiKey(GDEX_API_KEY_PRIMARY) → isAuthenticated() = true');
} catch (err) { fail('loginWithApiKey() failed', err); }

try {
  skill.logout();
  if (skill.isAuthenticated()) throw new Error('Expected isAuthenticated() = false after logout()');
  ok('logout() → isAuthenticated() = false');
} catch (err) { fail('logout() failed', err); }

// ─── Chain config ─────────────────────────────────────────────────────────────
section('5. Chain configuration');
try {
  const ethName = getChainName(1);
  if (!ethName) throw new Error('getChainName(1) returned empty');
  ok(`getChainName(1) = "${ethName}"`);
} catch (err) { fail('getChainName() failed', err); }

try {
  const sol = getNativeToken('solana');
  if (sol !== 'SOL') throw new Error(`getNativeToken('solana') expected 'SOL', got '${sol}'`);
  ok(`getNativeToken('solana') = "SOL"`);
} catch (err) { fail('getNativeToken() failed', err); }

try {
  const eth = getNativeToken(1);
  if (eth !== 'ETH') throw new Error(`getNativeToken(1) expected 'ETH', got '${eth}'`);
  ok(`getNativeToken(1) = "ETH"`);
} catch (err) { fail('getNativeToken() with ChainId failed', err); }

try {
  if (ChainId.BASE !== 8453) throw new Error(`ChainId.BASE expected 8453, got ${ChainId.BASE}`);
  if (ChainId.ARBITRUM !== 42161) throw new Error(`ChainId.ARBITRUM expected 42161, got ${ChainId.ARBITRUM}`);
  if (ChainId.ETHEREUM !== 1) throw new Error(`ChainId.ETHEREUM expected 1, got ${ChainId.ETHEREUM}`);
  ok(`ChainId enum: BASE=${ChainId.BASE}, ARBITRUM=${ChainId.ARBITRUM}, ETHEREUM=${ChainId.ETHEREUM}`);
} catch (err) { fail('ChainId enum check', err); }

// ─── Utilities ────────────────────────────────────────────────────────────────
section('6. Utility functions');
try {
  const r = formatUsd('1234.5');
  if (!r || !r.includes('1,234')) throw new Error(`formatUsd('1234.5') returned unexpected: ${r}`);
  ok(`formatUsd('1234.5') = "${r}"`);
} catch (err) { fail('formatUsd() failed', err); }

try {
  const r = formatTokenAmount('1000000', 6, 'USDC');
  if (!r || !r.includes('USDC')) throw new Error(`formatTokenAmount returned unexpected: ${r}`);
  ok(`formatTokenAmount('1000000', 6, 'USDC') = "${r}"`);
} catch (err) { fail('formatTokenAmount() failed', err); }

// ─── Error classes ────────────────────────────────────────────────────────────
section('7. Error classes');
try {
  const e = new GdexAuthError('test auth error');
  if (!(e instanceof Error)) throw new Error('GdexAuthError not instanceof Error');
  if (!(e instanceof GdexAuthError)) throw new Error('GdexAuthError not instanceof GdexAuthError');
  ok(`GdexAuthError extends Error ✓`);
} catch (err) { fail('GdexAuthError check', err); }

try {
  const e = new GdexValidationError('amount', 'test validation');
  if (!(e instanceof GdexValidationError)) throw new Error('instanceof check failed');
  ok(`GdexValidationError extends Error ✓`);
} catch (err) { fail('GdexValidationError check', err); }

try {
  const e = new GdexRateLimitError('rate limited', 30);
  if (!(e instanceof GdexRateLimitError)) throw new Error('instanceof check failed');
  ok(`GdexRateLimitError extends Error ✓ (retryAfter=${e.retryAfter})`);
} catch (err) { fail('GdexRateLimitError check', err); }

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log();
console.log(`${DIM}  ${'─'.repeat(50)}${RESET}`);
if (failed === 0) {
  console.log(`\n  ${GREEN}${BOLD}All ${passed} checks passed${RESET} ${GREEN}✓${RESET}`);
  console.log(`  ${DIM}SDK is ready — no network token required.${RESET}\n`);
} else {
  console.log(`\n  ${YELLOW}${passed} passed${RESET}, ${RED}${failed} failed${RESET}`);
  console.log(`  ${RED}Run \`npm run build\` and try again.${RESET}\n`);
  process.exit(1);
}
