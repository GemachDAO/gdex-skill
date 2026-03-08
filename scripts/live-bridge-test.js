#!/usr/bin/env node
/**
 * Live Bridge Test — uses correct backend endpoints:
 *   GET  /v1/bridge/estimate_bridge
 *   POST /v1/bridge/request_bridge
 *   GET  /v1/bridge/bridge_orders
 *
 * Usage:
 *   node scripts/live-bridge-test.js
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Constants ───────────────────────────────────────────────────────────────
const MNEMONIC = process.env.GDEX_MNEMONIC || 'airport room shoe add offer price divide sell make army say celery';
const API_KEY = process.env.GDEX_API_KEY || GDEX_API_KEY_PRIMARY;

// Chain IDs
const ETH_CHAIN = 1;
const BASE_CHAIN = 8453;
const ARB_CHAIN = 42161;

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${B}${CYAN}═══ GDEX Bridge Test ═══${R}\n`);

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

  const skill = new GdexSkill({ timeout: 60000, maxRetries: 2 });
  skill.loginWithApiKey(API_KEY);

  try {
    const res = await skill.signInWithComputedData({
      computedData: signInPayload.computedData,
      chainId: 1,
    });
    ok(`Signed in: ${JSON.stringify(res).slice(0, 150)}`);
  } catch (err) {
    warn(`Sign-in: ${err.message} (continuing)`);
  }

  // ── Step 2: Get Bridge Estimate (Quote) ────────────────────────────────
  step(2, 'Get Bridge Estimate (ETH mainnet → Base)');
  
  // 0.001 ETH in wei
  const estimateParams = {
    fromChainId: ETH_CHAIN,
    toChainId: BASE_CHAIN,
    amount: '1000000000000000',  // 0.001 ETH in wei
  };
  info(`Params: ${JSON.stringify(estimateParams)}`);

  let estimate;
  try {
    estimate = await skill.estimateBridge(estimateParams);
    ok(`Estimate received!`);
    console.log(`  ${CYAN}Tool:${R}      ${estimate.tool}`);
    console.log(`  ${CYAN}From:${R}      Chain ${estimate.fromChainId}, Amount: ${estimate.fromAmount}`);
    console.log(`  ${CYAN}To:${R}        Chain ${estimate.toChainId}, Est: ${estimate.estimateAmount}`);
    console.log(`  ${CYAN}Time:${R}      ${estimate.minEstimateTime}-${estimate.maxEstimateTime}s`);
    console.log(`  ${DIM}Full:${R}`, JSON.stringify(estimate, null, 2));
  } catch (e) {
    fail(`estimateBridge failed: ${e.message}`);
  }

  // Try Arbitrum → Base too
  step('2b', 'Get Bridge Estimate (Arbitrum → Base)');
  try {
    const arbEstimate = await skill.estimateBridge({
      fromChainId: ARB_CHAIN,
      toChainId: BASE_CHAIN,
      amount: '1000000000000000',  // 0.001 ETH
    });
    ok(`Arb → Base estimate received!`);
    console.log(`  ${CYAN}Tool:${R}      ${arbEstimate.tool}`);
    console.log(`  ${CYAN}Est:${R}       ${arbEstimate.estimateAmount}`);
    console.log(`  ${CYAN}Time:${R}      ${arbEstimate.minEstimateTime}-${arbEstimate.maxEstimateTime}s`);
    if (!estimate) estimate = arbEstimate;
  } catch (e) {
    fail(`Arb estimate failed: ${e.message}`);
  }

  // ── Step 3: Get Bridge Orders (History) ────────────────────────────────
  step(3, 'Get Bridge Orders (History)');
  try {
    const orders = await skill.getBridgeOrders({
      userId: controlAddr,
      data: userData,
    });
    ok(`Bridge orders: ${orders.count}`);
    if (orders.bridgeOrders && orders.bridgeOrders.length > 0) {
      orders.bridgeOrders.forEach((o, i) => {
        info(`  #${i+1}: Chain ${o.fromChainId} → ${o.toChainId}, amount: ${o.fromAmount}, tx: ${o.txHash}`);
      });
    } else {
      info('No bridge orders yet');
    }
  } catch (e) {
    fail(`getBridgeOrders failed: ${e.message}`);
  }

  // ── Step 4: Execute Bridge (skip if no estimate / no balance) ──────────
  // We don't have ETH on mainnet/Arb in the managed wallet, so just test the
  // API response format. If you fund the wallet, uncomment to execute.
  if (estimate) {
    step(4, 'Execute Bridge (request_bridge)');
    warn('Skipping actual bridge execution — no funded EVM wallet. Uncomment to test.');
    info('Would call: skill.requestBridge({ fromChainId, toChainId, amount, userId, sessionPrivateKey, apiKey })');
    
    // Uncomment below to actually execute a bridge:
    // try {
    //   const result = await skill.requestBridge({
    //     fromChainId: ETH_CHAIN,
    //     toChainId: BASE_CHAIN,
    //     amount: '1000000000000000',  // 0.001 ETH
    //     userId: controlAddr,
    //     sessionPrivateKey,
    //     apiKey: API_KEY,
    //   });
    //   ok(`Bridge result: isSuccess=${result.isSuccess}`);
    //   if (result.hash) console.log(`  ${CYAN}TX:${R} ${result.hash}`);
    //   console.log(`  ${DIM}Full:${R}`, JSON.stringify(result, null, 2));
    // } catch (e) {
    //   fail(`requestBridge failed: ${e.message}`);
    // }
  }

  console.log(`\n${B}${CYAN}═══ Bridge Test Complete ═══${R}\n`);
}

main().catch((err) => {
  console.error(`${RED}Fatal error:${R}`, err);
  process.exit(1);
});

