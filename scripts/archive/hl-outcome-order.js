#!/usr/bin/env node
/* Outcome-market order test via new SDK helpers: place far-below-market limit
 * BUY (won't fill) -> verify open -> cancel. Uses outcome 101 "Below 4.3%" Yes (#1010). */
const fs = require('fs'), os = require('os'), path = require('path');
const { ethers } = require('ethers');
const {
  GdexSkill, GDEX_API_KEY_PRIMARY,
  generateGdexSessionKeyPair, generateGdexNonce,
  buildGdexSignInMessage, buildGdexSignInComputedData,
} = require('../../dist');

const OUTCOME_ID = '101', COIN = '#1010'; // outcome 101 "Below 4.3%", Yes side
const W = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'gdex-test-wallet.json'), 'utf8'));
const apiKey = GDEX_API_KEY_PRIMARY, ctrl = W.control.address, managed = '0x0405d2c012467cdf41b12010e15fa752e59fb40b';
const wallet = new ethers.Wallet(W.control.privateKey);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dump = (e) => e.responseBody ? JSON.stringify(e.responseBody).slice(0, 220) : e.message;

(async () => {
  const s = new GdexSkill({ timeout: 60000, maxRetries: 1 });
  s.loginWithApiKey(apiKey);
  const kp = generateGdexSessionKeyPair(); const n = generateGdexNonce().toString();
  const sig = await wallet.signMessage(buildGdexSignInMessage(ctrl, n, kp.sessionKey));
  const p = buildGdexSignInComputedData({ apiKey, userId: ctrl, sessionKey: kp.sessionKey, nonce: n, signature: sig.replace(/^0x/, '') });
  await s.signInWithComputedData({ computedData: p.computedData, chainId: 1 });
  const creds = { apiKey, walletAddress: ctrl, sessionPrivateKey: kp.sessionPrivateKey };

  // account before
  try { const a = await s.getHlOutcomeAccount({ userAddress: managed, outcomeId: OUTCOME_ID }); console.log('outcome account:', JSON.stringify(a).slice(0, 160)); }
  catch (e) { console.log('outcome account ERR:', dump(e)); }

  // PLACE far-below-market limit buy (Yes @ 0.10, mid ~0.53 -> won't fill). size 110 -> ~$11 notional
  console.log(`\nPLACE limit BUY ${COIN} (outcome ${OUTCOME_ID}) @ 0.10 size 110 ...`);
  try {
    const r = await s.createHlOutcomeOrder({ outcomeId: OUTCOME_ID, coin: COIN, isBuy: true, price: '0.10', size: '110', reduceOnly: false, isMarket: false, ...creds });
    console.log('CREATE:', JSON.stringify(r).slice(0, 220));
  } catch (e) { console.log('CREATE FAIL:', dump(e)); }

  await sleep(5000);
  // verify open orders on the outcome account
  let orderId;
  try {
    const a = await s.getHlOutcomeAccount({ userAddress: managed, outcomeId: OUTCOME_ID });
    const oo = a?.openOrders || a?.data?.openOrders || [];
    console.log(`open orders: ${oo.length}`);
    oo.forEach((o) => console.log('  ', JSON.stringify(o).slice(0, 160)));
    orderId = oo[0]?.oid || oo[0]?.orderId;
  } catch (e) { console.log('verify ERR:', dump(e)); }

  await sleep(2000);
  // CANCEL
  if (orderId) {
    try { const r = await s.cancelHlOutcomeOrder({ outcomeId: OUTCOME_ID, coin: COIN, orderId: String(orderId), ...creds }); console.log('CANCEL:', JSON.stringify(r).slice(0, 160)); }
    catch (e) { console.log('CANCEL FAIL:', dump(e)); }
  } else { console.log('no orderId to cancel (order may not have rested / funding needed)'); }

  console.log('\nOUTCOME ORDER TEST DONE');
})().catch((e) => { console.error('FATAL', dump(e)); process.exit(1); });
