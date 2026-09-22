#!/usr/bin/env node
/* Test the outcome-currency swap: USDC -> USDH -> USDC on HL spot via hlSwapCollateral. */
const fs = require('fs'), os = require('os'), path = require('path');
const { ethers } = require('ethers');
const {
  GdexSkill, GDEX_API_KEY_PRIMARY,
  generateGdexSessionKeyPair, generateGdexNonce,
  buildGdexSignInMessage, buildGdexSignInComputedData,
} = require('../../dist');

const W = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'gdex-test-wallet.json'), 'utf8'));
const apiKey = GDEX_API_KEY_PRIMARY, ctrl = W.control.address, managed = '0x0405d2c012467cdf41b12010e15fa752e59fb40b';
const wallet = new ethers.Wallet(W.control.privateKey);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dump = (e) => e.responseBody ? JSON.stringify(e.responseBody).slice(0, 200) : e.message;

async function spotBal(s) {
  const sp = await s.getHlSpotState(managed);
  const m = {};
  (sp.balances || []).forEach((b) => { if (Number(b.total) > 0) m[b.coin] = b.total; });
  return m;
}

(async () => {
  const s = new GdexSkill({ timeout: 60000, maxRetries: 1 });
  s.loginWithApiKey(apiKey);
  const kp = generateGdexSessionKeyPair(); const n = generateGdexNonce().toString();
  const sig = await wallet.signMessage(buildGdexSignInMessage(ctrl, n, kp.sessionKey));
  const p = buildGdexSignInComputedData({ apiKey, userId: ctrl, sessionKey: kp.sessionKey, nonce: n, signature: sig.replace(/^0x/, '') });
  await s.signInWithComputedData({ computedData: p.computedData, chainId: 1 });
  const creds = { apiKey, walletAddress: ctrl, sessionPrivateKey: kp.sessionPrivateKey };

  console.log('spot before:', JSON.stringify(await spotBal(s)));

  // USDC -> USDH (buy 2 USDH)
  console.log('\nSWAP USDC -> USDH (amount 11 USDH)...');
  try { const r = await s.hlSwapCollateral({ fromToken: 'USDC', toToken: 'USDH', amount: '11', ...creds }); console.log('swap1:', JSON.stringify(r).slice(0, 200)); }
  catch (e) { console.log('swap1 FAIL:', dump(e)); }

  await sleep(6000);
  const mid = await spotBal(s);
  console.log('spot after swap1:', JSON.stringify(mid));

  // USDH -> USDC (sell the USDH back)
  const usdh = Math.floor(Number(mid.USDH || 0) * 100) / 100;
  if (usdh > 0) {
    console.log(`\nSWAP USDH -> USDC (amount ${usdh} USDH)...`);
    try { const r = await s.hlSwapCollateral({ fromToken: 'USDH', toToken: 'USDC', amount: String(usdh), ...creds }); console.log('swap2:', JSON.stringify(r).slice(0, 200)); }
    catch (e) { console.log('swap2 FAIL:', dump(e)); }
    await sleep(6000);
  } else { console.log('no USDH balance to swap back'); }

  console.log('\nspot after:', JSON.stringify(await spotBal(s)));
  console.log('\nCURRENCY SWAP TEST DONE');
})().catch((e) => { console.error('FATAL', dump(e)); process.exit(1); });
