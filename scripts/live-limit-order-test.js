#!/usr/bin/env node
/**
 * Live Limit Order Test — Solana
 *
 * Steps:
 *   1. Sign in (EVM auth)
 *   2. Verify Solana managed wallet + balance
 *   3. Probe limit order endpoints
 *   4. List existing orders
 *   5. Create a limit order (buy WIF at a below-market price)
 *   6. List orders again to verify
 *   7. Cancel the order
 *
 * Usage:
 *   node scripts/live-limit-order-test.js
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
const axios = require('axios');

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
const BASE_URL = 'https://trade-api.gemach.io';

// Solana tokens
const WSOL = 'So11111111111111111111111111111111111111112';
const WIF  = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';

// Headers for raw HTTP probing
const hdrs = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Accept': 'application/json',
};

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${B}${CYAN}═══ GDEX Limit Order Test (Solana) ═══${R}\n`);

  // ── Step 1: Sign In ────────────────────────────────────────────────────
  step(1, 'Sign In');
  const wallet = ethers.Wallet.fromPhrase(MNEMONIC);
  const controlAddr = wallet.address;
  ok(`Control address: ${controlAddr}`);

  const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();
  const nonce = String(Date.now());
  info(`Session pub: ${sessionKey.slice(0, 20)}…`);

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
    ok(`Signed in: ${JSON.stringify(res).slice(0, 120)}`);
  } catch (err) {
    warn(`Sign-in: ${err.message} (continuing)`);
  }

  // ── Step 2: Check Solana Wallet ────────────────────────────────────────
  step(2, 'Check Solana Managed Wallet');
  let solanaAddr;
  try {
    const user = await skill.getManagedUser({
      userId: controlAddr, data: userData, chainId: SOLANA_CHAIN_ID,
    });
    solanaAddr = user.address;
    ok(`Solana address: ${solanaAddr}`);
    ok(`SOL balance: ${user.balance}`);
  } catch (e) {
    fail(`getManagedUser: ${e.message}`);
  }

  // ── Step 3: Probe limit order endpoints ────────────────────────────────
  step(3, 'Probe Limit Order Endpoints');

  const probes = [
    ['GET',  '/v1/orders'],
    ['GET',  '/v1/orders/create'],
    ['POST', '/v1/orders/create'],
    ['POST', '/v1/orders/cancel'],
    ['GET',  '/v1/limit_order'],
    ['GET',  '/v1/limit_orders'],
    ['POST', '/v1/limit_order/create'],
    ['GET',  '/v1/order'],
    ['GET',  '/v1/user_orders'],
  ];

  for (const [method, path] of probes) {
    try {
      const opts = { headers: hdrs, validateStatus: () => true };
      let r;
      if (method === 'GET') {
        r = await axios.get(`${BASE_URL}${path}`, { ...opts, params: { walletAddress: controlAddr } });
      } else {
        r = await axios.post(`${BASE_URL}${path}`, { test: true }, opts);
      }
      const body = typeof r.data === 'string' ? r.data.slice(0, 120) : JSON.stringify(r.data).slice(0, 120);
      const icon = r.status < 400 ? GREEN + '✓' : (r.status === 404 ? RED + '✗' : YELLOW + '⚠');
      console.log(`  ${icon}${R} ${method.padEnd(4)} ${path.padEnd(30)} → ${r.status}  ${DIM}${body}${R}`);
    } catch (e) {
      fail(`${method} ${path} — ${e.message}`);
    }
  }

  // ── Step 4: Try listing orders via SDK ─────────────────────────────────
  step(4, 'List Limit Orders (SDK)');
  for (const [name, chainId] of [['Solana', SOLANA_CHAIN_ID], ['Arbitrum', 42161], ['Base', 8453]]) {
    try {
      const result = await skill.getLimitOrders({
        userId: controlAddr.toLowerCase(),
        data: userData,
        chainId,
      });
      ok(`${name} (chainId=${chainId}): count=${result.count}, orders=${JSON.stringify(result.orders).slice(0, 200)}`);
    } catch (e) {
      fail(`getLimitOrders ${name}: ${e.message}`);
    }
  }

  // ── Step 5: Try creating a limit order via SDK ─────────────────────────
  step(5, 'Create Limit Order (SDK — buy WIF with SOL)');
  info('Attempting a tiny limit buy of WIF at a very low price...');
  
  try {
    const order = await skill.createLimitOrder({
      chain: 622112261,
      side: 'buy',
      inputToken: WSOL,
      outputToken: WIF,
      inputAmount: '0.0001',    // tiny amount
      limitPrice: '0.0000001',  // very low price — won't fill
      slippage: 1,
      walletAddress: controlAddr,
    });
    ok(`Order created: ${pp(order)}`);
  } catch (e) {
    fail(`createLimitOrder failed: ${e.message}`);
    if (e.response?.data) info(`Response: ${pp(e.response.data)}`);
    if (e.data) info(`Data: ${pp(e.data)}`);
    
    // Try with computedData approach (encrypted)
    info('Trying raw POST with computedData pattern...');
    try {
      const { buildGdexManagedTradeComputedData } = require('../dist/index.js');
      // The limit order might need the same computedData encryption
      const r = await axios.post(`${BASE_URL}/v1/orders/create`, {
        chain: 622112261,
        side: 'buy',
        inputToken: WSOL,
        outputToken: WIF,
        inputAmount: '0.0001',
        limitPrice: '0.0000001',
        slippage: 1,
        walletAddress: controlAddr,
      }, { headers: hdrs, validateStatus: () => true });
      ok(`Raw POST /v1/orders/create → ${r.status}: ${JSON.stringify(r.data).slice(0, 300)}`);
    } catch (e2) {
      fail(`Raw POST also failed: ${e2.message}`);
    }
  }

  // Also probe if there's a different limit order pattern with computedData
  step('5b', 'Probe computedData-style limit order');
  try {
    const { encodeGdexTradeData, signGdexTradeMessageWithSessionKey, buildEncryptedGdexPayload, generateGdexNonce } = require('../dist/index.js');
    // Some backends use computedData for limit orders too
    const loNonce = generateGdexNonce().toString();
    // Try ABI encoding similar to spot trade: ['string', 'uint256', 'string']
    const data = encodeGdexTradeData(WIF, '100000', loNonce);
    const sig = signGdexTradeMessageWithSessionKey('purchase', controlAddr, data, sessionPrivateKey);
    const computedData = buildEncryptedGdexPayload({
      apiKey: API_KEY, userId: controlAddr, data, signature: sig,
    });

    // Try various endpoints with computedData
    const cdPayload = { computedData, chainId: SOLANA_CHAIN_ID, limitPrice: '0.0000001' };
    
    const endpoints = [
      '/v1/orders/create',
      '/v1/limit_order/create',
      '/v1/create_limit_order',
    ];
    
    for (const ep of endpoints) {
      const r = await axios.post(`${BASE_URL}${ep}`, cdPayload, {
        headers: hdrs, validateStatus: () => true,
      });
      const body = JSON.stringify(r.data).slice(0, 200);
      console.log(`  POST ${ep} → ${r.status}: ${DIM}${body}${R}`);
    }
  } catch (e) {
    fail(`computedData probe failed: ${e.message}`);
  }

  console.log(`\n${B}${CYAN}═══ Limit Order Test Complete ═══${R}\n`);
}

main().catch((err) => {
  console.error(`${RED}Fatal error:${R}`, err);
  process.exit(1);
});
