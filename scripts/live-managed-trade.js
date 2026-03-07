#!/usr/bin/env node
/*
 * Live Managed-Custody Trade Runner
 *
 * Executes the full managed-custody flow against the real GDEX backend:
 *   1. Derive Solana keypair from mnemonic
 *   2. Generate secp256k1 session keypair
 *   3. Sign-in via /v1/sign_in with Ed25519 (Solana) or EIP-191 (EVM) signature
 *   4. Resolve user via /v1/user
 *   5. Submit purchase via /v1/purchase_v2
 *   6. Poll trade status via /v1/trade-status/:requestId
 *
 * Environment:
 *   GDEX_MNEMONIC           — 12-word mnemonic (required)
 *   GDEX_CHAIN_ID           — 900 (Solana, default) or EVM chain ID
 *   GDEX_TOKEN_ADDRESS      — token to buy (default: BONK on Solana)
 *   GDEX_TRADE_AMOUNT_SOL   — amount in SOL to spend (default: 0.001)
 *   GDEX_SLIPPAGE           — slippage % (default: 1)
 *   GDEX_API_KEY            — API key (default: primary shared key)
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

const { ethers } = require('ethers');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const nacl = require('tweetnacl');
const bs58 = require('bs58').default || require('bs58');

// ── Formatting ──────────────────────────────────────────────────────────────

const R = '\x1b[0m';
const B = '\x1b[1m';
const GREEN = '\x1b[92m';
const RED = '\x1b[91m';
const YELLOW = '\x1b[93m';
const CYAN = '\x1b[96m';
const DIM = '\x1b[2m';

const step = (n, t) => console.log(`\n${B}── Step ${n}: ${t} ──${R}`);
const ok = (m) => console.log(`  ${GREEN}✓${R} ${m}`);
const info = (m) => console.log(`  ${DIM}${m}${R}`);
const warn = (m) => console.log(`  ${YELLOW}⚠${R} ${m}`);
const fail = (m) => console.log(`  ${RED}✗${R} ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Solana key derivation ───────────────────────────────────────────────────

function deriveSolanaKeypair(mnemonic) {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const { key } = derivePath("m/44'/501'/0'/0'", seed.toString('hex'));
  const kp = nacl.sign.keyPair.fromSeed(key);
  return {
    publicKey: bs58.encode(kp.publicKey),
    secretKey: kp.secretKey,  // 64-byte Uint8Array
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${B}${CYAN}═══ GDEX Live Managed-Custody Trade ═══${R}\n`);

  // ── Config ──────────────────────────────────────────────────────────────

  const mnemonic = process.env.GDEX_MNEMONIC;
  if (!mnemonic) {
    fail('GDEX_MNEMONIC environment variable is required');
    console.log('  Set it to your 12-word mnemonic, e.g.:');
    console.log('  GDEX_MNEMONIC="word1 word2 ... word12" node scripts/live-managed-trade.js');
    process.exit(1);
  }

  const apiKey = process.env.GDEX_API_KEY || GDEX_API_KEY_PRIMARY;
  const chainId = Number(process.env.GDEX_CHAIN_ID || '900');
  const isSolana = chainId === 900;
  const tokenAddress =
    process.env.GDEX_TOKEN_ADDRESS || 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'; // BONK
  const tradeAmountSol = process.env.GDEX_TRADE_AMOUNT_SOL || '0.001';
  const slippage = Number(process.env.GDEX_SLIPPAGE || '1');

  // Convert SOL to lamports for the trade amount (1 SOL = 1e9 lamports)
  const tradeAmountLamports = Math.floor(parseFloat(tradeAmountSol) * 1e9).toString();

  // ── Step 1: Derive wallets ──────────────────────────────────────────────

  step(1, 'Derive Wallets from Mnemonic');

  const evmWallet = ethers.Wallet.fromPhrase(mnemonic);
  ok(`EVM address: ${evmWallet.address}`);

  const solKeypair = deriveSolanaKeypair(mnemonic);
  ok(`Solana address: ${solKeypair.publicKey}`);

  // userId depends on chain
  const userId = isSolana ? solKeypair.publicKey : evmWallet.address;
  ok(`Using userId (${isSolana ? 'Solana' : 'EVM'}): ${userId}`);

  // ── Step 2: Generate Session Keypair ────────────────────────────────────

  step(2, 'Generate Session Keypair');

  const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();
  ok(`Session key: ${sessionKey.slice(0, 24)}...`);
  info(`Private key: ${sessionPrivateKey.slice(0, 14)}...${sessionPrivateKey.slice(-6)}`);

  // ── Step 3: Build & Sign the Sign-In Message ───────────────────────────

  step(3, 'Sign the Sign-In Message');

  const nonce = String(Date.now());
  const signInMessage = buildGdexSignInMessage(userId, nonce, sessionKey);
  info(`Message: ${signInMessage.slice(0, 90)}...`);

  let signature;
  if (isSolana) {
    // Ed25519: nacl.sign.detached over raw message bytes
    const messageBytes = Buffer.from(signInMessage, 'utf8');
    const sig = nacl.sign.detached(messageBytes, solKeypair.secretKey);
    // Backend may expect hex-encoded signature (not base58)
    signature = Buffer.from(sig).toString('hex');
    ok(`Solana Ed25519 signature (hex): ${signature.slice(0, 40)}...`);
    info(`Sig length: ${signature.length} hex chars (${sig.length} bytes)`);
  } else {
    // EVM: EIP-191 personal_sign
    signature = await evmWallet.signMessage(signInMessage);
    ok(`EVM signature: ${signature.slice(0, 40)}...`);
  }

  // ── Step 4: POST /v1/sign_in ────────────────────────────────────────────

  step(4, 'POST /v1/sign_in');

  const signInPayload = buildGdexSignInComputedData({
    apiKey,
    userId,
    sessionKey,
    nonce,
    signature,
  });
  info(`computedData length: ${signInPayload.computedData.length} hex chars`);

  const skill = new GdexSkill({ timeout: 45000, maxRetries: 1 });
  skill.loginWithApiKey(apiKey);

  let signInResult;
  try {
    signInResult = await skill.signInWithComputedData({
      computedData: signInPayload.computedData,
      chainId,
    });
    ok(`Sign-in response: ${JSON.stringify(signInResult).slice(0, 300)}`);
  } catch (err) {
    const status = err.statusCode || err.status || '';
    const body = err.responseBody || err.response?.data || '';
    fail(`Sign-in failed (${status}): ${err.message}`);
    if (body) info(`Response body: ${JSON.stringify(body).slice(0, 500)}`);

    // Try dumping the raw request for debugging
    info(`userId: ${userId}`);
    info(`chainId: ${chainId}`);
    info(`nonce: ${nonce}`);
    info(`signature (first 60): ${signature.slice(0, 60)}`);

    // Don't exit — try the other steps to gather more diagnostics
    warn('Continuing despite sign-in failure to test other endpoints...');
  }

  // ── Step 5: GET /v1/user ────────────────────────────────────────────────

  step(5, 'GET /v1/user (resolve managed wallet)');

  const userDataEncrypted = buildGdexUserSessionData(sessionKey, apiKey);

  try {
    const user = await skill.getManagedUser({
      userId,
      data: userDataEncrypted,
      chainId,
    });
    ok(`User response: ${JSON.stringify(user).slice(0, 400)}`);
  } catch (err) {
    const status = err.statusCode || err.status || '';
    const body = err.responseBody || err.response?.data || '';
    fail(`User lookup failed (${status}): ${err.message}`);
    if (body) info(`Response body: ${JSON.stringify(body).slice(0, 500)}`);
  }

  // ── Step 6: Build Trade Payload ─────────────────────────────────────────

  step(6, 'Build Trade Payload (purchase_v2)');

  const tradeNonce = String(Date.now());
  const tradePayload = buildGdexManagedTradeComputedData({
    apiKey,
    action: 'purchase',
    userId,
    tokenAddress,
    amount: tradeAmountLamports,
    nonce: tradeNonce,
    sessionPrivateKey,
  });

  ok(`computedData: ${tradePayload.computedData.length} hex chars`);
  ok(`Signature: ${tradePayload.signature.length} chars`);
  info(`Token: ${tokenAddress}`);
  info(`Amount: ${tradeAmountLamports} lamports (${tradeAmountSol} SOL)`);
  info(`Slippage: ${slippage}%`);

  // ── Step 7: POST /v1/purchase_v2 ────────────────────────────────────────

  step(7, 'POST /v1/purchase_v2');

  let requestId;
  try {
    const tradeResult = await skill.submitManagedPurchase({
      computedData: tradePayload.computedData,
      chainId,
      slippage,
    });
    requestId =
      tradeResult.requestId || tradeResult.jobId || (tradeResult.data && tradeResult.data.requestId);
    ok(`Trade submitted!`);
    ok(`Response: ${JSON.stringify(tradeResult).slice(0, 400)}`);
    if (requestId) ok(`Request ID: ${requestId}`);
  } catch (err) {
    const status = err.statusCode || err.status || '';
    const body = err.responseBody || err.response?.data || '';
    fail(`Trade failed (${status}): ${err.message}`);
    if (body) info(`Response body: ${JSON.stringify(body).slice(0, 500)}`);
  }

  // ── Step 8: Poll Trade Status ───────────────────────────────────────────

  if (requestId) {
    step(8, 'Poll /v1/trade-status/' + requestId);

    for (let i = 1; i <= 18; i++) {
      await sleep(10000);
      try {
        const status = await skill.getManagedTradeStatus(requestId);
        const state = status.status || 'unknown';
        const hash = status.hash || status.txHash || '';
        console.log(`  Poll ${i}/18: status=${state}${hash ? ' hash=' + hash : ''}`);

        if (state === 'completed' || state === 'confirmed' || state === 'success') {
          ok(`Trade completed! Hash: ${hash || 'n/a'}`);
          console.log(`\n${B}${GREEN}═══ LIVE TRADE SUCCESSFUL ═══${R}\n`);
          return;
        }
        if (state === 'failed') {
          fail(`Trade reached failed state`);
          info(`Full response: ${JSON.stringify(status).slice(0, 500)}`);
          process.exitCode = 1;
          return;
        }
      } catch (err) {
        warn(`Poll error: ${err.message}`);
      }
    }
    warn('Polling ended without terminal state — check the GDEX dashboard');
  } else {
    warn('No requestId received — cannot poll status');
  }

  console.log(`\n${B}═══ Live test complete ═══${R}\n`);
}

main().catch((err) => {
  fail(err.message || String(err));
  process.exit(1);
});
