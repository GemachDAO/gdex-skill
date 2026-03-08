#!/usr/bin/env node
/**
 * Live Limit Orders V3 Test — full flow with proper amounts
 */
const {
  GdexSkill,
  GDEX_API_KEY_PRIMARY,
  generateGdexSessionKeyPair,
  buildGdexSignInMessage,
  buildGdexSignInComputedData,
  buildGdexUserSessionData,
} = require('../dist/index.js');
const { ethers } = require('ethers');

const R = '\x1b[0m', B = '\x1b[1m', GREEN = '\x1b[92m', RED = '\x1b[91m';
const YELLOW = '\x1b[93m', CYAN = '\x1b[96m', DIM = '\x1b[2m';
const step = (n, t) => console.log(`\n${B}── Step ${n}: ${t} ──${R}`);
const ok = (m) => console.log(`  ${GREEN}✓${R} ${m}`);
const info = (m) => console.log(`  ${DIM}${m}${R}`);
const warn = (m) => console.log(`  ${YELLOW}⚠${R} ${m}`);
const fail = (m) => console.log(`  ${RED}✗${R} ${m}`);
const pp = (o) => JSON.stringify(o, null, 2);

const MNEMONIC = 'airport room shoe add offer price divide sell make army say celery';
const API_KEY = GDEX_API_KEY_PRIMARY;
const SOLANA_CHAIN_ID = 622112261;
const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';

async function main() {
  console.log(`\n${B}${CYAN}═══ GDEX Limit Orders V3 Full Test ═══${R}\n`);

  // ── Step 1: Sign In ──
  step(1, 'Sign In');
  const wallet = ethers.Wallet.fromPhrase(MNEMONIC);
  const controlAddr = wallet.address;
  const userId = controlAddr.toLowerCase();
  ok(`Control: ${controlAddr}`);

  const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();
  const nonce = String(Date.now());
  const signInMsg = buildGdexSignInMessage(controlAddr, nonce, sessionKey);
  const sig = await wallet.signMessage(signInMsg);
  const signInPayload = buildGdexSignInComputedData({
    apiKey: API_KEY, userId: controlAddr, sessionKey, nonce, signature: sig,
  });
  const userData = buildGdexUserSessionData(sessionKey, API_KEY);

  const skill = new GdexSkill({ timeout: 60000, maxRetries: 1, debug: true });
  skill.loginWithApiKey(API_KEY);
  await skill.signInWithComputedData({ computedData: signInPayload.computedData, chainId: 1 });
  ok('Signed in');

  // ── Step 2: Check balance ──
  step(2, 'Check Solana balance');
  const user = await skill.getManagedUser({ userId, data: userData, chainId: SOLANA_CHAIN_ID });
  ok(`Solana wallet: ${user.address}, balance: ${user.balance} SOL`);

  // ── Step 3: List existing orders ──
  step(3, 'List existing orders');
  let ordersBefore = await skill.getLimitOrders({ userId, data: userData, chainId: SOLANA_CHAIN_ID });
  ok(`Orders before: count=${ordersBefore.count}`);
  for (const o of ordersBefore.orders) {
    info(`  ${o.orderId}: ${o.isBuyLimit?'BUY':'SELL'} ${o.symbol||o.toToken} @ $${o.price} active=${o.isActive}`);
  }

  // ── Step 4: Limit Buy with higher amount ──
  step(4, 'Limit Buy — WIF at $0.0001 trigger (10M lamports = 0.01 SOL)');
  let buyResult = null;
  try {
    buyResult = await skill.limitBuy({
      apiKey: API_KEY,
      userId,
      sessionPrivateKey,
      chainId: SOLANA_CHAIN_ID,
      tokenAddress: WIF,
      amount: '10000000',      // 10M lamports = 0.01 SOL (min limit order)
      triggerPrice: '0.0001',  // very low price
      profitPercent: '50',
      lossPercent: '30',
    });
    ok(`limitBuy: ${pp(buyResult)}`);
  } catch (e) {
    fail(`limitBuy: ${e.message}`);
    // Try to extract error details
    if (e.data) info(`Data: ${pp(e.data)}`);
    if (e.response) info(`Status: ${e.response.status}, Body: ${JSON.stringify(e.response.data).slice(0, 500)}`);
    // Try with even larger amount
    warn('Retrying with 100M lamports (0.1 SOL)...');
    try {
      buyResult = await skill.limitBuy({
        apiKey: API_KEY,
        userId,
        sessionPrivateKey,
        chainId: SOLANA_CHAIN_ID,
        tokenAddress: WIF,
        amount: '100000000',     // 100M lamports = 0.1 SOL
        triggerPrice: '0.0001',
        profitPercent: '50',
        lossPercent: '30',
      });
      ok(`limitBuy (retry): ${pp(buyResult)}`);
    } catch (e2) {
      fail(`limitBuy retry: ${e2.message}`);
      if (e2.response) info(`Status: ${e2.response.status}, Body: ${JSON.stringify(e2.response.data).slice(0, 500)}`);
    }
  }

  // ── Step 5: List orders again to get order IDs ──
  step(5, 'List orders (after buy)');
  let ordersAfterBuy = await skill.getLimitOrders({ userId, data: userData, chainId: SOLANA_CHAIN_ID });
  ok(`Orders after buy: count=${ordersAfterBuy.count}`);
  for (const o of ordersAfterBuy.orders) {
    info(`  ${o.orderId}: ${o.isBuyLimit?'BUY':'SELL'} ${o.symbol||o.toToken} @ $${o.price}`);
  }

  // ── Step 6: Delete/cancel ALL active orders via updateOrder ──
  step(6, 'Cancel all active orders via updateOrder');
  for (const o of ordersAfterBuy.orders) {
    if (!o.isActive) continue;
    try {
      const deleteResult = await skill.updateOrder({
        apiKey: API_KEY,
        userId,
        sessionPrivateKey,
        chainId: SOLANA_CHAIN_ID,
        orderId: o.orderId,
        isDelete: true,
      });
      ok(`Deleted ${o.orderId.slice(0,16)}…: ${pp(deleteResult)}`);
    } catch (e) {
      fail(`Delete ${o.orderId.slice(0,16)}…: ${e.message}`);
      if (e.response) info(`Status: ${e.response.status}, Body: ${JSON.stringify(e.response.data).slice(0, 300)}`);
    }
  }

  // ── Step 7: Final order list ──
  step(7, 'Final order list');
  const finalOrders = await skill.getLimitOrders({ userId, data: userData, chainId: SOLANA_CHAIN_ID });
  ok(`Final orders: count=${finalOrders.count}`);
  for (const o of finalOrders.orders) {
    info(`  ${o.orderId.slice(0,16)}…: ${o.isBuyLimit?'BUY':'SELL'} @ $${o.price} active=${o.isActive}`);
  }

  console.log(`\n${B}${CYAN}═══ Test Complete ═══${R}\n`);
}

main().catch(e => {
  console.error(`\n${RED}Fatal: ${e.message}${R}`);
  process.exit(1);
});
