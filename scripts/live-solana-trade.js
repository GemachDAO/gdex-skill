#!/usr/bin/env node
/**
 * Live Solana Spot Trading Test
 *
 * Steps:
 *   1. Sign in (EVM auth)
 *   2. Verify Solana managed wallet + balance
 *   3. Buy a token with a tiny amount of SOL
 *   4. Poll trade status
 *
 * Usage:
 *   node scripts/live-solana-trade.js
 */
const {
  GdexSkill,
  GDEX_API_KEY_PRIMARY,
  generateGdexSessionKeyPair,
  buildGdexSignInMessage,
  buildGdexSignInComputedData,
  buildGdexUserSessionData,
  buildGdexManagedTradeComputedData,
} = require('../dist/index.js');
const { ethers } = require('ethers');

// ── Formatting ──────────────────────────────────────────────────────────────
const R = '\x1b[0m', B = '\x1b[1m', GREEN = '\x1b[92m', RED = '\x1b[91m';
const YELLOW = '\x1b[93m', CYAN = '\x1b[96m', DIM = '\x1b[2m';
const step = (n, t) => console.log(`\n${B}── Step ${n}: ${t} ──${R}`);
const ok = (m) => console.log(`  ${GREEN}✓${R} ${m}`);
const info = (m) => console.log(`  ${DIM}${m}${R}`);
const warn = (m) => console.log(`  ${YELLOW}⚠${R} ${m}`);
const fail = (m) => console.log(`  ${RED}✗${R} ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Constants ───────────────────────────────────────────────────────────────
const MNEMONIC = process.env.GDEX_MNEMONIC || 'airport room shoe add offer price divide sell make army say celery';
const API_KEY = process.env.GDEX_API_KEY || GDEX_API_KEY_PRIMARY;
const SOLANA_CHAIN_ID = 622112261;

// Well-known Solana tokens to try
const TOKENS = {
  // BONK - popular meme token, very liquid
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  // JUP - Jupiter exchange token
  JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  // USDC on Solana
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  // WIF - dogwifhat meme token
  WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  // WSOL (wrapped SOL)
  WSOL: 'So11111111111111111111111111111111111111112',
};

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${B}${CYAN}═══ GDEX Solana Spot Trade Test ═══${R}\n`);

  // ── Step 1: Derive wallet & sign in ─────────────────────────────────────
  step(1, 'Sign In');
  const wallet = ethers.Wallet.fromPhrase(MNEMONIC);
  const controlAddr = wallet.address;
  ok(`Control wallet: ${controlAddr}`);

  const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();
  const nonce = String(Date.now());
  const signInMsg = buildGdexSignInMessage(controlAddr, nonce, sessionKey);
  const signature = await wallet.signMessage(signInMsg);
  const signInPayload = buildGdexSignInComputedData({
    apiKey: API_KEY, userId: controlAddr, sessionKey, nonce, signature,
  });

  const skill = new GdexSkill({ timeout: 60000, maxRetries: 2 });
  skill.loginWithApiKey(API_KEY);

  try {
    const res = await skill.signInWithComputedData({
      computedData: signInPayload.computedData,
      chainId: 1,
    });
    ok(`Signed in: ${JSON.stringify(res).slice(0, 200)}`);
  } catch (err) {
    warn(`Sign-in: ${err.message} (continuing)`);
  }

  // ── Step 2: Verify Solana wallet + balance ──────────────────────────────
  step(2, 'Verify Solana Wallet');
  const userData = buildGdexUserSessionData(sessionKey, API_KEY);
  const user = await skill.getManagedUser({
    userId: controlAddr, data: userData, chainId: SOLANA_CHAIN_ID,
  });
  ok(`Solana address: ${user.address}`);
  ok(`Balance: ${user.balance} SOL`);
  info(`Settings: ${JSON.stringify(user.setting)}`);

  if (!user.balance || user.balance <= 0) {
    fail('No SOL balance — send SOL to ' + user.address + ' first');
    return;
  }

  // ── Step 3: Buy a token ─────────────────────────────────────────────────
  step(3, 'Buy Token (BONK)');

  const tokenAddress = TOKENS.BONK;
  // Use 0.0005 SOL (500000 lamports) — tiny amount to test
  const amountLamports = '500000';
  const tradeNonce = String(Date.now());

  info(`Token: BONK (${tokenAddress})`);
  info(`Amount: ${amountLamports} lamports (0.0005 SOL)`);
  info(`Nonce: ${tradeNonce}`);

  const tradePayload = buildGdexManagedTradeComputedData({
    apiKey: API_KEY,
    action: 'purchase',
    userId: controlAddr,
    tokenAddress,
    amount: amountLamports,
    nonce: tradeNonce,
    sessionPrivateKey,
  });
  ok(`computedData built: ${tradePayload.computedData.length} hex chars`);

  // Try with chainId=622112261 (correct Solana chain ID)
  info('Submitting with chainId=622112261...');
  let result;
  try {
    result = await skill.submitManagedPurchase({
      computedData: tradePayload.computedData,
      chainId: SOLANA_CHAIN_ID,
      slippage: 10,
    });
    ok(`Response: ${JSON.stringify(result)}`);
  } catch (err) {
    fail(`Purchase failed (chainId=622112261): ${err.message}`);
    const body = err.responseBody || err.response?.data;
    if (body) info(`Body: ${JSON.stringify(body).slice(0, 500)}`);

    // Fallback: try with chainId=900 (some backend routes may still use this)
    warn('Retrying with chainId=900...');
    try {
      result = await skill.submitManagedPurchase({
        computedData: tradePayload.computedData,
        chainId: 900,
        slippage: 10,
      });
      ok(`Response (chainId=900): ${JSON.stringify(result)}`);
    } catch (err2) {
      fail(`Also failed with chainId=900: ${err2.message}`);
      const body2 = err2.responseBody || err2.response?.data;
      if (body2) info(`Body: ${JSON.stringify(body2).slice(0, 500)}`);
    }
  }

  // ── Step 4: Poll trade status ───────────────────────────────────────────
  if (result?.requestId) {
    step(4, 'Poll Trade Status');
    const reqId = result.requestId;
    ok(`Request ID: ${reqId}`);

    for (let i = 0; i < 12; i++) {
      await sleep(5000);
      try {
        const status = await skill.getManagedTradeStatus(reqId);
        info(`[${i + 1}] Status: ${JSON.stringify(status)}`);
        if (status.status === 'completed' || status.status === 'success') {
          ok(`Trade completed! TX: ${status.hash || status.txHash || 'N/A'}`);
          break;
        }
        if (status.status === 'failed' || status.status === 'error') {
          fail(`Trade failed: ${status.error || JSON.stringify(status)}`);
          break;
        }
      } catch (err) {
        warn(`Status poll error: ${err.message}`);
      }
    }
  } else if (result) {
    warn('No requestId in response — may be synchronous result');
  }

  // ── Step 5: Re-check balance ────────────────────────────────────────────
  step(5, 'Re-check Balance');
  const user2 = await skill.getManagedUser({
    userId: controlAddr, data: userData, chainId: SOLANA_CHAIN_ID,
  });
  ok(`Updated balance: ${user2.balance} SOL`);
  if (user2.holdList?.length) {
    ok(`Token holdings: ${JSON.stringify(user2.holdList)}`);
  }

  console.log(`\n${B}${CYAN}═══ Done ═══${R}\n`);
}

main().catch(e => {
  console.error(`\n${RED}Fatal: ${e.message}${R}`);
  if (e.stack) console.error(e.stack);
});
