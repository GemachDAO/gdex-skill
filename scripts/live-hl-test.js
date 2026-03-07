#!/usr/bin/env node
/**
 * Live HyperLiquid Test — full managed-custody flow
 *
 * Steps:
 *   1. Derive wallets from mnemonic
 *   2. Sign-in to get session key registered
 *   3. Check HL account state (direct L1 read)
 *   4. Deposit USDC to HyperLiquid
 *   5. Wait & verify deposit
 *   6. Place a small BTC market order
 *   7. Check positions
 *   8. Close all positions
 *
 * Usage:
 *   GDEX_MNEMONIC="word1 word2 ... word12" node scripts/live-hl-test.js
 */

const {
  GdexSkill,
  GDEX_API_KEY_PRIMARY,
  Endpoints,
  generateGdexSessionKeyPair,
  buildGdexSignInMessage,
  buildGdexSignInComputedData,
  buildGdexUserSessionData,
  buildHlComputedData,
} = require('../dist/index.js');

const { ethers } = require('ethers');

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

// ── Constants ───────────────────────────────────────────────────────────────

const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const ARB_CHAIN_ID = 42161;

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${B}${CYAN}═══ GDEX HyperLiquid Live Test ═══${R}\n`);

  const mnemonic = process.env.GDEX_MNEMONIC;
  if (!mnemonic) {
    fail('GDEX_MNEMONIC environment variable is required');
    process.exit(1);
  }

  const apiKey = process.env.GDEX_API_KEY || GDEX_API_KEY_PRIMARY;
  const depositAmount = process.env.DEPOSIT_AMOUNT || '10';

  // ── Step 1: Derive EVM wallet ───────────────────────────────────────────

  step(1, 'Derive EVM Wallet');
  const evmWallet = ethers.Wallet.fromPhrase(mnemonic);
  const controlAddress = evmWallet.address;
  ok(`Control wallet: ${controlAddress}`);

  // ── Step 2: Generate session keypair & sign-in ──────────────────────────

  step(2, 'Sign In (managed custody)');
  const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();
  ok(`Session key generated: ${sessionKey.slice(0, 20)}...`);

  const nonce = String(Date.now());
  const signInMessage = buildGdexSignInMessage(controlAddress, nonce, sessionKey);
  const signature = await evmWallet.signMessage(signInMessage);
  ok(`Sign-in message signed`);

  const signInPayload = buildGdexSignInComputedData({
    apiKey,
    userId: controlAddress,
    sessionKey,
    nonce,
    signature,
  });

  const skill = new GdexSkill({ timeout: 60000, maxRetries: 2 });
  skill.loginWithApiKey(apiKey);

  try {
    const signInResult = await skill.signInWithComputedData({
      computedData: signInPayload.computedData,
      chainId: 1, // EVM
    });
    ok(`Signed in! Response: ${JSON.stringify(signInResult).slice(0, 200)}`);
  } catch (err) {
    fail(`Sign-in failed: ${err.message}`);
    const body = err.responseBody || err.response?.data || '';
    if (body) info(`Body: ${JSON.stringify(body).slice(0, 300)}`);
    warn('Continuing anyway — session key may already be registered');
  }

  // ── Step 3: Resolve managed wallet ──────────────────────────────────────

  step(3, 'Resolve Managed Wallet (/v1/user)');
  let managedAddress;
  try {
    const userDataEncrypted = buildGdexUserSessionData(sessionKey, apiKey);
    const user = await skill.getManagedUser({
      userId: controlAddress,
      data: userDataEncrypted,
      chainId: 1,
    });
    ok(`User: ${JSON.stringify(user).slice(0, 300)}`);
    managedAddress = user.evmAddress || user.address || user.walletAddress;
    if (managedAddress) ok(`Managed EVM address: ${managedAddress}`);
  } catch (err) {
    fail(`User lookup failed: ${err.message}`);
    managedAddress = '0x9967179de55bd67e6b90fcc4f908556d93938c0f';
    warn(`Using known managed address: ${managedAddress}`);
  }

  if (!managedAddress) {
    managedAddress = '0x9967179de55bd67e6b90fcc4f908556d93938c0f';
    warn(`Falling back to known managed address: ${managedAddress}`);
  }

  // ── Step 4: Check HL Account State (pre-deposit) ───────────────────────

  step(4, 'Check HL Account State (pre-deposit)');
  try {
    const state = await skill.getHlAccountState(managedAddress);
    ok(`Account Value: $${state.accountValue}`);
    ok(`Withdrawable:  $${state.withdrawable}`);
    ok(`Positions:     ${state.positions.length}`);
    if (state.positions.length > 0) {
      state.positions.forEach(p => {
        info(`  ${p.coin} ${p.side} size=${p.size} entry=$${p.entryPrice} pnl=${p.unrealizedPnl}`);
      });
    }
  } catch (err) {
    fail(`Account state failed: ${err.message}`);
  }

  // ── Step 5: Deposit USDC to HyperLiquid ────────────────────────────────

  step(5, `Deposit $${depositAmount} USDC to HyperLiquid`);
  const creds = {
    apiKey,
    walletAddress: managedAddress,
    sessionPrivateKey,
  };

  try {
    const depositResult = await skill.perpDeposit({
      ...creds,
      tokenAddress: USDC_ARB,
      amount: depositAmount,
      chainId: ARB_CHAIN_ID,
    });
    ok(`Deposit result: ${JSON.stringify(depositResult)}`);
  } catch (err) {
    fail(`Deposit failed: ${err.message}`);
    const body = err.responseBody || err.response?.data || '';
    if (body) info(`Body: ${JSON.stringify(body).slice(0, 500)}`);
  }

  // ── Step 6: Wait & verify balance ───────────────────────────────────────

  step(6, 'Wait for deposit to settle (30s)');
  for (let i = 1; i <= 6; i++) {
    await sleep(5000);
    try {
      const state = await skill.getHlAccountState(managedAddress);
      const val = parseFloat(state.accountValue);
      info(`[${i * 5}s] Account value: $${state.accountValue}`);
      if (val > 0) {
        ok(`Balance confirmed: $${state.accountValue}`);
        break;
      }
    } catch { /* ignore polling errors */ }
  }

  // ── Step 7: Get BTC mark price ──────────────────────────────────────────

  step(7, 'Get BTC Mark Price');
  let btcPrice;
  try {
    btcPrice = await skill.getHlMarkPrice('BTC');
    ok(`BTC mark price: $${btcPrice.toLocaleString()}`);
  } catch (err) {
    fail(`Mark price failed: ${err.message}`);
    btcPrice = 100000; // fallback
    warn(`Using fallback price: $${btcPrice}`);
  }

  // ── Step 8: Place a small BTC market long ───────────────────────────────

  step(8, 'Place BTC Market Long (0.001 BTC)');
  try {
    const order = await skill.hlCreateOrder({
      ...creds,
      coin: 'BTC',
      isLong: true,
      price: btcPrice.toString(),
      size: '0.001',
      isMarket: true,
    });
    ok(`Order result: ${JSON.stringify(order)}`);
  } catch (err) {
    fail(`Order failed: ${err.message}`);
    const body = err.responseBody || err.response?.data || '';
    if (body) info(`Body: ${JSON.stringify(body).slice(0, 500)}`);
  }

  // ── Step 9: Check positions after trade ─────────────────────────────────

  step(9, 'Check Positions');
  await sleep(3000);
  try {
    const positions = await skill.getPerpPositions({ walletAddress: managedAddress });
    if (positions.length === 0) {
      warn('No open positions');
    } else {
      positions.forEach(p => {
        ok(`${p.coin} ${p.side.toUpperCase()} x${p.leverage}`);
        info(`  Size: ${p.size} | Entry: $${p.entryPrice} | P&L: ${p.unrealizedPnl}`);
      });
    }
  } catch (err) {
    fail(`Positions failed: ${err.message}`);
  }

  // ── Step 10: Check open orders ──────────────────────────────────────────

  step(10, 'Check Open Orders');
  try {
    const orders = await skill.getHlOpenOrders(managedAddress);
    if (orders.length === 0) {
      info('No open orders');
    } else {
      orders.forEach(o => {
        ok(`Order: ${JSON.stringify(o).slice(0, 200)}`);
      });
    }
  } catch (err) {
    fail(`Open orders failed: ${err.message}`);
  }

  // ── Step 11: Close all positions ────────────────────────────────────────

  step(11, 'Close All Positions');
  try {
    const closeResult = await skill.hlCloseAll(creds);
    ok(`Close all: ${JSON.stringify(closeResult)}`);
  } catch (err) {
    fail(`Close all failed: ${err.message}`);
    const body = err.responseBody || err.response?.data || '';
    if (body) info(`Body: ${JSON.stringify(body).slice(0, 500)}`);
  }

  // ── Done ────────────────────────────────────────────────────────────────

  console.log(`\n${B}${GREEN}═══ Live Test Complete ═══${R}\n`);
}

main().catch((err) => {
  console.error(`\n${RED}Fatal:${R}`, err);
  process.exit(1);
});
