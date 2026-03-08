#!/usr/bin/env node
/**
 * Full E2E Copy Trading Test
 *
 * Flow:
 *   1. Sign in (mnemonic → session key → computedData)
 *   2. Check SOL balance
 *   3. Discovery: wallets, custom_wallets, gems, dexes
 *   4. List existing copy trades (session-key auth)
 *   5. List tx history (session-key auth)
 *   6. Create a copy trade (computedData auth)
 *   7. Verify it appears in list
 *   8. Toggle it inactive
 *   9. Delete it
 *  10. Verify it's gone
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

const R = '\x1b[0m', B = '\x1b[1m', G = '\x1b[92m', RED = '\x1b[91m';
const Y = '\x1b[93m', C = '\x1b[96m', D = '\x1b[2m';
const step = (n, t) => console.log(`\n${B}── Step ${n}: ${t} ──${R}`);
const ok = (m) => console.log(`  ${G}✓${R} ${m}`);
const info = (m) => console.log(`  ${D}${m}${R}`);
const warn = (m) => console.log(`  ${Y}⚠${R} ${m}`);
const fail = (m) => console.log(`  ${RED}✗${R} ${m}`);
const pp = (o) => JSON.stringify(o, null, 2).slice(0, 600);

const MNEMONIC = 'airport room shoe add offer price divide sell make army say celery';
const API_KEY = GDEX_API_KEY_PRIMARY;
const SOLANA = 622112261;

// A known top trader from previous tests
const TEST_TRADER = '5M8ACGKEXG1ojKDTMH3sMqhTihTgHYMSsZc6W8i7QW3Y';

async function main() {
  console.log(`\n${B}${C}═══ GDEX Copy Trading Full E2E Test ═══${R}\n`);

  // ══════════════════════════════════════════════════════════════
  // Step 1: Sign In
  // ══════════════════════════════════════════════════════════════
  step(1, 'Sign In');
  const wallet = ethers.Wallet.fromPhrase(MNEMONIC);
  const controlAddr = wallet.address;
  const userId = controlAddr.toLowerCase();
  ok(`Control wallet: ${controlAddr}`);

  const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();
  const nonce = String(Date.now());
  const signInMsg = buildGdexSignInMessage(controlAddr, nonce, sessionKey);
  const sig = await wallet.signMessage(signInMsg);
  const signInPayload = buildGdexSignInComputedData({
    apiKey: API_KEY, userId: controlAddr, sessionKey, nonce, signature: sig,
  });
  const userData = buildGdexUserSessionData(sessionKey, API_KEY);

  const skill = new GdexSkill({ timeout: 60000, maxRetries: 1 });
  skill.loginWithApiKey(API_KEY);
  await skill.signInWithComputedData({ computedData: signInPayload.computedData, chainId: 1 });
  ok('Signed in successfully');
  info(`Session key: ${sessionKey.slice(0, 12)}...`);

  // ══════════════════════════════════════════════════════════════
  // Step 2: Check SOL balance
  // ══════════════════════════════════════════════════════════════
  step(2, 'Check SOL balance');
  try {
    const user = await skill.getManagedUser({ userId, data: userData, chainId: SOLANA });
    ok(`Solana wallet: ${user.address}`);
    ok(`Balance: ${user.balance} SOL`);
    if (parseFloat(user.balance) < 0.01) {
      warn('Balance is low — write operations may fail if they require SOL');
    }
  } catch (e) {
    warn(`Could not check balance: ${e.message}`);
  }

  // ══════════════════════════════════════════════════════════════
  // Step 3: Discovery endpoints (no auth)
  // ══════════════════════════════════════════════════════════════
  step(3, 'Discovery endpoints');

  const wallets = await skill.getCopyTradeWallets();
  ok(`Wallets by PnL: ${wallets.length} (top: ${wallets[0]?.address?.slice(0,12)}... PnL=$${wallets[0]?.totalPnl?.toFixed(2)})`);

  const custom = await skill.getCopyTradeCustomWallets();
  ok(`Wallets by net: ${custom.length} (top: ${custom[0]?.address?.slice(0,12)}... net=$${custom[0]?.receivedMinusSpent?.toFixed(2)})`);

  const gems = await skill.getCopyTradeGems();
  ok(`Gems: ${gems.length} tokens`);

  const dexResp = await skill.getCopyTradeDexes(SOLANA);
  ok(`DEXes: ${dexResp.dexes?.length} — ${dexResp.dexes?.map(d => d.dexName).join(', ')}`);

  // ══════════════════════════════════════════════════════════════
  // Step 4: List existing copy trades (session-key auth)
  // ══════════════════════════════════════════════════════════════
  step(4, 'List existing copy trades');
  let listResult;
  try {
    listResult = await skill.getCopyTradeList({ userId, data: userData });
    ok(`Copy trades: ${listResult.count ?? 0}`);
    info(`Response keys: ${Object.keys(listResult).join(', ')}`);
    if (listResult.allCopyTrades?.length > 0) {
      for (const ct of listResult.allCopyTrades) {
        info(`  "${ct.copyTradeName}" → ${ct.traderWallet?.slice(0,12)}... active=${ct.isActive} txCount=${ct.txCount??0}`);
      }
    }
    if (listResult.dexes?.length > 0) {
      info(`  DEXes in list response: ${listResult.dexes.length}`);
    }
  } catch (e) {
    fail(`List copy trades failed: ${e.message}`);
    if (e.response?.data) info(`Backend: ${JSON.stringify(e.response.data).slice(0, 300)}`);
  }

  // ══════════════════════════════════════════════════════════════
  // Step 5: Transaction history (session-key auth)
  // ══════════════════════════════════════════════════════════════
  step(5, 'Copy trade transaction history');
  try {
    const txResult = await skill.getCopyTradeTxList({ userId, data: userData });
    ok(`Transactions: ${txResult.count ?? 0}`);
    info(`Response keys: ${Object.keys(txResult).join(', ')}`);
    if (txResult.txes?.length > 0) {
      for (const tx of txResult.txes.slice(0, 3)) {
        info(`  ${tx.isBuy ? 'BUY' : 'SELL'} ${tx.tokenInfo?.symbol || tx.token?.slice(0,8)} @ $${tx.priceUsd} PnL=${tx.pnlPercentage}%`);
      }
    }
  } catch (e) {
    fail(`Tx history failed: ${e.message}`);
    if (e.response?.data) info(`Backend: ${JSON.stringify(e.response.data).slice(0, 300)}`);
  }

  // ══════════════════════════════════════════════════════════════
  // Step 6: Create a copy trade
  // ══════════════════════════════════════════════════════════════
  step(6, 'Create copy trade');
  let createResult;
  try {
    createResult = await skill.createCopyTrade({
      apiKey: API_KEY,
      userId,
      sessionPrivateKey,
      chainId: SOLANA,
      traderWallet: TEST_TRADER,
      copyTradeName: 'E2E Test Trader',
      buyMode: 1,                // fixed SOL amount
      copyBuyAmount: '0.001',   // tiny: 0.001 SOL per copy
      lossPercent: '50',         // 50% stop-loss
      profitPercent: '100',      // 100% take-profit
      copySell: true,
      isBuyExistingToken: false,
      excludedDexNumbers: [],
    });
    ok(`Create response: ${JSON.stringify(createResult).slice(0, 500)}`);
    if (createResult.isSuccess) {
      ok(`Created! Now have ${createResult.allCopyTrades?.length} copy trades`);
    }
  } catch (e) {
    fail(`Create failed: ${e.message}`);
    if (e.response?.data) {
      info(`Backend response: ${JSON.stringify(e.response.data).slice(0, 500)}`);
    }
    // If it's a duplicate error (104), that's fine — means it already exists
    if (e.response?.data?.code === 104) {
      warn('Duplicate — this copy trade already exists, continuing...');
    }
  }

  // ══════════════════════════════════════════════════════════════
  // Step 7: Verify it shows up in list
  // ══════════════════════════════════════════════════════════════
  step(7, 'Verify copy trade in list');
  try {
    const list2 = await skill.getCopyTradeList({ userId, data: userData });
    ok(`Copy trades now: ${list2.count ?? list2.allCopyTrades?.length ?? 0}`);
    const found = list2.allCopyTrades?.find(ct => ct.traderWallet === TEST_TRADER);
    if (found) {
      ok(`Found! "${found.copyTradeName}" id=${found.copyTradeId} active=${found.isActive}`);
      info(`  buyMode=${found.buyMode} fixedAmt=${found.copyBuyFixedAmount} loss=${found.lossPercent}% profit=${found.profitPercent}%`);

      // ══════════════════════════════════════════════════════════
      // Step 8: Toggle inactive
      // ══════════════════════════════════════════════════════════
      step(8, 'Toggle copy trade inactive');
      try {
        const toggleResult = await skill.updateCopyTrade({
          apiKey: API_KEY,
          userId,
          sessionPrivateKey,
          chainId: SOLANA,
          copyTradeId: found.copyTradeId,
          traderWallet: found.traderWallet,
          copyTradeName: found.copyTradeName,
          buyMode: found.buyMode,
          copyBuyAmount: found.buyMode === 1 ? (found.copyBuyFixedAmount || '0.001') : String(found.copyBuyPercent || 50),
          lossPercent: String(found.lossPercent),
          profitPercent: String(found.profitPercent),
          copySell: found.copySell,
          isChangeStatus: true,   // <── toggle
        });
        ok(`Toggle response: ${JSON.stringify(toggleResult).slice(0, 300)}`);
      } catch (e) {
        fail(`Toggle failed: ${e.message}`);
        if (e.response?.data) info(`Backend: ${JSON.stringify(e.response.data).slice(0, 300)}`);
      }

      // Check status after toggle
      try {
        const list3 = await skill.getCopyTradeList({ userId, data: userData });
        const toggled = list3.allCopyTrades?.find(ct => ct.copyTradeId === found.copyTradeId);
        if (toggled) {
          ok(`After toggle: active=${toggled.isActive} (was ${found.isActive})`);
        }
      } catch (e) {
        warn(`Could not verify toggle: ${e.message}`);
      }

      // ══════════════════════════════════════════════════════════
      // Step 9: Delete the copy trade
      // ══════════════════════════════════════════════════════════
      step(9, 'Delete copy trade');
      try {
        const deleteResult = await skill.updateCopyTrade({
          apiKey: API_KEY,
          userId,
          sessionPrivateKey,
          chainId: SOLANA,
          copyTradeId: found.copyTradeId,
          traderWallet: found.traderWallet,
          copyTradeName: found.copyTradeName,
          buyMode: found.buyMode,
          copyBuyAmount: found.buyMode === 1 ? (found.copyBuyFixedAmount || '0.001') : String(found.copyBuyPercent || 50),
          lossPercent: String(found.lossPercent),
          profitPercent: String(found.profitPercent),
          isDelete: true,   // <── delete
        });
        ok(`Delete response: ${JSON.stringify(deleteResult).slice(0, 300)}`);
      } catch (e) {
        fail(`Delete failed: ${e.message}`);
        if (e.response?.data) info(`Backend: ${JSON.stringify(e.response.data).slice(0, 300)}`);
      }

      // ══════════════════════════════════════════════════════════
      // Step 10: Verify deletion
      // ══════════════════════════════════════════════════════════
      step(10, 'Verify deletion');
      try {
        const list4 = await skill.getCopyTradeList({ userId, data: userData });
        const gone = list4.allCopyTrades?.find(ct => ct.copyTradeId === found.copyTradeId);
        if (!gone) {
          ok(`Confirmed deleted — copy trade no longer in list`);
        } else {
          warn(`Still found in list: active=${gone.isActive}`);
        }
        ok(`Final copy trade count: ${list4.count ?? list4.allCopyTrades?.length ?? 0}`);
      } catch (e) {
        warn(`Could not verify deletion: ${e.message}`);
      }

    } else {
      warn('Copy trade not found in list after creation — may need different lookup');
      info(`Available: ${list2.allCopyTrades?.map(ct => ct.traderWallet?.slice(0,12)).join(', ')}`);
    }
  } catch (e) {
    fail(`List after create failed: ${e.message}`);
    if (e.response?.data) info(`Backend: ${JSON.stringify(e.response.data).slice(0, 300)}`);
  }

  // ══════════════════════════════════════════════════════════════
  console.log(`\n${B}${C}═══ E2E Test Complete ═══${R}\n`);
}

main().catch(e => {
  console.error(`\n${RED}FATAL:${R}`, e.message);
  if (e.response?.data) console.error('Backend:', JSON.stringify(e.response.data).slice(0, 500));
  process.exit(1);
});
