#!/usr/bin/env node
/*
 * Managed-Custody End-to-End Script
 *
 * Performs the full GDEX managed custody flow:
 *   1. Generate session keypair
 *   2. Sign in via /v1/sign_in  (requires control-wallet signature)
 *   3. Resolve user via /v1/user
 *   4. Submit a purchase via /v1/purchase_v2
 *   5. Poll trade status via /v1/trade-status/:requestId
 *
 * Environment variables:
 *   GDEX_API_KEY           — API key for AES encryption (default: primary shared key)
 *   GDEX_CONTROL_WALLET    — userId (control wallet address) — REQUIRED
 *   GDEX_SESSION_PRIVATE   — existing session private key (hex, 0x-prefixed)
 *                            If omitted, a fresh keypair is generated (requires sign_in)
 *   GDEX_MANAGED_CHAIN_ID  — chain ID (default: 900 = Solana)
 *   GDEX_TOKEN_ADDRESS     — token to buy (default: BONK on Solana)
 *   GDEX_TRADE_AMOUNT      — amount in smallest unit (default: 100000, i.e. 0.0001 SOL equiv)
 *   GDEX_SLIPPAGE          — slippage percent (default: 1)
 *   GDEX_NONCE             — nonce override (default: current ms timestamp)
 *   CONFIRM_LIVE_TRADE     — set to "YES" to actually submit the trade
 *   GDEX_POLL_ATTEMPTS     — status poll attempts (default: 18)
 *   GDEX_POLL_INTERVAL_MS  — ms between polls (default: 10000)
 *
 * Usage:
 *   # Dry-run (generates payloads, does not submit):
 *   node scripts/managed-e2e.js
 *
 *   # Live trade:
 *   GDEX_CONTROL_WALLET=0x53D0... CONFIRM_LIVE_TRADE=YES node scripts/managed-e2e.js
 */

const {
  GdexSkill,
  GDEX_API_KEY_PRIMARY,
  Endpoints,
  generateGdexSessionKeyPair,
  buildGdexSignInMessage,
  buildGdexSignInComputedData,
  buildGdexManagedTradeComputedData,
  buildGdexUserSessionData,
  encryptGdexComputedData,
  decryptGdexComputedData,
} = require('../dist/index.js');

// ── Formatting helpers ──────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[92m';
const RED = '\x1b[91m';
const YELLOW = '\x1b[93m';
const CYAN = '\x1b[96m';
const WHITE = '\x1b[97m';
const DIM = '\x1b[2m';

function banner() {
  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║   GDEX Managed-Custody End-to-End Flow               ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════╝${RESET}\n`);
}

function section(n, title) {
  console.log(`\n${BOLD}${WHITE}${n}. ${title}${RESET}`);
}

function ok(msg) {
  console.log(`  ${GREEN}✓${RESET} ${msg}`);
}

function info(msg) {
  console.log(`  ${DIM}${msg}${RESET}`);
}

function warn(msg) {
  console.log(`  ${YELLOW}⚠${RESET} ${msg}`);
}

function fail(msg) {
  console.log(`  ${RED}✗${RESET} ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickRequestId(payload) {
  if (!payload || typeof payload !== 'object') return undefined;
  if (typeof payload.requestId === 'string' && payload.requestId.length > 0) return payload.requestId;
  if (typeof payload.jobId === 'string' && payload.jobId.length > 0) return payload.jobId;
  if (typeof payload.id === 'string' && payload.id.length > 0) return payload.id;
  return undefined;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  banner();

  // Read configuration from environment
  const apiKey = process.env.GDEX_API_KEY || GDEX_API_KEY_PRIMARY;
  const userId = process.env.GDEX_CONTROL_WALLET || '';
  const chainId = Number(process.env.GDEX_MANAGED_CHAIN_ID || '900');
  const tokenAddress =
    process.env.GDEX_TOKEN_ADDRESS || 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'; // BONK
  const tradeAmount = process.env.GDEX_TRADE_AMOUNT || '100000';
  const slippage = Number(process.env.GDEX_SLIPPAGE || '1');
  const nonce = process.env.GDEX_NONCE || String(Date.now());
  const confirmLive = process.env.CONFIRM_LIVE_TRADE === 'YES';
  const pollAttempts = Number(process.env.GDEX_POLL_ATTEMPTS || '18');
  const pollIntervalMs = Number(process.env.GDEX_POLL_INTERVAL_MS || '10000');
  let sessionPrivateKey = process.env.GDEX_SESSION_PRIVATE || '';

  // ── Step 1: Session Keypair ─────────────────────────────────────────────

  section(1, 'Session Keypair');

  let sessionKey;
  if (sessionPrivateKey) {
    // Derive public key from provided private key
    const { SigningKey } = require('ethers');
    const sk = new SigningKey(sessionPrivateKey);
    sessionKey = sk.compressedPublicKey;
    ok(`Using existing session key: ${sessionKey.slice(0, 20)}...`);
  } else {
    const kp = generateGdexSessionKeyPair();
    sessionPrivateKey = kp.sessionPrivateKey;
    sessionKey = kp.sessionKey;
    ok(`Generated new session keypair`);
    info(`Session public key: ${sessionKey}`);
    info(`Session private key: ${sessionPrivateKey.slice(0, 14)}...${sessionPrivateKey.slice(-8)}`);
    warn('Save GDEX_SESSION_PRIVATE to reuse this session without re-signing in.');
  }

  // ── Step 2: Sign-In Payload Construction ─────────────────────────────────

  section(2, 'Sign-In Payload');

  if (!userId) {
    warn('GDEX_CONTROL_WALLET not set — generating sample payloads only (no live calls).');
  }

  const signInNonce = nonce;
  const signInMessage = buildGdexSignInMessage(
    userId || '0x0000000000000000000000000000000000000000',
    signInNonce,
    sessionKey
  );
  ok('Sign-in message built');
  info(`Message (first 100 chars): ${signInMessage.slice(0, 100)}...`);
  info(`Nonce: ${signInNonce}`);

  // In a real flow, the control wallet signs this message:
  // - EVM: EIP-191 personal_sign
  // - Solana: ed25519 nacl.sign.detached(Buffer.from(message))
  // For dry-run, we create a placeholder
  const placeholderSignature = '0x' + '00'.repeat(65);

  const signInPayload = buildGdexSignInComputedData({
    apiKey,
    userId: userId || '0x0000000000000000000000000000000000000000',
    sessionKey,
    nonce: signInNonce,
    signature: placeholderSignature,
  });
  ok('Sign-in computedData built');
  info(`computedData length: ${signInPayload.computedData.length} hex chars`);
  info(`ABI data length: ${signInPayload.data.length} chars`);

  // Verify encrypt/decrypt roundtrip
  const decrypted = decryptGdexComputedData(signInPayload.computedData, apiKey);
  const parsed = JSON.parse(decrypted);
  if (parsed.userId && parsed.data && parsed.signature) {
    ok('Encrypt/decrypt roundtrip verified');
  } else {
    fail('Encrypt/decrypt roundtrip mismatch');
    process.exitCode = 1;
    return;
  }

  // ── Step 3: User Lookup Payload ─────────────────────────────────────────

  section(3, 'User Lookup (/v1/user) Payload');

  const userDataEncrypted = buildGdexUserSessionData(sessionKey, apiKey);
  ok('Encrypted session key for /v1/user data param');
  info(`Encrypted data length: ${userDataEncrypted.length} hex chars`);
  info(`Query: /v1/user?userId=${(userId || '<wallet>').slice(0, 12)}...&data=${userDataEncrypted.slice(0, 20)}...&chainId=${chainId}`);

  // ── Step 4: Trade Payload (purchase_v2) ─────────────────────────────────

  section(4, 'Trade Payload (purchase_v2)');

  const tradePayload = buildGdexManagedTradeComputedData({
    apiKey,
    action: 'purchase',
    userId: userId || '0x0000000000000000000000000000000000000000',
    tokenAddress,
    amount: tradeAmount,
    nonce,
    sessionPrivateKey,
  });
  ok('Trade computedData built');
  info(`computedData length: ${tradePayload.computedData.length} hex chars`);
  info(`Signature (first 40): ${tradePayload.signature.slice(0, 40)}...`);
  info(`Signature total length: ${tradePayload.signature.length} chars (expected: 130)`);

  // Verify trade payload roundtrip
  const tradeDecrypted = decryptGdexComputedData(tradePayload.computedData, apiKey);
  const tradeParsed = JSON.parse(tradeDecrypted);
  if (tradeParsed.userId && tradeParsed.data && tradeParsed.signature) {
    ok('Trade payload encrypt/decrypt roundtrip verified');
  } else {
    fail('Trade payload roundtrip mismatch');
    process.exitCode = 1;
    return;
  }

  // ── Step 5: Execution Gate ─────────────────────────────────────────────

  section(5, 'Execution Summary');
  console.log(`  Chain ID:       ${chainId}`);
  console.log(`  Token:          ${tokenAddress}`);
  console.log(`  Amount:         ${tradeAmount}`);
  console.log(`  Slippage:       ${slippage}%`);
  console.log(`  User (wallet):  ${userId || '(not set)'}`);
  console.log(`  Live trade:     ${confirmLive ? `${GREEN}YES${RESET}` : `${YELLOW}NO (dry-run)${RESET}`}`);

  if (!confirmLive) {
    console.log(`\n${YELLOW}  Dry-run complete. All payloads validated.${RESET}`);
    warn('Set CONFIRM_LIVE_TRADE=YES and GDEX_CONTROL_WALLET=<address> to execute live.');
    return;
  }

  if (!userId) {
    fail('GDEX_CONTROL_WALLET is required for live trades');
    process.exitCode = 1;
    return;
  }

  // ── Step 6: Live Sign-In ──────────────────────────────────────────────

  section(6, 'Live Sign-In (/v1/sign_in)');
  const skill = new GdexSkill({ timeout: 45000, maxRetries: 1 });
  skill.loginWithApiKey(apiKey);

  try {
    const signInResult = await skill.signInWithComputedData({
      computedData: signInPayload.computedData,
      chainId,
    });
    ok(`Sign-in response: ${JSON.stringify(signInResult).slice(0, 200)}`);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    fail(`Sign-in failed: ${msg}`);
    warn('This is expected if using a placeholder signature. Provide a real wallet-signed message.');
    // Continue anyway for testing subsequent endpoints
  }

  // ── Step 7: User Lookup ───────────────────────────────────────────────

  section(7, 'User Lookup (/v1/user)');
  try {
    const userResult = await skill.getManagedUser({
      userId,
      data: userDataEncrypted,
      chainId,
    });
    ok(`User response: ${JSON.stringify(userResult).slice(0, 200)}`);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    fail(`User lookup failed: ${msg}`);
  }

  // ── Step 8: Submit Trade ──────────────────────────────────────────────

  section(8, 'Submit Trade (/v1/purchase_v2)');
  let requestId;
  try {
    const tradeResult = await skill.submitManagedPurchase({
      computedData: tradePayload.computedData,
      chainId,
      slippage,
    });
    requestId = pickRequestId(tradeResult);
    ok(`Trade submitted: requestId=${requestId || 'n/a'} status=${tradeResult.status || 'unknown'}`);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    fail(`Trade submission failed: ${msg}`);
  }

  // ── Step 9: Poll Status ───────────────────────────────────────────────

  if (requestId) {
    section(9, 'Poll Trade Status');
    for (let i = 1; i <= pollAttempts; i++) {
      await sleep(pollIntervalMs);
      try {
        const status = await skill.getManagedTradeStatus(requestId);
        const state = status.status || 'unknown';
        console.log(`  Poll ${i}/${pollAttempts}: status=${state}`);

        if (state === 'completed' || state === 'confirmed' || state === 'success') {
          ok(`Trade completed! Hash: ${status.hash || 'n/a'}`);
          return;
        }
        if (state === 'failed') {
          fail('Trade failed');
          process.exitCode = 1;
          return;
        }
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        warn(`Poll error: ${msg}`);
      }
    }
    warn('Polling finished without terminal state; check dashboard.');
  }
}

main().catch((err) => {
  fail(err && err.message ? err.message : String(err));
  process.exit(1);
});
