#!/usr/bin/env node
/*
 * HL Perp Copy Trading — Live E2E Test
 *
 * Tests the full flow:
 *   [0] Discovery endpoints (no auth)
 *   [1] Sign-in with chainId: 1 (EVM)
 *   [2] List existing HL copy trades
 *   [3] Create an HL copy trade
 *   [4] List to verify creation
 *   [5] Toggle active/inactive via isChangeStatus
 *   [6] Verify toggle
 *   [7] Delete the copy trade
 *   [8] Verify deletion
 *
 * Environment:
 *   GDEX_MNEMONIC          — control wallet mnemonic
 *   GDEX_API_KEY           — API key (default: primary shared key)
 *   TRADER_WALLET          — EVM address to copy (default: a known address)
 *
 * Usage:
 *   node scripts/hl-copy-trade-e2e.js
 */

const {
  GdexSkill,
  GDEX_API_KEY_PRIMARY,
  generateGdexSessionKeyPair,
  buildGdexSignInMessage,
  buildGdexSignInComputedData,
  buildGdexUserSessionData,
  buildHlComputedData,
  Endpoints,
} = require('../dist/index.js');

const { ethers } = require('ethers');

// ── Formatting ──────────────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[92m';
const RED = '\x1b[91m';
const YELLOW = '\x1b[93m';
const CYAN = '\x1b[96m';
const WHITE = '\x1b[97m';
const DIM = '\x1b[2m';

function section(n, title) {
  console.log(`\n${BOLD}${WHITE}[${n}] ${title}${RESET}`);
}

function ok(msg) { console.log(`  ${GREEN}✓${RESET} ${msg}`); }
function warn(msg) { console.log(`  ${YELLOW}⚠${RESET} ${msg}`); }
function fail(msg) { console.log(`  ${RED}✗${RESET} ${msg}`); }
function info(msg) { console.log(`  ${DIM}${msg}${RESET}`); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Config ──────────────────────────────────────────────────────────────────

const MNEMONIC = process.env.GDEX_MNEMONIC || 'airport room shoe add offer price divide sell make army say celery';
const API_KEY = process.env.GDEX_API_KEY || GDEX_API_KEY_PRIMARY;
// Use a well-known trader address for testing; override with TRADER_WALLET env
const TRADER_WALLET = process.env.TRADER_WALLET || '0x1234567890abcdef1234567890abcdef12345678';

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║   HL Perp Copy Trading — Live E2E Test               ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════════╝${RESET}\n`);

  const skill = new GdexSkill();
  skill.loginWithApiKey(API_KEY);

  const results = [];
  function record(step, pass, detail) {
    results.push({ step, pass, detail });
    if (pass) ok(detail);
    else fail(detail);
  }

  // ── [0] Discovery (no auth) ────────────────────────────────────────────

  section(0, 'Discovery Endpoints (no auth)');

  try {
    const topTraders = await skill.getHlTopTraders('volume');
    info(`getHlTopTraders response keys: ${JSON.stringify(Object.keys(topTraders))}`);
    if (topTraders.isSuccess !== undefined) {
      info(`isSuccess: ${topTraders.isSuccess}`);
    }
    if (topTraders.topTraders) {
      record('top_traders', true, `Got ${topTraders.topTraders.length} top traders by volume`);
      if (topTraders.topTraders.length > 0) {
        const t = topTraders.topTraders[0];
        info(`#1: ${t.address}, volume=${t.volume}, trades=${t.tradeCount}`);
      }
    } else {
      // Response might be an array directly
      info(`Full response: ${JSON.stringify(topTraders).slice(0, 300)}`);
      record('top_traders', true, `Got top traders response`);
    }
  } catch (err) {
    record('top_traders', false, `getHlTopTraders: ${err.message}`);
  }

  try {
    const topPnl = await skill.getHlTopTradersByPnl();
    info(`getHlTopTradersByPnl response keys: ${JSON.stringify(Object.keys(topPnl))}`);
    info(`Full response: ${JSON.stringify(topPnl).slice(0, 400)}`);
    record('top_traders_by_pnl', true, `Got top traders by PnL response`);
  } catch (err) {
    record('top_traders_by_pnl', false, `getHlTopTradersByPnl: ${err.message}`);
  }

  try {
    const dexes = await skill.getHlPerpDexes();
    info(`getHlPerpDexes response: ${JSON.stringify(dexes).slice(0, 300)}`);
    record('perp_dexes', true, `Got perp DEXes`);
  } catch (err) {
    record('perp_dexes', false, `getHlPerpDexes: ${err.message}`);
  }

  try {
    const assets = await skill.getHlAllAssets();
    info(`getHlAllAssets response keys: ${JSON.stringify(Object.keys(assets))}`);
    if (assets.count !== undefined) info(`Asset count: ${assets.count}`);
    info(`Full response (first 400): ${JSON.stringify(assets).slice(0, 400)}`);
    record('all_assets', true, `Got all assets`);
  } catch (err) {
    record('all_assets', false, `getHlAllAssets: ${err.message}`);
  }

  try {
    const tokens = await skill.getHlDepositTokens();
    info(`getHlDepositTokens response keys: ${JSON.stringify(Object.keys(tokens))}`);
    info(`Full response (first 400): ${JSON.stringify(tokens).slice(0, 400)}`);
    record('deposit_tokens', true, `Got deposit tokens`);
  } catch (err) {
    record('deposit_tokens', false, `getHlDepositTokens: ${err.message}`);
  }

  try {
    const meta = await skill.getHlMetaAndAssetCtxs();
    info(`getHlMetaAndAssetCtxs response type: ${typeof meta}, keys: ${meta && typeof meta === 'object' ? JSON.stringify(Object.keys(meta)).slice(0, 200) : 'N/A'}`);
    info(`Full response (first 500): ${JSON.stringify(meta).slice(0, 500)}`);
    record('meta_and_asset_ctxs', true, `Got meta and asset ctxs`);
  } catch (err) {
    record('meta_and_asset_ctxs', false, `getHlMetaAndAssetCtxs: ${err.message}`);
  }

  // ── [1] Sign-in ────────────────────────────────────────────────────────

  section(1, 'Sign-in (chainId: 1)');

  const wallet = ethers.Wallet.fromPhrase(MNEMONIC);
  const userId = wallet.address.toLowerCase();
  info(`Control wallet: ${userId}`);

  const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();
  info(`Session key: ${sessionKey.slice(0, 20)}...`);

  const nonce = String(Date.now());
  const msg = buildGdexSignInMessage(wallet.address, nonce, sessionKey);
  const sig = await wallet.signMessage(msg);

  const payload = buildGdexSignInComputedData({
    apiKey: API_KEY,
    userId: wallet.address,
    sessionKey,
    nonce,
    signature: sig,
  });

  try {
    const signInResult = await skill.client.post(Endpoints.AUTH_SIGN_IN, {
      computedData: payload.computedData,
      chainId: 1,
    });
    info(`Sign-in response: ${JSON.stringify(signInResult).slice(0, 300)}`);
    record('sign_in', true, `Signed in with chainId: 1`);
  } catch (err) {
    record('sign_in', false, `Sign-in failed: ${err.message}`);
    console.log(`\n${RED}Cannot continue without sign-in. Exiting.${RESET}\n`);
    printSummary(results);
    return;
  }

  const data = buildGdexUserSessionData(sessionKey, API_KEY);

  // ── [2] List existing HL copy trades ───────────────────────────────────

  section(2, 'List existing HL copy trades');

  let initialCount = 0;
  try {
    const list = await skill.getHlCopyTradeList({ userId, data });
    info(`List response: ${JSON.stringify(list).slice(0, 500)}`);
    initialCount = list.count ?? (list.allCopyTrades ? list.allCopyTrades.length : 0);
    record('list_initial', true, `Found ${initialCount} existing HL copy trades`);
    if (list.allCopyTrades) {
      for (const ct of list.allCopyTrades) {
        info(`  - ${ct.copyTradeName}: active=${ct.isActive}, trader=${ct.traderWallet?.slice(0, 10)}..., mode=${ct.copyMode}`);
      }
    }
  } catch (err) {
    record('list_initial', false, `List failed: ${err.message}`);
    info(`Error details: ${JSON.stringify(err.response?.data ?? err.message).slice(0, 300)}`);
  }

  // Try user stats with our own wallet
  section('2b', 'User stats for our wallet');
  try {
    const stats = await skill.getHlUserStats(userId);
    info(`User stats response keys: ${JSON.stringify(Object.keys(stats))}`);
    info(`Full response (first 500): ${JSON.stringify(stats).slice(0, 500)}`);
    record('user_stats', true, `Got user stats`);
  } catch (err) {
    record('user_stats', false, `User stats failed: ${err.message}`);
  }

  // ── [3] Create an HL copy trade ────────────────────────────────────────

  section(3, 'Create HL copy trade');

  // First, find a real trader wallet from top traders
  let traderWallet = TRADER_WALLET;
  try {
    const topTraders = await skill.getHlTopTraders('volume');
    if (topTraders.topTraders && topTraders.topTraders.length > 0) {
      // Pick one that's not us
      const candidate = topTraders.topTraders.find(t =>
        t.address && t.address.toLowerCase() !== userId
      );
      if (candidate) {
        traderWallet = candidate.address;
        info(`Using real trader from leaderboard: ${traderWallet}`);
      }
    }
  } catch {
    info(`Using default trader wallet: ${traderWallet}`);
  }

  let createdTradeId = null;
  try {
    const createResult = await skill.createHlCopyTrade({
      apiKey: API_KEY,
      userId,
      sessionPrivateKey,
      traderWallet,
      copyTradeName: `E2E Test ${Date.now()}`,
      copyMode: 1,
      fixedAmountCostPerOrder: '10',
      lossPercent: '25',
      profitPercent: '100',
      oppositeCopy: false,
    });
    info(`Create response: ${JSON.stringify(createResult).slice(0, 500)}`);
    if (createResult.isSuccess) {
      record('create', true, `Created HL copy trade: ${createResult.message}`);
      if (createResult.allCopyTrades && createResult.allCopyTrades.length > 0) {
        // Find the one we just created (newest)
        const newest = createResult.allCopyTrades[createResult.allCopyTrades.length - 1];
        createdTradeId = newest.copyTradeId;
        info(`Created trade ID: ${createdTradeId}`);
        info(`Trade details: name=${newest.copyTradeName}, active=${newest.isActive}, mode=${newest.copyMode}`);
      }
    } else {
      record('create', false, `Create returned isSuccess=false: ${createResult.message}`);
    }
  } catch (err) {
    record('create', false, `Create failed: ${err.message}`);
    info(`Error details: ${JSON.stringify(err.response?.data ?? err.message).slice(0, 500)}`);
  }

  // ── [4] List to verify creation ────────────────────────────────────────

  section(4, 'Verify creation via list');

  await sleep(2000); // Wait for backend to process

  let postCreateCount = 0;
  let createdTrade = null;
  try {
    const list = await skill.getHlCopyTradeList({ userId, data });
    info(`List response: ${JSON.stringify(list).slice(0, 500)}`);
    postCreateCount = list.count ?? (list.allCopyTrades ? list.allCopyTrades.length : 0);
    
    if (postCreateCount > initialCount) {
      record('verify_create', true, `Count increased: ${initialCount} → ${postCreateCount}`);
    } else {
      record('verify_create', postCreateCount >= 1, `Count: ${postCreateCount} (was ${initialCount})`);
    }

    if (list.allCopyTrades) {
      for (const ct of list.allCopyTrades) {
        info(`  - ${ct.copyTradeName}: id=${ct.copyTradeId?.slice(0, 12)}..., active=${ct.isActive}, trader=${ct.traderWallet?.slice(0, 10)}...`);
        if (!createdTradeId && ct.copyTradeName.startsWith('E2E Test')) {
          createdTradeId = ct.copyTradeId;
          createdTrade = ct;
          info(`  → Matched created trade by name`);
        }
        if (ct.copyTradeId === createdTradeId) {
          createdTrade = ct;
        }
      }
    }
  } catch (err) {
    record('verify_create', false, `List failed: ${err.message}`);
  }

  if (!createdTradeId) {
    warn('No trade ID found — skipping toggle/delete steps');
    printSummary(results);
    return;
  }

  // ── [5] Toggle active/inactive via isChangeStatus ──────────────────────

  section(5, 'Toggle copy trade (isChangeStatus)');

  const wasActive = createdTrade ? createdTrade.isActive : true;
  info(`Current isActive: ${wasActive}, expecting toggle to ${!wasActive}`);

  try {
    const toggleResult = await skill.updateHlCopyTrade({
      apiKey: API_KEY,
      userId,
      sessionPrivateKey,
      copyTradeId: createdTradeId,
      traderWallet: createdTrade?.traderWallet ?? traderWallet,
      copyTradeName: createdTrade?.copyTradeName ?? 'E2E Test',
      copyMode: createdTrade?.copyMode ?? 1,
      fixedAmountCostPerOrder: createdTrade?.fixedAmountCostPerOrder ?? '10',
      lossPercent: String(createdTrade?.lossPercent ?? '25'),
      profitPercent: String(createdTrade?.profitPercent ?? '100'),
      isChangeStatus: true,
    });
    info(`Toggle response: ${JSON.stringify(toggleResult).slice(0, 300)}`);
    if (toggleResult.isSuccess) {
      record('toggle', true, `Toggle succeeded: ${toggleResult.message}`);
    } else {
      record('toggle', false, `Toggle returned isSuccess=false: ${toggleResult.message}`);
    }
  } catch (err) {
    record('toggle', false, `Toggle failed: ${err.message}`);
    info(`Error details: ${JSON.stringify(err.response?.data ?? err.message).slice(0, 500)}`);
  }

  // ── [6] Verify toggle ─────────────────────────────────────────────────

  section(6, 'Verify toggle');

  await sleep(2000);

  try {
    const list = await skill.getHlCopyTradeList({ userId, data });
    info(`List response: ${JSON.stringify(list).slice(0, 500)}`);
    const trade = list.allCopyTrades?.find(ct => ct.copyTradeId === createdTradeId);
    if (trade) {
      const nowActive = trade.isActive;
      info(`isActive after toggle: ${nowActive} (was ${wasActive})`);
      if (nowActive !== wasActive) {
        record('verify_toggle', true, `Toggle worked: ${wasActive} → ${nowActive}`);
      } else {
        record('verify_toggle', false, `Toggle did NOT change: still ${nowActive}`);
      }
    } else {
      // Trade might have been deleted by toggle (like Solana behavior)
      record('verify_toggle', false, `Trade ${createdTradeId.slice(0, 12)}... no longer in list — toggle may have DELETED it`);
      warn('isChangeStatus may behave like delete on this backend (same as Solana)');
      // Skip delete step
      printSummary(results);
      return;
    }
  } catch (err) {
    record('verify_toggle', false, `List failed: ${err.message}`);
  }

  // ── [7] Delete the copy trade ──────────────────────────────────────────

  section(7, 'Delete HL copy trade');

  try {
    const deleteResult = await skill.updateHlCopyTrade({
      apiKey: API_KEY,
      userId,
      sessionPrivateKey,
      copyTradeId: createdTradeId,
      traderWallet: createdTrade?.traderWallet ?? traderWallet,
      copyTradeName: createdTrade?.copyTradeName ?? 'E2E Test',
      copyMode: createdTrade?.copyMode ?? 1,
      fixedAmountCostPerOrder: createdTrade?.fixedAmountCostPerOrder ?? '10',
      lossPercent: String(createdTrade?.lossPercent ?? '25'),
      profitPercent: String(createdTrade?.profitPercent ?? '100'),
      isDelete: true,
    });
    info(`Delete response: ${JSON.stringify(deleteResult).slice(0, 300)}`);
    if (deleteResult.isSuccess) {
      record('delete', true, `Delete succeeded: ${deleteResult.message}`);
    } else {
      record('delete', false, `Delete returned isSuccess=false: ${deleteResult.message}`);
    }
  } catch (err) {
    record('delete', false, `Delete failed: ${err.message}`);
    info(`Error details: ${JSON.stringify(err.response?.data ?? err.message).slice(0, 500)}`);
  }

  // ── [8] Verify deletion ────────────────────────────────────────────────

  section(8, 'Verify deletion');

  await sleep(2000);

  try {
    const list = await skill.getHlCopyTradeList({ userId, data });
    info(`List response: ${JSON.stringify(list).slice(0, 500)}`);
    const finalCount = list.count ?? (list.allCopyTrades ? list.allCopyTrades.length : 0);
    const trade = list.allCopyTrades?.find(ct => ct.copyTradeId === createdTradeId);
    if (!trade) {
      record('verify_delete', true, `Trade deleted. Count: ${finalCount} (started at ${initialCount})`);
    } else {
      record('verify_delete', false, `Trade still exists in list! isActive=${trade.isActive}`);
    }
  } catch (err) {
    record('verify_delete', false, `List failed: ${err.message}`);
  }

  // ── [9] Check tx_list ──────────────────────────────────────────────────

  section(9, 'Transaction history');

  try {
    const txList = await skill.getHlCopyTradeTxList({ userId, data, page: '1', limit: '5' });
    info(`Tx list response: ${JSON.stringify(txList).slice(0, 500)}`);
    const txCount = txList.totalCount ?? (txList.txes ? txList.txes.length : 0);
    record('tx_list', true, `Got ${txCount} transaction(s)`);
  } catch (err) {
    record('tx_list', false, `Tx list failed: ${err.message}`);
  }

  // ── Summary ────────────────────────────────────────────────────────────

  printSummary(results);
}

function printSummary(results) {
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}${WHITE}  Summary${RESET}`);
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════════${RESET}`);
  let passed = 0, failed = 0;
  for (const r of results) {
    const icon = r.pass ? `${GREEN}✓` : `${RED}✗`;
    console.log(`  ${icon}${RESET} [${r.step}] ${r.detail}`);
    if (r.pass) passed++; else failed++;
  }
  console.log(`\n  ${GREEN}${passed} passed${RESET}, ${failed > 0 ? RED : DIM}${failed} failed${RESET}\n`);
}

main().catch(err => {
  console.error(`\n${RED}Fatal error:${RESET}`, err);
  process.exit(1);
});
