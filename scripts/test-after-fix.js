/**
 * Quick order test after backend modifications.
 */
const { ethers } = require('ethers');
const axios = require('axios');
const {
  generateGdexSessionKeyPair, generateGdexNonce,
  buildGdexSignInMessage, buildGdexSignInComputedData,
  encodeHlActionData, signHlActionMessage, buildEncryptedGdexPayload,
} = require('../dist/utils/gdexManagedCrypto');

const mnemonic = 'airport room shoe add offer price divide sell make army say celery';
const wallet = ethers.Wallet.fromPhrase(mnemonic);
const apiKey = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';
const BASE = 'https://trade-api.gemach.io/v1';
const managedAddr = '0x9967179de55bd67e6b90fcc4f908556d93938c0f';
const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Authorization': `Bearer ${apiKey}`,
};
const HL_INFO = 'https://api.hyperliquid.xyz/info';
const HL_H = { 'Content-Type': 'application/json' };

(async () => {
  // Sign in
  const kp = generateGdexSessionKeyPair();
  const nonce = generateGdexNonce().toString();
  const msg = buildGdexSignInMessage(wallet.address, nonce, kp.sessionKey);
  const sig = await wallet.signMessage(msg);
  const payload = buildGdexSignInComputedData({
    apiKey, userId: wallet.address, sessionKey: kp.sessionKey,
    nonce, signature: sig.replace(/^0x/, ''),
  });
  await axios.post(BASE + '/sign_in', {
    computedData: payload.computedData, chainId: 42161,
  }, { headers: HEADERS });
  console.log('✅ Signed in');

  // Get BTC price
  const mids = (await axios.post(HL_INFO, { type: 'allMids' }, { headers: HL_H })).data;
  const btcMid = parseFloat(mids['BTC']);
  console.log('BTC mid:', btcMid);

  // === Test 1: BTC market long ===
  console.log('\n--- Test 1: BTC market long 0.0002 ---');
  const n1 = generateGdexNonce().toString();
  const d1 = encodeHlActionData('hl_create_order', {
    coin: 'BTC', isLong: true, price: Math.round(btcMid * 1.03).toString(),
    size: '0.0002', reduceOnly: false, nonce: n1,
    tpPrice: '0', slPrice: '0', isMarket: true,
  });
  const s1 = signHlActionMessage('hl_create_order', wallet.address, d1, kp.sessionPrivateKey);
  const cd1 = buildEncryptedGdexPayload({ apiKey, userId: wallet.address, data: d1, signature: s1 });
  try {
    const resp = await axios.post(BASE + '/hl/create_order', { computedData: cd1 }, { headers: HEADERS });
    console.log('✅ SUCCESS:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('❌ FAILED:', e.response?.status, JSON.stringify(e.response?.data));
  }

  // === Test 2: ETH market long ===
  console.log('\n--- Test 2: ETH market long 0.01 ---');
  const ethMid = parseFloat(mids['ETH']);
  console.log('ETH mid:', ethMid);
  const n2 = generateGdexNonce().toString();
  const d2 = encodeHlActionData('hl_create_order', {
    coin: 'ETH', isLong: true, price: Math.round(ethMid * 1.03).toString(),
    size: '0.01', reduceOnly: false, nonce: n2,
    tpPrice: '0', slPrice: '0', isMarket: true,
  });
  const s2 = signHlActionMessage('hl_create_order', wallet.address, d2, kp.sessionPrivateKey);
  const cd2 = buildEncryptedGdexPayload({ apiKey, userId: wallet.address, data: d2, signature: s2 });
  try {
    const resp = await axios.post(BASE + '/hl/create_order', { computedData: cd2 }, { headers: HEADERS });
    console.log('✅ SUCCESS:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('❌ FAILED:', e.response?.status, JSON.stringify(e.response?.data));
  }

  // === Test 3: SOL market long ===
  console.log('\n--- Test 3: SOL market long 1.0 ---');
  const solMid = parseFloat(mids['SOL']);
  console.log('SOL mid:', solMid);
  const n3 = generateGdexNonce().toString();
  const d3 = encodeHlActionData('hl_create_order', {
    coin: 'SOL', isLong: true, price: Math.round(solMid * 1.03).toString(),
    size: '1', reduceOnly: false, nonce: n3,
    tpPrice: '0', slPrice: '0', isMarket: true,
  });
  const s3 = signHlActionMessage('hl_create_order', wallet.address, d3, kp.sessionPrivateKey);
  const cd3 = buildEncryptedGdexPayload({ apiKey, userId: wallet.address, data: d3, signature: s3 });
  try {
    const resp = await axios.post(BASE + '/hl/create_order', { computedData: cd3 }, { headers: HEADERS });
    console.log('✅ SUCCESS:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('❌ FAILED:', e.response?.status, JSON.stringify(e.response?.data));
  }

  // === Check HL L1 for fills/orders ===
  await new Promise(r => setTimeout(r, 3000));
  const fills = await axios.post(HL_INFO, { type: 'userFills', user: managedAddr }, { headers: HL_H });
  const orders = await axios.post(HL_INFO, { type: 'frontendOpenOrders', user: managedAddr }, { headers: HL_H });
  const state = await axios.post(HL_INFO, { type: 'clearinghouseState', user: managedAddr }, { headers: HL_H });
  console.log('\n=== HL L1 State After Tests ===');
  console.log('Fills:', fills.data.length);
  if (fills.data.length > 0) fills.data.slice(0, 5).forEach(f => console.log('  ', JSON.stringify(f)));
  console.log('Open orders:', orders.data.length);
  if (orders.data.length > 0) orders.data.forEach(o => console.log('  ', JSON.stringify(o)));
  console.log('Account value:', state.data.crossMarginSummary.accountValue);
  console.log('Positions:', state.data.assetPositions.length);
  if (state.data.assetPositions.length > 0) {
    state.data.assetPositions.forEach(ap => {
      const p = ap.position;
      console.log(`  ${p.coin}: size=${p.szi} entry=${p.entryPx} lev=${p.leverage?.value} pnl=${p.unrealizedPnl}`);
    });
  }

  console.log('\nDone');
})().catch(e => {
  console.error('Fatal:', e.message);
  if (e.response) console.error('Response:', e.response.status, JSON.stringify(e.response.data).slice(0, 500));
});
