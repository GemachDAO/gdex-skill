/**
 * Test withdraw to verify managed wallet key works for HL L1 actions.
 * Also test SOL, and try different tp/sl combinations.
 */
const { ethers } = require('ethers');
const axios = require('axios');
const {
  generateGdexSessionKeyPair, generateGdexNonce,
  buildGdexSignInMessage, buildGdexSignInComputedData,
  encodeHlActionData, signHlActionMessage, buildEncryptedGdexPayload,
  encryptGdexComputedData,
} = require('../dist/utils/gdexManagedCrypto');

const mnemonic = 'airport room shoe add offer price divide sell make army say celery';
const wallet = ethers.Wallet.fromPhrase(mnemonic);
const apiKey = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';
const BASE = 'https://trade-api.gemach.io/v1';
const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Authorization': 'Bearer ' + apiKey,
};

async function signIn() {
  const kp = generateGdexSessionKeyPair();
  const nonce = generateGdexNonce().toString();
  const msg = buildGdexSignInMessage(wallet.address, nonce, kp.sessionKey);
  const sig = await wallet.signMessage(msg);
  const payload = buildGdexSignInComputedData({
    apiKey, userId: wallet.address, sessionKey: kp.sessionKey,
    nonce, signature: sig.replace(/^0x/, ''),
  });
  const resp = await axios.post(BASE + '/sign_in', {
    computedData: payload.computedData, chainId: 42161,
  }, { headers: HEADERS });
  console.log('Sign in:', resp.data);
  return kp;
}

function buildOrder(kp, params) {
  const orderNonce = generateGdexNonce().toString();
  const data = encodeHlActionData('hl_create_order', { ...params, nonce: orderNonce });
  const signature = signHlActionMessage('hl_create_order', wallet.address, data, kp.sessionPrivateKey);
  return buildEncryptedGdexPayload({ apiKey, userId: wallet.address, data, signature });
}

async function tryOrder(kp, label, params) {
  try {
    const cd = buildOrder(kp, params);
    const resp = await axios.post(BASE + '/hl/create_order', { computedData: cd }, { headers: HEADERS });
    console.log(`✅ ${label}:`, JSON.stringify(resp.data));
    return true;
  } catch (e) {
    console.log(`❌ ${label}: ${e.response?.status} ${JSON.stringify(e.response?.data)}`);
    return false;
  }
}

(async () => {
  const kp = await signIn();

  // === Test 1: Try withdraw (diagnostic for managed wallet key) ===
  console.log('\n=== Test 1: Withdraw 0.1 USDC ===');
  try {
    const wNonce = generateGdexNonce().toString();
    const wData = encodeHlActionData('hl_withdraw', { amount: '0.1', nonce: wNonce });
    const wSig = signHlActionMessage('hl_withdraw', wallet.address, wData, kp.sessionPrivateKey);
    const wCd = buildEncryptedGdexPayload({ apiKey, userId: wallet.address, data: wData, signature: wSig });
    const resp = await axios.post(BASE + '/hl/withdraw', { computedData: wCd }, { headers: HEADERS });
    console.log('✅ Withdraw response:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('❌ Withdraw:', e.response?.status, JSON.stringify(e.response?.data));
  }

  // === Test 2: Try SOL (szDecimals=2, maxLeverage=20) ===
  console.log('\n=== Test 2: SOL order ===');
  const solResp = await axios.post('https://api.hyperliquid.xyz/info', { type: 'allMids' }, { headers: { 'Content-Type': 'application/json' } });
  const solMid = parseFloat(solResp.data['SOL']);
  console.log('SOL mid:', solMid);
  
  const solSize = '1'; // 1 SOL ~$150, at 20x = $7.5 margin
  await tryOrder(kp, 'SOL market long', {
    coin: 'SOL', isLong: true, price: Math.round(solMid * 1.03).toString(),
    size: solSize, reduceOnly: false, tpPrice: '0', slPrice: '0', isMarket: true,
  });

  // === Test 3: Try ETH with different params ===
  const ethMid = parseFloat(solResp.data['ETH']);
  console.log('\nETH mid:', ethMid);
  
  // Minimum ETH size: 0.01 at $2500 = $25, at 25x = $1 margin
  await tryOrder(kp, 'ETH market long 0.01', {
    coin: 'ETH', isLong: true, price: Math.round(ethMid * 1.03).toString(),
    size: '0.01', reduceOnly: false, tpPrice: '0', slPrice: '0', isMarket: true,
  });

  // === Test 4: Try BTC with string "false"/"true" instead of boolean ===
  // What if the GDEX frontend passes strings instead of booleans for reduceOnly/isMarket?
  const btcMid = parseFloat(solResp.data['BTC']);
  console.log('\nBTC mid:', btcMid);
  
  // Actually, ABI encode requires boolean types. But what if the frontend
  // uses a different approach?

  // === Test 5: Try with very aggressive limit price (above market) ===
  console.log('\n=== Test 5: Aggressive limit BTC (above market) ===');
  await tryOrder(kp, 'BTC aggressive limit', {
    coin: 'BTC', isLong: true, price: Math.round(btcMid * 1.05).toString(),
    size: '0.0002', reduceOnly: false, tpPrice: '0', slPrice: '0', isMarket: false,
  });

  // === Test 6: Try hl_place_order instead ===
  console.log('\n=== Test 6: hl_place_order ===');
  try {
    const pNonce = generateGdexNonce().toString();
    const pData = encodeHlActionData('hl_place_order', {
      coin: 'BTC', isLong: true, price: Math.round(btcMid * 1.03).toString(),
      size: '0.0002', reduceOnly: false, nonce: pNonce,
    });
    const pSig = signHlActionMessage('hl_place_order', wallet.address, pData, kp.sessionPrivateKey);
    const pCd = buildEncryptedGdexPayload({ apiKey, userId: wallet.address, data: pData, signature: pSig });
    const resp = await axios.post(BASE + '/hl/place_order', { computedData: pCd }, { headers: HEADERS });
    console.log('✅ Place order:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('❌ Place order:', e.response?.status, JSON.stringify(e.response?.data));
  }

  // === Test 7: Try close_all (even with no positions, to test if it reaches HL) ===
  console.log('\n=== Test 7: close_all_positions ===');
  try {
    const cNonce = generateGdexNonce().toString();
    const cData = encodeHlActionData('hl_close_all', { nonce: cNonce });
    const cSig = signHlActionMessage('hl_close_all', wallet.address, cData, kp.sessionPrivateKey);
    const cCd = buildEncryptedGdexPayload({ apiKey, userId: wallet.address, data: cData, signature: cSig });
    const resp = await axios.post(BASE + '/hl/close_all_positions', { computedData: cCd }, { headers: HEADERS });
    console.log('✅ Close all:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('❌ Close all:', e.response?.status, JSON.stringify(e.response?.data));
  }

  // === Test 8: cancel_all_orders ===
  console.log('\n=== Test 8: cancel_all_orders ===');
  try {
    const canNonce = generateGdexNonce().toString();
    const canData = encodeHlActionData('hl_cancel_all_orders', { nonce: canNonce });
    const canSig = signHlActionMessage('hl_cancel_all_orders', wallet.address, canData, kp.sessionPrivateKey);
    const canCd = buildEncryptedGdexPayload({ apiKey, userId: wallet.address, data: canData, signature: canSig });
    const resp = await axios.post(BASE + '/hl/cancel_all_orders', { computedData: canCd }, { headers: HEADERS });
    console.log('✅ Cancel all:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('❌ Cancel all:', e.response?.status, JSON.stringify(e.response?.data));
  }

  // === Test 9: Try sending additional body fields that frontend might send ===
  console.log('\n=== Test 9: create_order with chainId in body ===');
  try {
    const n9 = generateGdexNonce().toString();
    const d9 = encodeHlActionData('hl_create_order', {
      coin: 'BTC', isLong: true, price: Math.round(btcMid * 1.03).toString(),
      size: '0.0002', reduceOnly: false, nonce: n9,
      tpPrice: '0', slPrice: '0', isMarket: true,
    });
    const s9 = signHlActionMessage('hl_create_order', wallet.address, d9, kp.sessionPrivateKey);
    const cd9 = buildEncryptedGdexPayload({ apiKey, userId: wallet.address, data: d9, signature: s9 });
    // Send with extra body fields
    const resp = await axios.post(BASE + '/hl/create_order', 
      { computedData: cd9, chainId: 42161 }, 
      { headers: HEADERS });
    console.log('✅:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('❌:', e.response?.status, JSON.stringify(e.response?.data));
  }

  console.log('\nDone');
})().catch(e => {
  console.error('Fatal:', e.message);
  if (e.response) console.error('Response:', e.response.status, JSON.stringify(e.response.data).slice(0, 500));
});
