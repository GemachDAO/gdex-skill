/**
 * Final diagnostic: test reduce-only orders, check builder fees,
 * and probe for additional endpoints.
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
  const signInResp = await axios.post(BASE + '/sign_in', {
    computedData: payload.computedData, chainId: 42161,
  }, { headers: HEADERS });
  console.log('Signed in:', signInResp.data.address);

  // Get prices
  const mids = (await axios.post(HL_INFO, { type: 'allMids' }, { headers: HL_H })).data;
  const btcMid = parseFloat(mids['BTC']);
  console.log('BTC mid:', btcMid);

  // === 1. Check maxBuilderFee with different potential builder addresses ===
  console.log('\n=== Builder Fee Checks ===');
  const builderAddresses = [
    '0x1bd80b4165CEED7F9404f8D59dFD3A8fA5d445E7',  // The one we guessed
    '0x1bd38cf3155fcb4719592ae5dd5c966e9736d9d9',  // The referrer address
    '0x0000000000000000000000000000000000000000',  // Zero address
  ];
  
  for (const builder of builderAddresses) {
    try {
      const bf = await axios.post(HL_INFO, { type: 'maxBuilderFee', user: managedAddr, builder }, { headers: HL_H });
      console.log(`maxBuilderFee for ${builder}: ${JSON.stringify(bf.data)}`);
    } catch (e) {
      console.log(`maxBuilderFee error for ${builder}: ${e.response?.data || e.message}`);
    }
  }

  // === 2. Check if there's a userApprovedBuilders endpoint ===
  try {
    const approved = await axios.post(HL_INFO, { type: 'approvedBuilder', user: managedAddr }, { headers: HL_H });
    console.log('approvedBuilder:', JSON.stringify(approved.data));
  } catch (e) {
    console.log('approvedBuilder error:', e.response?.status, JSON.stringify(e.response?.data)?.slice(0, 200));
  }

  // === 3. Try reduce-only order (might skip builder fee) ===
  console.log('\n=== Reduce-Only Order Test ===');
  const n1 = generateGdexNonce().toString();
  const d1 = encodeHlActionData('hl_create_order', {
    coin: 'BTC', isLong: true, price: Math.round(btcMid * 1.03).toString(),
    size: '0.0002', reduceOnly: true, nonce: n1,
    tpPrice: '0', slPrice: '0', isMarket: true,
  });
  const s1 = signHlActionMessage('hl_create_order', wallet.address, d1, kp.sessionPrivateKey);
  const cd1 = buildEncryptedGdexPayload({ apiKey, userId: wallet.address, data: d1, signature: s1 });
  try {
    const resp = await axios.post(BASE + '/hl/create_order', { computedData: cd1 }, { headers: HEADERS });
    console.log('✅ Reduce-only:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('❌ Reduce-only:', e.response?.status, JSON.stringify(e.response?.data));
  }

  // === 4. Probe additional endpoints ===
  console.log('\n=== Endpoint Probing ===');
  const probeEndpoints = [
    ['GET', '/hl/status'],
    ['GET', '/hl/config'],
    ['GET', '/status'],
    ['GET', '/health'],
    ['POST', '/hl/approve_builder'],
    ['POST', '/hl/set_leverage'],
    ['POST', '/hl/update_leverage'],
    ['POST', '/hl/set_referral'],
    ['GET', '/hl/builder_fee'],
    ['POST', '/hl/cancel_order'],
    ['POST', '/hl/order'],
  ];
  
  for (const [method, endpoint] of probeEndpoints) {
    try {
      const resp = method === 'GET' 
        ? await axios.get(BASE + endpoint, { headers: HEADERS })
        : await axios.post(BASE + endpoint, {}, { headers: HEADERS });
      console.log(`✅ ${method} ${endpoint}: ${resp.status} ${JSON.stringify(resp.data).slice(0, 100)}`);
    } catch (e) {
      const status = e.response?.status || 'err';
      const data = JSON.stringify(e.response?.data || '').slice(0, 80);
      const is404 = status === 404;
      console.log(`${is404 ? '   ' : '❓ '} ${method} ${endpoint}: ${status} ${is404 ? '(not found)' : data}`);
    }
  }

  // === 5. Try with explicit leverage in request (won't work, but see error) ===
  console.log('\n=== Try with different error combinations ===');
  
  // $11 min order test (we know this exists)
  const n2 = generateGdexNonce().toString();
  const d2 = encodeHlActionData('hl_create_order', {
    coin: 'BTC', isLong: true, price: '1', // absurdly low price
    size: '0.00001', reduceOnly: false, nonce: n2,
    tpPrice: '0', slPrice: '0', isMarket: false,
  });
  const s2 = signHlActionMessage('hl_create_order', wallet.address, d2, kp.sessionPrivateKey);
  const cd2 = buildEncryptedGdexPayload({ apiKey, userId: wallet.address, data: d2, signature: s2 });
  try {
    const resp = await axios.post(BASE + '/hl/create_order', { computedData: cd2 }, { headers: HEADERS });
    console.log('✅ Tiny order:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('❌ Tiny order:', e.response?.status, JSON.stringify(e.response?.data));
  }

  // Try with size '0' (should be caught by backend validation)
  const n3 = generateGdexNonce().toString();
  const d3 = encodeHlActionData('hl_create_order', {
    coin: 'BTC', isLong: true, price: Math.round(btcMid).toString(),
    size: '0', reduceOnly: false, nonce: n3,
    tpPrice: '0', slPrice: '0', isMarket: true,
  });
  const s3 = signHlActionMessage('hl_create_order', wallet.address, d3, kp.sessionPrivateKey);
  const cd3 = buildEncryptedGdexPayload({ apiKey, userId: wallet.address, data: d3, signature: s3 });
  try {
    const resp = await axios.post(BASE + '/hl/create_order', { computedData: cd3 }, { headers: HEADERS });
    console.log('✅ Zero size:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('❌ Zero size:', e.response?.status, JSON.stringify(e.response?.data));
  }

  // === 6. Check HL L1 one more time for any changes ===
  const fills = await axios.post(HL_INFO, { type: 'userFills', user: managedAddr }, { headers: HL_H });
  const orders = await axios.post(HL_INFO, { type: 'frontendOpenOrders', user: managedAddr }, { headers: HL_H });
  console.log('\nHL L1 after tests:');
  console.log('  Fills:', fills.data.length);
  console.log('  Open orders:', orders.data.length);

  console.log('\nDone');
})().catch(e => {
  console.error('Fatal:', e.message);
  if (e.response) console.error('Response:', e.response.status, JSON.stringify(e.response.data).slice(0, 500));
});
