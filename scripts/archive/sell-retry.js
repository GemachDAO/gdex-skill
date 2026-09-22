#!/usr/bin/env node
/* Retry selling the WIF held in the user wallet, with full status detail. */
const fs = require('fs'); const os = require('os'); const path = require('path');
const { ethers } = require('ethers');
const {
  GdexSkill, GDEX_API_KEY_PRIMARY,
  generateGdexSessionKeyPair, generateGdexNonce,
  buildGdexSignInMessage, buildGdexSignInComputedData, buildGdexUserSessionData,
  buildGdexManagedTradeComputedData,
} = require('../../dist');

const SOLANA = 622112261;
const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const W = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'gdex-test-wallet.json'), 'utf8'));
const apiKey = GDEX_API_KEY_PRIMARY;
const controlAddr = W.control.address;
const wallet = new ethers.Wallet(W.control.privateKey);
let sessionPrivateKey, sessionKey;

async function signIn(skill) {
  const kp = generateGdexSessionKeyPair();
  sessionPrivateKey = kp.sessionPrivateKey; sessionKey = kp.sessionKey;
  const nonce = generateGdexNonce().toString();
  const msg = buildGdexSignInMessage(controlAddr, nonce, sessionKey);
  const sig = await wallet.signMessage(msg);
  const payload = buildGdexSignInComputedData({ apiKey, userId: controlAddr, sessionKey, nonce, signature: sig.replace(/^0x/, '') });
  await skill.signInWithComputedData({ computedData: payload.computedData, chainId: SOLANA });
}
async function wifHolding(skill) {
  const data = buildGdexUserSessionData(sessionKey, apiKey);
  const pf = await skill.client.get('/v1/portfolio', { userId: controlAddr, chainId: SOLANA, data });
  const holding = pf?.portfolio?.holding || pf?.holding || [];
  const w = holding.find(h => (h.tokenInfo?.address || h.address || '').toLowerCase() === WIF.toLowerCase());
  return { raw: w?.amount, ui: w?.uiAmount };
}

(async () => {
  const skill = new GdexSkill({ timeout: 60000, maxRetries: 1 });
  skill.loginWithApiKey(apiKey);
  await signIn(skill);
  let held = await wifHolding(skill);
  console.log('WIF held now:', held.ui, 'raw', held.raw);
  if (!held.raw || Number(held.raw) <= 0) { console.log('Nothing to sell.'); return; }

  for (const slip of [10, 20]) {
    held = await wifHolding(skill);
    if (!held.raw || Number(held.raw) <= 0) { console.log('Sold out.'); break; }
    const nonce = generateGdexNonce().toString();
    const cd = buildGdexManagedTradeComputedData({
      apiKey, action: 'sell', userId: controlAddr, tokenAddress: WIF,
      amount: String(held.raw), nonce, sessionPrivateKey,
    });
    const r = await skill.submitManagedSell({ computedData: cd.computedData, chainId: SOLANA, slippage: slip });
    const req = r.requestId || r.jobId;
    console.log(`\nSELL slip=${slip}% req=${req}`);
    for (let i = 0; i < 15; i++) {
      await sleep(6000);
      try {
        const s = await skill.getManagedTradeStatus(req);
        console.log(`  poll ${i + 1}:`, JSON.stringify(s).slice(0, 240));
        const st = String(s.status || '').toLowerCase();
        if (['completed', 'confirmed', 'success'].includes(st)) { console.log('  -> SOLD'); return; }
        if (['error', 'failed'].includes(st)) { console.log('  -> failed, will try higher slippage'); break; }
      } catch (e) { console.log(`  poll ${i + 1}: ERR ${e.message}`); }
    }
    await sleep(4000);
  }
  const after = await wifHolding(skill);
  console.log('\nWIF held after retries:', after.ui ?? 0, 'raw', after.raw ?? 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
