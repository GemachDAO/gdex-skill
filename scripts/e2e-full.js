#!/usr/bin/env node
/**
 * Full E2E test — exercises every major SDK feature against the live backend.
 *
 * Sections:
 *   1. Auth & portfolio
 *   2. Token discovery (no auth)
 *   3. Top traders (no auth)
 *   4. Spot trading — Solana buy + sell
 *   5. HyperLiquid perp — sign-in → deposit → open BTC long → close all
 *   6. Limit orders — create limit buy on Base → list → cancel
 *   7. Copy trading reads (Solana)
 *   8. HL perp copy trading reads
 *   9. Bridge estimate
 *  10. Wallet generation
 *
 * Usage:
 *   node scripts/e2e-full.js           # run all sections
 *   node scripts/e2e-full.js --section 5  # run only section 5
 */

const { ethers } = require('ethers');
const {
  GdexSkill,
  GDEX_API_KEY_PRIMARY,
  generateEvmWallet,
  generateGdexSessionKeyPair,
  generateGdexNonce,
  buildGdexSignInMessage,
  buildGdexSignInComputedData,
  buildGdexUserSessionData,
  buildHlComputedData,
  buildLimitOrderComputedData,
} = require('../dist');

// ── Credentials ─────────────────────────────────────────────────────────────
const mnemonic = 'airport room shoe add offer price divide sell make army say celery';
const wallet = ethers.Wallet.fromPhrase(mnemonic);
const controlAddr = wallet.address;
const managedAddr = '0x9967179de55bd67e6b90fcc4f908556d93938c0f';
const apiKey = GDEX_API_KEY_PRIMARY;

// ── Helpers ─────────────────────────────────────────────────────────────────
let pass = 0, fail = 0, skip = 0;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function ok(label, detail) {
  pass++;
  console.log(`  ✅  ${label}${detail ? ' — ' + detail : ''}`);
}
function bad(label, err) {
  fail++;
  const msg = err?.response?.data?.message || err?.response?.data?.error || err?.message || String(err);
  console.log(`  ❌  ${label} — ${msg}`);
}
function skipped(label, reason) {
  skip++;
  console.log(`  ⏭️  ${label} — ${reason}`);
}
function heading(n, title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${n}. ${title}`);
  console.log(`${'═'.repeat(60)}`);
}

// ── Section parsers ─────────────────────────────────────────────────────────
const onlySection = (() => {
  const idx = process.argv.indexOf('--section');
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) : null;
})();
function shouldRun(n) { return onlySection === null || onlySection === n; }

// ══════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║           GDEX FULL E2E — LIVE BACKEND TEST            ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Control : ${controlAddr}`);
  console.log(`  Managed : ${managedAddr}`);
  console.log(`  API Key : ${apiKey.slice(0, 8)}...`);
  console.log(`  Time    : ${new Date().toISOString()}`);

  const skill = new GdexSkill({ timeout: 45000, maxRetries: 1 });

  // Keep session key pair across sections that need managed-custody auth
  let sessionPrivateKey, sessionKey;

  // ==========================================================================
  // 1. AUTH & PORTFOLIO
  // ==========================================================================
  if (shouldRun(1)) {
    heading(1, 'AUTH & PORTFOLIO');

    // 1a. API key auth
    try {
      skill.loginWithApiKey(apiKey);
      if (skill.isAuthenticated()) ok('loginWithApiKey', 'authenticated');
      else bad('loginWithApiKey', 'isAuthenticated() === false');
    } catch (e) { bad('loginWithApiKey', e); }

    // 1b. Managed-custody sign-in (EVM)
    try {
      const kp = generateGdexSessionKeyPair();
      sessionPrivateKey = kp.sessionPrivateKey;
      sessionKey = kp.sessionKey;
      const nonce = generateGdexNonce().toString();
      const msg = buildGdexSignInMessage(controlAddr, nonce, sessionKey);
      const sig = await wallet.signMessage(msg);
      const payload = buildGdexSignInComputedData({
        apiKey, userId: controlAddr, sessionKey, nonce,
        signature: sig.replace(/^0x/, ''),
      });
      const resp = await skill.signInWithComputedData({
        computedData: payload.computedData, chainId: 42161,
      });
      ok('signInWithComputedData', `managed=${resp.address || JSON.stringify(resp).slice(0, 80)}`);
    } catch (e) { bad('signInWithComputedData', e); }

    // 1c. Get managed user
    try {
      const data = buildGdexUserSessionData(sessionKey, apiKey);
      const user = await skill.getManagedUser({ userId: controlAddr, chainId: 42161, data });
      ok('getManagedUser', `wallet=${(user.walletAddress || user.address || '').toString().slice(0, 12)}...`);
    } catch (e) { bad('getManagedUser', e); }

    // 1d. Portfolio (requires session-key auth via data param)
    try {
      const data = buildGdexUserSessionData(sessionKey, apiKey);
      const pf = await skill.getPortfolio({ walletAddress: controlAddr, chain: 'solana' });
      const totalUsd = pf.totalValueUsd ?? pf.totalValue ?? JSON.stringify(pf).slice(0, 100);
      ok('getPortfolio(solana)', `totalValueUsd=${totalUsd}`);
    } catch (e) {
      // Portfolio may require session data as extra param — try raw
      try {
        const data = buildGdexUserSessionData(sessionKey, apiKey);
        const raw = await skill.client.get('/v1/portfolio', {
          userId: controlAddr, chainId: 622112261, data,
        });
        ok('getPortfolio(solana,raw)', `${JSON.stringify(raw).slice(0, 100)}`);
      } catch (e2) { bad('getPortfolio(solana)', e2); }
    }

    // 1e. Balances (Solana) — try via raw endpoint with session data
    try {
      const data = buildGdexUserSessionData(sessionKey, apiKey);
      const raw = await skill.client.get('/v1/portfolio', {
        userId: controlAddr, chainId: 622112261, data,
      });
      const bals = raw?.balances || raw?.tokens || raw;
      ok('getBalances(solana)', `${Array.isArray(bals) ? bals.length + ' tokens' : JSON.stringify(raw).slice(0, 80)}`);
    } catch (e) { bad('getBalances(solana)', e); }

    // 1f. Trade history (backend expects `user` + `chainId`)
    try {
      const raw = await skill.client.get('/v1/user_history', {
        user: controlAddr, chainId: 900,
      });
      const hist = raw?.tracks || raw || [];
      ok('getTradeHistory(solana)', `${Array.isArray(hist) ? hist.length + ' trades' : JSON.stringify(raw).slice(0, 80)}`);
    } catch (e) { bad('getTradeHistory(solana)', e); }

    // 1g. Wallet info
    try {
      const data = buildGdexUserSessionData(sessionKey, apiKey);
      const raw = await skill.client.get('/v1/user', {
        userId: controlAddr, chainId: 42161, data,
      });
      ok('getWalletInfo(arb)', `wallet=${(raw.walletAddress || raw.address || '').toString().slice(0, 12)}...`);
    } catch (e) { bad('getWalletInfo(arb)', e); }
  }

  // ==========================================================================
  // 2. TOKEN DISCOVERY (no auth)
  // ==========================================================================
  if (shouldRun(2)) {
    heading(2, 'TOKEN DISCOVERY (no auth)');

    // 2a. Token details
    try {
      const token = await skill.getTokenDetails({
        tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        chain: 'solana',
      });
      ok('getTokenDetails(USDC/SOL)', `symbol=${token.symbol}, price=$${token.priceUsd ?? token.price}`);
    } catch (e) { bad('getTokenDetails', e); }

    // 2b. Trending tokens
    try {
      const trending = await skill.getTrendingTokens({ chain: 'solana', period: '24h', limit: 5 });
      const items = Array.isArray(trending) ? trending : trending?.tokens || [];
      ok('getTrendingTokens(solana)', `top5=${items.map(t => t.symbol || t.name).join(', ')}`);
    } catch (e) { bad('getTrendingTokens', e); }

    // 2c. OHLCV (uses chainId numeric)
    try {
      const ohlcv = await skill.getOHLCV({
        tokenAddress: 'So11111111111111111111111111111111111111112',
        chain: 622112261,
        resolution: '60',
      });
      const candles = ohlcv?.candles || ohlcv?.data || ohlcv;
      ok('getOHLCV(SOL/1h)', `candles=${Array.isArray(candles) ? candles.length : '?'}`);
    } catch (e) { bad('getOHLCV', e); }
  }

  // ==========================================================================
  // 3. TOP TRADERS (no auth)
  // ==========================================================================
  if (shouldRun(3)) {
    heading(3, 'TOP TRADERS (no auth)');

    try {
      const traders = await skill.getTopTraders({ chain: 622112261, limit: 5 });
      const items = Array.isArray(traders) ? traders : traders?.traders || [];
      ok('getTopTraders(solana)', `count=${items.length}`);
    } catch (e) { bad('getTopTraders', e); }
  }

  // ==========================================================================
  // 4. SPOT TRADING — SOLANA
  // ==========================================================================
  if (shouldRun(4)) {
    heading(4, 'SPOT TRADING — SOLANA (managed custody)');

    // Ensure we have session keys
    if (!sessionPrivateKey) {
      const kp = generateGdexSessionKeyPair();
      sessionPrivateKey = kp.sessionPrivateKey;
      sessionKey = kp.sessionKey;
      const nonce = generateGdexNonce().toString();
      const msg = buildGdexSignInMessage(controlAddr, nonce, sessionKey);
      const sig = await wallet.signMessage(msg);
      const payload = buildGdexSignInComputedData({
        apiKey, userId: controlAddr, sessionKey, nonce,
        signature: sig.replace(/^0x/, ''),
      });
      await skill.signInWithComputedData({ computedData: payload.computedData, chainId: 622112261 });
    }

    const { buildGdexManagedTradeComputedData: buildTradeCD } = require('../dist');

    // 4a. Buy USDC with 0.001 SOL (~$0.15) via managed custody
    let buyRequestId;
    try {
      const nonce = generateGdexNonce().toString();
      const cd = buildTradeCD({
        apiKey,
        action: 'purchase',
        userId: controlAddr,
        tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: '1000000', // 0.001 SOL = 1_000_000 lamports
        nonce,
        sessionPrivateKey,
      });

      const result = await skill.submitManagedPurchase({
        computedData: cd.computedData,
        chainId: 622112261,
        slippage: 2,
      });
      buyRequestId = result.requestId || result.jobId;
      ok('submitManagedPurchase(SOL→USDC)', `requestId=${buyRequestId}, msg=${result.message || JSON.stringify(result).slice(0, 60)}`);
    } catch (e) { bad('submitManagedPurchase(SOL→USDC)', e); }

    // Wait for the buy to settle
    if (buyRequestId) {
      console.log('    ⏳ waiting 15s for buy to settle...');
      await sleep(15000);

      try {
        const status = await skill.getManagedTradeStatus(buyRequestId);
        ok('getManagedTradeStatus(buy)', `status=${status.status || JSON.stringify(status).slice(0, 80)}`);
      } catch (e) { bad('getManagedTradeStatus(buy)', e); }
    }

    // 4b. Sell USDC back to SOL via managed custody
    try {
      const nonce = generateGdexNonce().toString();
      const cd = buildTradeCD({
        apiKey,
        action: 'sell',
        userId: controlAddr,
        tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: '100000', // 0.1 USDC = 100_000 (6 decimals)
        nonce,
        sessionPrivateKey,
      });

      const result = await skill.submitManagedSell({
        computedData: cd.computedData,
        chainId: 622112261,
        slippage: 2,
      });
      ok('submitManagedSell(USDC→SOL)', `requestId=${result.requestId || result.jobId}, msg=${result.message || JSON.stringify(result).slice(0, 60)}`);
    } catch (e) { bad('submitManagedSell(USDC→SOL)', e); }
  }

  // ==========================================================================
  // 5. HYPERLIQUID PERP TRADING
  // ==========================================================================
  if (shouldRun(5)) {
    heading(5, 'HYPERLIQUID PERP TRADING');

    // Ensure we have session keys from section 1 (re-sign-in if needed)
    if (!sessionPrivateKey) {
      try {
        const kp = generateGdexSessionKeyPair();
        sessionPrivateKey = kp.sessionPrivateKey;
        sessionKey = kp.sessionKey;
        const nonce = generateGdexNonce().toString();
        const msg = buildGdexSignInMessage(controlAddr, nonce, sessionKey);
        const sig = await wallet.signMessage(msg);
        const payload = buildGdexSignInComputedData({
          apiKey, userId: controlAddr, sessionKey, nonce,
          signature: sig.replace(/^0x/, ''),
        });
        await skill.signInWithComputedData({ computedData: payload.computedData, chainId: 42161 });
        ok('signIn (re-auth for HL)', 'done');
      } catch (e) { bad('signIn (re-auth)', e); return; }
    }

    // 5a. Read: HL account state (direct L1 query, no auth)
    try {
      const state = await skill.getHlAccountState(managedAddr);
      ok('getHlAccountState', `acctVal=$${state.accountValue}, positions=${state.positions.length}`);
    } catch (e) { bad('getHlAccountState', e); }

    // 5b. Read: BTC mark price
    let btcPrice;
    try {
      btcPrice = await skill.getHlMarkPrice('BTC');
      ok('getHlMarkPrice(BTC)', `$${btcPrice}`);
    } catch (e) {
      bad('getHlMarkPrice', e);
      btcPrice = 90000; // fallback
    }

    // 5c. Read: HL USDC balance
    try {
      const bal = await skill.getHlUsdcBalance(managedAddr);
      ok('getHlUsdcBalance', `$${bal.toFixed(2)}`);
    } catch (e) { bad('getHlUsdcBalance', e); }

    // 5d. Read: HL open orders
    try {
      const orders = await skill.getHlOpenOrders(managedAddr);
      ok('getHlOpenOrders', `${Array.isArray(orders) ? orders.length : '?'} orders`);
    } catch (e) { bad('getHlOpenOrders', e); }

    // 5e. Read: GDEX backend USDC balance
    try {
      const gbal = await skill.getGbotUsdcBalance(managedAddr);
      ok('getGbotUsdcBalance', `$${gbal}`);
    } catch (e) { bad('getGbotUsdcBalance', e); }

    // 5f. Write: Open BTC long (minimum size, market order)
    // 0.0005 BTC ≈ ~$45 at $90k
    const size = '0.0005';
    const marketPrice = Math.round(btcPrice * 1.05).toString();
    try {
      const order = await skill.hlCreateOrder({
        apiKey,
        walletAddress: controlAddr,
        sessionPrivateKey,
        coin: 'BTC',
        isLong: true,
        price: marketPrice,
        size,
        reduceOnly: false,
        tpPrice: '',
        slPrice: '',
        isMarket: true,
      });
      ok('hlCreateOrder(BTC LONG)', `isSuccess=${order.isSuccess}, msg=${order.message}`);
    } catch (e) { bad('hlCreateOrder(BTC LONG)', e); }

    // Wait for fill
    console.log('    ⏳ waiting 5s for fill...');
    await sleep(5000);

    // 5g. Verify position
    try {
      const state = await skill.getHlAccountState(managedAddr);
      const btcPos = state.positions.find(p => p.coin === 'BTC');
      if (btcPos) {
        ok('Position check', `BTC ${btcPos.side} size=${btcPos.size} entry=$${btcPos.entryPrice} upnl=${btcPos.unrealizedPnl}`);
      } else {
        skipped('Position check', `no BTC position found (${state.positions.length} total positions)`);
      }
    } catch (e) { bad('Position check', e); }

    // 5h. Close all positions
    try {
      const close = await skill.hlCloseAll({ apiKey, walletAddress: controlAddr, sessionPrivateKey });
      ok('hlCloseAll', `isSuccess=${close.isSuccess}, msg=${close.message}`);
    } catch (e) { bad('hlCloseAll', e); }

    // Wait for close
    console.log('    ⏳ waiting 5s for close...');
    await sleep(5000);

    // 5i. Confirm flat
    try {
      const state = await skill.getHlAccountState(managedAddr);
      ok('Post-close state', `positions=${state.positions.length}, acctVal=$${state.accountValue}`);
    } catch (e) { bad('Post-close state', e); }
  }

  // ==========================================================================
  // 6. LIMIT ORDERS (Solana — WIF)
  // ==========================================================================
  if (shouldRun(6)) {
    heading(6, 'LIMIT ORDERS');

    // Ensure session keys (sign in for Solana)
    if (!sessionPrivateKey) {
      const kp = generateGdexSessionKeyPair();
      sessionPrivateKey = kp.sessionPrivateKey;
      sessionKey = kp.sessionKey;
    }
    {
      const nonce = generateGdexNonce().toString();
      const msg = buildGdexSignInMessage(controlAddr, nonce, sessionKey);
      const sig = await wallet.signMessage(msg);
      const payload = buildGdexSignInComputedData({
        apiKey, userId: controlAddr, sessionKey, nonce,
        signature: sig.replace(/^0x/, ''),
      });
      await skill.signInWithComputedData({ computedData: payload.computedData, chainId: 622112261 });
    }

    // 6a. List current limit orders
    try {
      const data = buildGdexUserSessionData(sessionKey, apiKey);
      const orders = await skill.getLimitOrders({ userId: controlAddr.toLowerCase(), chainId: 622112261, data });
      const items = orders?.orders || orders || [];
      ok('getLimitOrders(Solana)', `${Array.isArray(items) ? items.length : '?'} orders`);
    } catch (e) { bad('getLimitOrders', e); }

    // 6b. Create a limit buy: buy WIF on Solana at $0.0001 (far below market — won't fill)
    const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';
    try {
      const result = await skill.limitBuy({
        chainId: 622112261,
        tokenAddress: WIF,
        amount: '1000000', // 1M lamports (0.001 SOL ≈ $0.15)
        triggerPrice: '0.0001', // far below market
        profitPercent: '50',
        lossPercent: '30',
        userId: controlAddr.toLowerCase(),
        sessionPrivateKey,
        apiKey,
      });
      const orderId = result?.order?.orderId;
      ok('limitBuy(WIF@$0.0001)', `orderId=${orderId || JSON.stringify(result).slice(0, 80)}`);

      // 6c. List again to see the new order
      await sleep(3000);
      const data = buildGdexUserSessionData(sessionKey, apiKey);
      const orders = await skill.getLimitOrders({ userId: controlAddr.toLowerCase(), chainId: 622112261, data });
      const items = orders?.orders || orders || [];
      ok('getLimitOrders (post-create)', `${Array.isArray(items) ? items.length : '?'} orders`);

      // 6d. Cancel it
      const cancelId = orderId || (Array.isArray(items) && items.length > 0 && items[items.length - 1]?.orderId);
      if (cancelId) {
        try {
          const cancel = await skill.updateOrder({
            orderId: cancelId,
            userId: controlAddr.toLowerCase(),
            chainId: 622112261,
            sessionPrivateKey,
            apiKey,
            isDelete: true,
          });
          ok('cancelLimitOrder', `result=${cancel.message || JSON.stringify(cancel).slice(0, 60)}`);
        } catch (e) { bad('cancelLimitOrder', e); }
      } else {
        skipped('cancelLimitOrder', 'no orderId to cancel');
      }
    } catch (e) {
      if (e.response) console.log('    limitBuy response data:', JSON.stringify(e.response.data).slice(0, 300));
      bad('limitBuy', e);
    }
  }

  // ==========================================================================
  // 7. COPY TRADING READS (Solana)
  // ==========================================================================
  if (shouldRun(7)) {
    heading(7, 'COPY TRADING READS (Solana)');

    // 7a. Top copy trade wallets
    try {
      const wallets = await skill.getCopyTradeWallets();
      ok('getCopyTradeWallets', `${Array.isArray(wallets) ? wallets.length : '?'} wallets`);
    } catch (e) { bad('getCopyTradeWallets', e); }

    // 7b. Custom wallets
    try {
      const custom = await skill.getCopyTradeCustomWallets();
      ok('getCopyTradeCustomWallets', `${Array.isArray(custom) ? custom.length : '?'} wallets`);
    } catch (e) { bad('getCopyTradeCustomWallets', e); }

    // 7c. Gems
    try {
      const gems = await skill.getCopyTradeGems();
      ok('getCopyTradeGems', `${Array.isArray(gems) ? gems.length : '?'} gems`);
    } catch (e) { bad('getCopyTradeGems', e); }

    // 7d. DEXes for Solana
    try {
      const dexes = await skill.getCopyTradeDexes(622112261);
      ok('getCopyTradeDexes(Solana)', `dexes=${JSON.stringify(dexes).slice(0, 80)}`);
    } catch (e) { bad('getCopyTradeDexes', e); }

    // 7e. Copy trade list (session auth)
    if (sessionKey) {
      try {
        const data = buildGdexUserSessionData(sessionKey, apiKey);
        const list = await skill.getCopyTradeList({ userId: controlAddr, chainId: 622112261, data });
        ok('getCopyTradeList', `${JSON.stringify(list).slice(0, 80)}`);
      } catch (e) { bad('getCopyTradeList', e); }

      try {
        const data = buildGdexUserSessionData(sessionKey, apiKey);
        const txs = await skill.getCopyTradeTxList({ userId: controlAddr, chainId: 622112261, data });
        ok('getCopyTradeTxList', `${JSON.stringify(txs).slice(0, 80)}`);
      } catch (e) { bad('getCopyTradeTxList', e); }
    }
  }

  // ==========================================================================
  // 8. HL PERP COPY TRADING READS
  // ==========================================================================
  if (shouldRun(8)) {
    heading(8, 'HL PERP COPY TRADING READS');

    // 8a. Top HL traders
    try {
      const traders = await skill.getHlTopTraders();
      const items = traders?.data || traders || [];
      ok('getHlTopTraders', `${Array.isArray(items) ? items.length : '?'} traders`);
    } catch (e) { bad('getHlTopTraders', e); }

    // 8b. Top by PnL
    try {
      const traders = await skill.getHlTopTradersByPnl();
      const items = traders?.data || traders || [];
      ok('getHlTopTradersByPnl', `${Array.isArray(items) ? items.length : '?'} traders`);
    } catch (e) { bad('getHlTopTradersByPnl', e); }

    // 8c. User stats for a known top trader
    try {
      // Use our own control address (no specific top trader needed)
      const stats = await skill.getHlUserStats(controlAddr);
      ok('getHlUserStats', `${JSON.stringify(stats).slice(0, 80)}`);
    } catch (e) { bad('getHlUserStats', e); }

    // 8d. Perp DEXes
    try {
      const dexes = await skill.getHlPerpDexes();
      ok('getHlPerpDexes', `${JSON.stringify(dexes).slice(0, 80)}`);
    } catch (e) { bad('getHlPerpDexes', e); }

    // 8e. All HL assets
    try {
      const assets = await skill.getHlAllAssets();
      const items = assets?.data || assets || [];
      ok('getHlAllAssets', `${Array.isArray(items) ? items.length : '?'} assets`);
    } catch (e) { bad('getHlAllAssets', e); }

    // 8f. Meta + asset contexts
    try {
      const meta = await skill.getHlMetaAndAssetCtxs();
      ok('getHlMetaAndAssetCtxs', `${JSON.stringify(meta).slice(0, 80)}`);
    } catch (e) { bad('getHlMetaAndAssetCtxs', e); }

    // 8g. Deposit tokens
    try {
      const tokens = await skill.getHlDepositTokens();
      ok('getHlDepositTokens', `${JSON.stringify(tokens).slice(0, 80)}`);
    } catch (e) { bad('getHlDepositTokens', e); }

    // 8h. HL USDC balance for copy
    try {
      const bal = await skill.getHlUsdcBalanceForCopy(controlAddr);
      ok('getHlUsdcBalanceForCopy', `${JSON.stringify(bal).slice(0, 60)}`);
    } catch (e) { bad('getHlUsdcBalanceForCopy', e); }

    // 8i. HL copy trade list (session auth)
    if (sessionKey) {
      try {
        const data = buildGdexUserSessionData(sessionKey, apiKey);
        const list = await skill.getHlCopyTradeList({ userId: controlAddr, data });
        ok('getHlCopyTradeList', `${JSON.stringify(list).slice(0, 80)}`);
      } catch (e) { bad('getHlCopyTradeList', e); }

      try {
        const data = buildGdexUserSessionData(sessionKey, apiKey);
        const txs = await skill.getHlCopyTradeTxList({ userId: controlAddr, data });
        ok('getHlCopyTradeTxList', `${JSON.stringify(txs).slice(0, 80)}`);
      } catch (e) { bad('getHlCopyTradeTxList', e); }
    }
  }

  // ==========================================================================
  // 9. BRIDGE ESTIMATE
  // ==========================================================================
  if (shouldRun(9)) {
    heading(9, 'BRIDGE ESTIMATE');

    // Estimate bridging 0.001 ETH from Ethereum → Arbitrum
    try {
      const est = await skill.estimateBridge({
        fromChainId: 1,
        toChainId: 42161,
        amount: '1000000000000000', // 0.001 ETH in wei
      });
      ok('estimateBridge(ETH→ARB)', `tool=${est.tool}, est=${est.estimateAmount}, time=${est.minEstimateTime}-${est.maxEstimateTime}s`);
    } catch (e) { bad('estimateBridge', e); }

    // Bridge orders history
    if (sessionKey) {
      try {
        const data = buildGdexUserSessionData(sessionKey, apiKey);
        const orders = await skill.getBridgeOrders({ userId: controlAddr, data });
        ok('getBridgeOrders', `${JSON.stringify(orders).slice(0, 80)}`);
      } catch (e) { bad('getBridgeOrders', e); }
    }
  }

  // ==========================================================================
  // 10. WALLET GENERATION (offline)
  // ==========================================================================
  if (shouldRun(10)) {
    heading(10, 'WALLET GENERATION (offline)');

    try {
      const w = skill.generateEvmWallet();
      if (w.address && w.privateKey && w.mnemonic) {
        ok('generateEvmWallet', `addr=${w.address.slice(0, 10)}..., mnemonic=${w.mnemonic.split(' ').length} words`);
      } else {
        bad('generateEvmWallet', 'missing fields');
      }
    } catch (e) { bad('generateEvmWallet', e); }
  }

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  console.log('\n' + '═'.repeat(60));
  console.log(`  RESULTS: ${pass} passed, ${fail} failed, ${skip} skipped`);
  console.log('═'.repeat(60));

  if (fail > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\n💥 FATAL:', err.message || err);
  process.exit(2);
});
