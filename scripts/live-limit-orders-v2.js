#!/usr/bin/env node
/**
 * Live Limit Orders V2 Test — Solana
 *
 * Tests all 4 limit order endpoints:
 *   1. GET  /v1/orders       — list (already confirmed working)
 *   2. POST /v1/limit_buy    — create limit buy
 *   3. POST /v1/limit_sell   — create limit sell  
 *   4. POST /v1/update_order — update/delete order
 *
 * Usage: node scripts/live-limit-orders-v2.js
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

// ── Formatting ──────────────────────────────────────────────────────────────
const R = '\x1b[0m', B = '\x1b[1m', GREEN = '\x1b[92m', RED = '\x1b[91m';
const YELLOW = '\x1b[93m', CYAN = '\x1b[96m', DIM = '\x1b[2m';
const step = (n, t) => console.log(`\n${B}── Step ${n}: ${t} ──${R}`);
const ok = (m) => console.log(`  ${GREEN}✓${R} ${m}`);
const info = (m) => console.log(`  ${DIM}${m}${R}`);
const warn = (m) => console.log(`  ${YELLOW}⚠${R} ${m}`);
const fail = (m) => console.log(`  ${RED}✗${R} ${m}`);
const pp = (o) => JSON.stringify(o, null, 2);

// ── Constants ───────────────────────────────────────────────────────────────
const MNEMONIC = process.env.GDEX_MNEMONIC || 'airport room shoe add offer price divide sell make army say celery';
const API_KEY = process.env.GDEX_API_KEY || GDEX_API_KEY_PRIMARY;
const SOLANA_CHAIN_ID = 622112261;

// WIF token on Solana (we bought some earlier)
const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';

async function main() {
  console.log(`\n${B}${CYAN}═══ GDEX Limit Orders V2 Test (Solana) ═══${R}\n`);

  // ── Step 1: Sign In ────────────────────────────────────────────────────
  step(1, 'Sign In');
  const wallet = ethers.Wallet.fromPhrase(MNEMONIC);
  const controlAddr = wallet.address;
  ok(`Control address: ${controlAddr}`);

  const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();
  const nonce = String(Date.now());

  const signInMsg = buildGdexSignInMessage(controlAddr, nonce, sessionKey);
  const signature = await wallet.signMessage(signInMsg);
  const signInPayload = buildGdexSignInComputedData({
    apiKey: API_KEY, userId: controlAddr, sessionKey, nonce, signature,
  });
  const userData = buildGdexUserSessionData(sessionKey, API_KEY);

  const skill = new GdexSkill({ timeout: 60000, maxRetries: 1 });
  skill.loginWithApiKey(API_KEY);

  try {
    const res = await skill.signInWithComputedData({
      computedData: signInPayload.computedData,
      chainId: 1,
    });
    ok(`Signed in: ${JSON.stringify(res).slice(0, 100)}…`);
  } catch (err) {
    warn(`Sign-in: ${err.message}`);
  }

  // ── Step 2: List Orders (before) ───────────────────────────────────────
  step(2, 'List Orders (before)');
  try {
    const result = await skill.getLimitOrders({
      userId: controlAddr.toLowerCase(),
      data: userData,
      chainId: SOLANA_CHAIN_ID,
    });
    ok(`Solana orders: count=${result.count}`);
    if (result.orders.length > 0) {
      info(`First order: ${pp(result.orders[0])}`);
    }
  } catch (e) {
    fail(`getLimitOrders: ${e.message}`);
  }

  // ── Step 3: Create Limit Buy ───────────────────────────────────────────
  step(3, 'Create Limit Buy (WIF at very low price)');
  let buyOrderId = null;
  try {
    // Buy WIF when price drops to $0.0001 — won't fill, just testing the endpoint
    const result = await skill.limitBuy({
      apiKey: API_KEY,
      userId: controlAddr.toLowerCase(),
      sessionPrivateKey,
      chainId: SOLANA_CHAIN_ID,
      tokenAddress: WIF,
      amount: '1000000',     // 0.001 SOL in lamports (1_000_000 lamports)
      triggerPrice: '0.0001', // very low price — won't fill
      profitPercent: '50',
      lossPercent: '30',
    });
    ok(`limitBuy response: ${pp(result)}`);
    if (result.isSuccess && result.order) {
      buyOrderId = result.order.orderId;
      ok(`Created order ID: ${buyOrderId}`);
    } else {
      warn(`isSuccess=${result.isSuccess}, message=${result.message}`);
    }
  } catch (e) {
    fail(`limitBuy: ${e.message}`);
    if (e.data) info(`Response data: ${pp(e.data)}`);
    if (e.response?.data) info(`HTTP response: ${pp(e.response.data)}`);
  }

  // ── Step 4: List Orders (after buy) ────────────────────────────────────
  step(4, 'List Orders (after limit buy)');
  try {
    const result = await skill.getLimitOrders({
      userId: controlAddr.toLowerCase(),
      data: userData,
      chainId: SOLANA_CHAIN_ID,
    });
    ok(`Solana orders: count=${result.count}`);
    for (const o of result.orders) {
      info(`  ${o.orderId}: ${o.isBuyLimit ? 'BUY' : 'SELL'} ${o.symbol || o.toToken} @ $${o.price}`);
    }
  } catch (e) {
    fail(`getLimitOrders: ${e.message}`);
  }

  // ── Step 5: Create Limit Sell ──────────────────────────────────────────
  step(5, 'Create Limit Sell (WIF at very high price — take-profit)');
  let sellOrderId = null;
  try {
    // Sell WIF when price reaches $999 — take-profit, won't fill
    const result = await skill.limitSell({
      apiKey: API_KEY,
      userId: controlAddr.toLowerCase(),
      sessionPrivateKey,
      chainId: SOLANA_CHAIN_ID,
      tokenAddress: WIF,
      amount: '1000000',       // 1M raw units of WIF
      triggerPrice: '999.99',  // very high — won't fill
    });
    ok(`limitSell response: ${pp(result)}`);
    if (result.isSuccess && result.order) {
      sellOrderId = result.order.orderId;
      ok(`Created sell order ID: ${sellOrderId}`);
    } else {
      warn(`isSuccess=${result.isSuccess}, message=${result.message}`);
    }
  } catch (e) {
    fail(`limitSell: ${e.message}`);
    if (e.data) info(`Response data: ${pp(e.data)}`);
    if (e.response?.data) info(`HTTP response: ${pp(e.response.data)}`);
  }

  // ── Step 6: Cancel the buy order via updateOrder ───────────────────────
  if (buyOrderId) {
    step(6, `Cancel Buy Order (${buyOrderId})`);
    try {
      const result = await skill.updateOrder({
        apiKey: API_KEY,
        userId: controlAddr.toLowerCase(),
        sessionPrivateKey,
        chainId: SOLANA_CHAIN_ID,
        orderId: buyOrderId,
        isDelete: true,
      });
      ok(`updateOrder (delete) response: ${pp(result)}`);
    } catch (e) {
      fail(`updateOrder (delete): ${e.message}`);
      if (e.data) info(`Response data: ${pp(e.data)}`);
      if (e.response?.data) info(`HTTP response: ${pp(e.response.data)}`);
    }
  } else {
    step(6, 'Cancel Buy Order — SKIPPED (no order created)');
  }

  // ── Step 7: Cancel the sell order via cancelLimitOrder alias ───────────
  if (sellOrderId) {
    step(7, `Cancel Sell Order via cancelLimitOrder (${sellOrderId})`);
    try {
      const result = await skill.cancelLimitOrder({
        apiKey: API_KEY,
        userId: controlAddr.toLowerCase(),
        sessionPrivateKey,
        chainId: SOLANA_CHAIN_ID,
        orderId: sellOrderId,
      });
      ok(`cancelLimitOrder response: ${pp(result)}`);
    } catch (e) {
      fail(`cancelLimitOrder: ${e.message}`);
      if (e.data) info(`Response data: ${pp(e.data)}`);
    }
  } else {
    step(7, 'Cancel Sell Order — SKIPPED (no order created)');
  }

  // ── Step 8: Final order list ───────────────────────────────────────────
  step(8, 'Final Order List');
  try {
    const result = await skill.getLimitOrders({
      userId: controlAddr.toLowerCase(),
      data: userData,
      chainId: SOLANA_CHAIN_ID,
    });
    ok(`Final Solana orders: count=${result.count}`);
    for (const o of result.orders) {
      info(`  ${o.orderId}: ${o.isBuyLimit ? 'BUY' : 'SELL'} ${o.symbol || o.toToken} @ $${o.price} active=${o.isActive}`);
    }
  } catch (e) {
    fail(`getLimitOrders: ${e.message}`);
  }

  console.log(`\n${B}${CYAN}═══ Test Complete ═══${R}\n`);
}

main().catch(e => {
  console.error(`\n${RED}Fatal: ${e.message}${R}`);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
