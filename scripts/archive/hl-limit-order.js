#!/usr/bin/env node
/* HL limit order: place far-below-market limit buy -> verify open -> cancel. */
const fs = require('fs'), os = require('os'), path = require('path');
const { ethers } = require('ethers');
const {
  GdexSkill, GDEX_API_KEY_PRIMARY,
  generateGdexSessionKeyPair, generateGdexNonce,
  buildGdexSignInMessage, buildGdexSignInComputedData,
} = require('../../dist');

const COIN = 'BTC';
const W = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'gdex-test-wallet.json'), 'utf8'));
const apiKey = GDEX_API_KEY_PRIMARY, ctrl = W.control.address, managed = '0x0405d2c012467cdf41b12010e15fa752e59fb40b';
const wallet = new ethers.Wallet(W.control.privateKey);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const s = new GdexSkill({ timeout: 60000, maxRetries: 1 });
  s.loginWithApiKey(apiKey);
  const kp = generateGdexSessionKeyPair();
  const n = generateGdexNonce().toString();
  const sig = await wallet.signMessage(buildGdexSignInMessage(ctrl, n, kp.sessionKey));
  const p = buildGdexSignInComputedData({ apiKey, userId: ctrl, sessionKey: kp.sessionKey, nonce: n, signature: sig.replace(/^0x/, '') });
  await s.signInWithComputedData({ computedData: p.computedData, chainId: 42161 });
  const creds = { apiKey, walletAddress: ctrl, sessionPrivateKey: kp.sessionPrivateKey };

  const px = await s.getHlMarkPrice(COIN);
  const limitPx = Math.round(px * 0.66); // ~34% below market: won't fill; notional = px*0.66*0.001 > $11? -> ~$40
  const size = '0.001';
  console.log(`Mark=$${px}; placing LIMIT BUY ${size} ${COIN} @ $${limitPx} (notional ~$${(limitPx*Number(size)).toFixed(1)})`);

  // PLACE limit buy (isMarket false)
  try {
    const r = await s.hlCreateOrder({ coin: COIN, isLong: true, price: String(limitPx), size, reduceOnly: false, isMarket: false, tpPrice: '0', slPrice: '0', ...creds });
    console.log('PLACE:', JSON.stringify(r).slice(0, 160));
  } catch (e) { console.log('PLACE FAIL statusCode=', e.statusCode, 'body=', JSON.stringify(e.responseBody)); return; }

  await sleep(5000);
  // VERIFY open orders
  const oo = await s.getHlOpenOrders(managed);
  const orders = Array.isArray(oo) ? oo : (oo?.orders || []);
  console.log(`OPEN ORDERS: ${orders.length}`);
  orders.forEach((o) => console.log('  ', JSON.stringify(o).slice(0, 160)));
  const oid = orders[0]?.oid || orders[0]?.orderId;

  await sleep(2000);
  // CANCEL
  try {
    let r;
    if (oid) r = await s.hlCancelOrder({ coin: COIN, orderId: String(oid), ...creds });
    else r = await s.hlCancelAllOrders({ ...creds });
    console.log('CANCEL:', JSON.stringify(r).slice(0, 160));
  } catch (e) { console.log('CANCEL FAIL statusCode=', e.statusCode, 'body=', JSON.stringify(e.responseBody)); }

  await sleep(4000);
  const oo2 = await s.getHlOpenOrders(managed);
  const left = Array.isArray(oo2) ? oo2.length : (oo2?.orders || []).length;
  console.log(`OPEN ORDERS AFTER CANCEL: ${left}`);
  console.log('\nLIMIT ORDER CYCLE DONE');
})().catch((e) => { console.error('FATAL', e.responseBody ? JSON.stringify(e.responseBody) : e.message); process.exit(1); });
