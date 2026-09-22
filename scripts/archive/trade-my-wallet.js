#!/usr/bin/env node
/*
 * Live Solana spot trade cycle through the USER-funded wallet:
 *   buy WIF with SOL -> poll status -> read holdings -> sell WIF back to SOL.
 * Control key loaded from ~/gdex-test-wallet.json. Spends real SOL.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ethers } = require('ethers');
const {
  GdexSkill, GDEX_API_KEY_PRIMARY,
  generateGdexSessionKeyPair, generateGdexNonce,
  buildGdexSignInMessage, buildGdexSignInComputedData, buildGdexUserSessionData,
  buildGdexManagedTradeComputedData,
} = require('../../dist');

const SOLANA = 622112261;
const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';
const BUY_LAMPORTS = '12000000'; // 0.012 SOL
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const W = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'gdex-test-wallet.json'), 'utf8'));
const apiKey = GDEX_API_KEY_PRIMARY;
const controlAddr = W.control.address;
const wallet = new ethers.Wallet(W.control.privateKey);

let sessionPrivateKey, sessionKey;

async function signIn(skill) {
  const kp = generateGdexSessionKeyPair();
  sessionPrivateKey = kp.sessionPrivateKey;
  sessionKey = kp.sessionKey;
  const nonce = generateGdexNonce().toString();
  const msg = buildGdexSignInMessage(controlAddr, nonce, sessionKey);
  const sig = await wallet.signMessage(msg);
  const payload = buildGdexSignInComputedData({
    apiKey, userId: controlAddr, sessionKey, nonce, signature: sig.replace(/^0x/, ''),
  });
  const resp = await skill.signInWithComputedData({ computedData: payload.computedData, chainId: SOLANA });
  return resp.address || resp.walletAddress;
}

async function wifHolding(skill) {
  const data = buildGdexUserSessionData(sessionKey, apiKey);
  const pf = await skill.client.get('/v1/portfolio', { userId: controlAddr, chainId: SOLANA, data });
  const holding = pf?.portfolio?.holding || pf?.holding || [];
  const w = holding.find(h => (h.tokenInfo?.address || h.address || '').toLowerCase() === WIF.toLowerCase());
  return { raw: w?.amount, ui: w?.uiAmount, symbol: w?.tokenInfo?.symbol };
}

async function main() {
  const skill = new GdexSkill({ timeout: 60000, maxRetries: 1 });
  skill.loginWithApiKey(apiKey);
  const managed = await signIn(skill);
  console.log('Control:', controlAddr, '\nSolana managed:', managed);

  // BUY WIF
  let buyReq;
  {
    const nonce = generateGdexNonce().toString();
    const cd = buildGdexManagedTradeComputedData({
      apiKey, action: 'purchase', userId: controlAddr, tokenAddress: WIF,
      amount: BUY_LAMPORTS, nonce, sessionPrivateKey,
    });
    const r = await skill.submitManagedPurchase({ computedData: cd.computedData, chainId: SOLANA, slippage: 5 });
    buyReq = r.requestId || r.jobId;
    console.log(`\nBUY submitted: requestId=${buyReq} msg=${r.message || ''}`);
  }

  // POLL buy status
  let status;
  for (let i = 0; i < 12; i++) {
    await sleep(6000);
    try {
      const s = await skill.getManagedTradeStatus(buyReq);
      status = s.status || JSON.stringify(s).slice(0, 100);
      console.log(`  poll ${i + 1}: status=${status}`);
      if (['completed', 'confirmed', 'success', 'error', 'failed'].includes(String(status).toLowerCase())) break;
    } catch (e) { console.log(`  poll ${i + 1}: ERR ${e.message}`); }
  }

  await sleep(4000);
  const held = await wifHolding(skill);
  console.log(`\nWIF holding after buy: ${held.ui ?? 0} (raw=${held.raw ?? 0}) symbol=${held.symbol}`);

  if (!held.raw || Number(held.raw) <= 0) {
    console.log('No WIF acquired — nothing to sell. (Buy status above tells why.)');
    return;
  }

  // SELL all WIF back to SOL
  {
    const nonce = generateGdexNonce().toString();
    const cd = buildGdexManagedTradeComputedData({
      apiKey, action: 'sell', userId: controlAddr, tokenAddress: WIF,
      amount: String(held.raw), nonce, sessionPrivateKey,
    });
    const r = await skill.submitManagedSell({ computedData: cd.computedData, chainId: SOLANA, slippage: 5 });
    const sellReq = r.requestId || r.jobId;
    console.log(`\nSELL submitted: requestId=${sellReq} msg=${r.message || ''}`);

    for (let i = 0; i < 12; i++) {
      await sleep(6000);
      try {
        const s = await skill.getManagedTradeStatus(sellReq);
        const st = s.status || JSON.stringify(s).slice(0, 100);
        console.log(`  sell poll ${i + 1}: status=${st}`);
        if (['completed', 'confirmed', 'success', 'error', 'failed'].includes(String(st).toLowerCase())) break;
      } catch (e) { console.log(`  sell poll ${i + 1}: ERR ${e.message}`); }
    }
  }

  await sleep(4000);
  const after = await wifHolding(skill);
  console.log(`\nWIF holding after sell: ${after.ui ?? 0} (raw=${after.raw ?? 0})`);
  console.log('\nDone — full buy/sell cycle executed through your wallet.');
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
