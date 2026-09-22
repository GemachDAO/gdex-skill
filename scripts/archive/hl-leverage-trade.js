#!/usr/bin/env node
/* Live HL leverage trade: open small BTC long -> show position -> close (reduce-only). */
const fs = require('fs'), os = require('os'), path = require('path');
const { ethers } = require('ethers');
const {
  GdexSkill, GDEX_API_KEY_PRIMARY,
  generateGdexSessionKeyPair, generateGdexNonce,
  buildGdexSignInMessage, buildGdexSignInComputedData,
} = require('../../dist');

const COIN = 'BTC', SIZE = process.env.SIZE || '0.001';
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
  console.log(`Mark ${COIN}=$${px} | opening LONG size=${SIZE} (~$${(px * Number(SIZE)).toFixed(1)} notional, ~${(px*Number(SIZE)/14.5).toFixed(1)}x effective)`);

  // OPEN long market
  try {
    const r = await s.hlCreateOrder({ coin: COIN, isLong: true, price: String(px), size: SIZE, reduceOnly: false, isMarket: true, tpPrice: '0', slPrice: '0', ...creds });
    console.log('OPEN:', JSON.stringify(r).slice(0, 160));
  } catch (e) { console.log('OPEN FAIL statusCode=', e.statusCode, 'body=', JSON.stringify(e.responseBody)); return; }

  await sleep(6000);
  // SHOW position (on managed account)
  const st = await s.getHlAccountState(managed);
  console.log(`\nPosition check — acctVal=$${st.accountValue} marginUsed pos=${st.positions.length}`);
  st.positions.forEach((p) => console.log('  ', JSON.stringify(p).slice(0, 220)));
  const pos = st.positions.find((p) => (p.coin || p.position?.coin) === COIN);
  const szi = pos ? Number(pos.size ?? pos.szi ?? pos.position?.szi) : 0;
  if (!szi) { console.log('No position detected; aborting close.'); return; }

  await sleep(3000);
  // CLOSE via reduce-only opposite market order
  const closeSize = Math.abs(szi).toString();
  try {
    const r = await s.hlCreateOrder({ coin: COIN, isLong: szi < 0, price: String(await s.getHlMarkPrice(COIN)), size: closeSize, reduceOnly: true, isMarket: true, tpPrice: '0', slPrice: '0', ...creds });
    console.log('\nCLOSE (reduce-only):', JSON.stringify(r).slice(0, 160));
  } catch (e) { console.log('CLOSE FAIL statusCode=', e.statusCode, 'body=', JSON.stringify(e.responseBody)); }

  await sleep(6000);
  const st2 = await s.getHlAccountState(managed);
  console.log(`\nAfter close — acctVal=$${st2.accountValue} withdrawable=$${st2.withdrawable} pos=${st2.positions.length}`);
  console.log('\nLEVERAGE TRADE CYCLE DONE');
})().catch((e) => { console.error('FATAL', e.responseBody ? JSON.stringify(e.responseBody) : e.message); process.exit(1); });
