/**
 * Deep diagnostic: Check HL L1 history, verify ABI encoding, and test order.
 */
const { ethers } = require('ethers');
const axios = require('axios');
const {
  generateGdexSessionKeyPair, generateGdexNonce,
  buildGdexSignInMessage, buildGdexSignInComputedData,
  encodeHlActionData, signHlActionMessage, buildEncryptedGdexPayload,
  encryptGdexComputedData, decryptGdexComputedData,
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
  'Authorization': 'Bearer ' + apiKey,
};
const HL_INFO = 'https://api.hyperliquid.xyz/info';
const HL_HEADERS = { 'Content-Type': 'application/json' };

(async () => {
  // === 1. Check HL L1 history for our managed wallet ===
  console.log('=== HL L1 Diagnostics for', managedAddr, '===\n');

  // Check user fills (historical)
  const fillsResp = await axios.post(HL_INFO, {
    type: 'userFills', user: managedAddr,
  }, { headers: HL_HEADERS });
  console.log('User fills:', fillsResp.data.length);
  if (fillsResp.data.length > 0) {
    fillsResp.data.slice(0, 5).forEach(f => console.log(' ', JSON.stringify(f)));
  }

  // Check open orders
  const ordersResp = await axios.post(HL_INFO, {
    type: 'frontendOpenOrders', user: managedAddr,
  }, { headers: HL_HEADERS });
  console.log('Open orders:', ordersResp.data.length);

  // Check user funding history
  const fundingResp = await axios.post(HL_INFO, {
    type: 'userFunding', user: managedAddr, startTime: 0,
  }, { headers: HL_HEADERS });
  console.log('Funding events:', fundingResp.data.length);

  // Non-funding ledger (deposits, transfers, etc.)
  const ledgerResp = await axios.post(HL_INFO, {
    type: 'userNonFundingLedgerUpdates', user: managedAddr, startTime: 0,
  }, { headers: HL_HEADERS });
  console.log('Ledger updates:', ledgerResp.data.length);
  if (ledgerResp.data.length > 0) {
    ledgerResp.data.forEach(l => console.log(' ', JSON.stringify(l).slice(0, 200)));
  }

  // === 2. Verify ABI encoding matches backend decoder ===
  console.log('\n=== ABI Encoding Verification ===');
  
  const testNonce = '12345678';
  const testData = encodeHlActionData('hl_create_order', {
    coin: 'BTC', isLong: true, price: '69000', size: '0.0002',
    reduceOnly: false, nonce: testNonce,
    tpPrice: '0', slPrice: '0', isMarket: true,
  });
  
  // Decode it back using the same ABI to verify
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const decoded = abi.decode(
    ['string', 'bool', 'string', 'string', 'bool', 'string', 'string', 'string', 'bool'],
    '0x' + testData,
  );
  console.log('Decoded[0] coin:', decoded[0]);
  console.log('Decoded[1] isLong:', decoded[1]);
  console.log('Decoded[2] price:', decoded[2]);
  console.log('Decoded[3] size:', decoded[3]);
  console.log('Decoded[4] reduceOnly:', decoded[4]);
  console.log('Decoded[5] nonce:', decoded[5]);
  console.log('Decoded[6] tpPrice:', decoded[6]);
  console.log('Decoded[7] slPrice:', decoded[7]);
  console.log('Decoded[8] isMarket:', decoded[8]);

  // === 3. Verify full encrypted payload structure ===
  console.log('\n=== Encrypted Payload Structure ===');
  
  const kp = generateGdexSessionKeyPair();
  const sessionNonce = generateGdexNonce().toString();
  const msg = buildGdexSignInMessage(wallet.address, sessionNonce, kp.sessionKey);
  const sig = await wallet.signMessage(msg);
  
  // Build the order computedData
  const orderNonce = generateGdexNonce().toString();
  const data = encodeHlActionData('hl_create_order', {
    coin: 'BTC', isLong: true, price: '69000', size: '0.0002',
    reduceOnly: false, nonce: orderNonce,
    tpPrice: '0', slPrice: '0', isMarket: true,
  });
  const signature = signHlActionMessage(
    'hl_create_order', wallet.address, data, kp.sessionPrivateKey,
  );

  // Build WITHOUT apiKey (current SDK behavior)
  const payloadNoApiKey = buildEncryptedGdexPayload({
    apiKey, userId: wallet.address, data, signature,
  });
  const decryptedNoApiKey = JSON.parse(decryptGdexComputedData(payloadNoApiKey, apiKey));
  console.log('\nPayload WITHOUT apiKey:');
  console.log('  keys:', Object.keys(decryptedNoApiKey));
  console.log('  userId:', decryptedNoApiKey.userId);
  console.log('  userId casing: starts with 0x53D?', decryptedNoApiKey.userId.startsWith('0x53D'));
  console.log('  data starts with:', decryptedNoApiKey.data.slice(0, 20) + '...');
  console.log('  data has 0x prefix:', decryptedNoApiKey.data.startsWith('0x'));
  console.log('  signature length:', decryptedNoApiKey.signature.length);

  // Build WITH apiKey
  const plaintextWithApiKey = JSON.stringify({
    userId: wallet.address,
    data: data,
    signature: signature,
    apiKey: apiKey,
  });
  const payloadWithApiKey = encryptGdexComputedData(plaintextWithApiKey, apiKey);
  const decryptedWithApiKey = JSON.parse(decryptGdexComputedData(payloadWithApiKey, apiKey));
  console.log('\nPayload WITH apiKey:');
  console.log('  keys:', Object.keys(decryptedWithApiKey));

  // === 4. Sign in and test the actual order ===
  console.log('\n=== Live Order Test ===');
  
  const signInPayload = buildGdexSignInComputedData({
    apiKey, userId: wallet.address, sessionKey: kp.sessionKey,
    nonce: sessionNonce, signature: sig.replace(/^0x/, ''),
  });
  await axios.post(BASE + '/sign_in', { computedData: signInPayload.computedData, chainId: 42161 }, { headers: HEADERS });
  console.log('Signed in');

  // Get BTC price
  const midsResp = await axios.post(HL_INFO, { type: 'allMids' }, { headers: HL_HEADERS });
  const btcMid = parseFloat(midsResp.data['BTC']);
  console.log('BTC mid:', btcMid);

  // === Test A: using our standard buildEncryptedGdexPayload (no apiKey) ===
  console.log('\n--- Test A: Standard payload (no apiKey in encrypted data) ---');
  const orderNonceA = generateGdexNonce().toString();
  const dataA = encodeHlActionData('hl_create_order', {
    coin: 'BTC', isLong: true,
    price: Math.round(btcMid * 1.03).toString(),
    size: '0.0002',
    reduceOnly: false, nonce: orderNonceA,
    tpPrice: '0', slPrice: '0', isMarket: true,
  });
  const sigA = signHlActionMessage('hl_create_order', wallet.address, dataA, kp.sessionPrivateKey);
  const cdA = buildEncryptedGdexPayload({ apiKey, userId: wallet.address, data: dataA, signature: sigA });

  try {
    const resp = await axios.post(BASE + '/hl/create_order', { computedData: cdA }, { headers: HEADERS });
    console.log('✅ SUCCESS:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('❌', e.response?.status, JSON.stringify(e.response?.data));
  }

  // === Test B: using apiKey in encrypted data ===
  console.log('\n--- Test B: Payload WITH apiKey in encrypted data ---');
  const orderNonceB = generateGdexNonce().toString();
  const dataB = encodeHlActionData('hl_create_order', {
    coin: 'BTC', isLong: true,
    price: Math.round(btcMid * 1.03).toString(),
    size: '0.0002',
    reduceOnly: false, nonce: orderNonceB,
    tpPrice: '0', slPrice: '0', isMarket: true,
  });
  const sigB = signHlActionMessage('hl_create_order', wallet.address, dataB, kp.sessionPrivateKey);
  const plaintextB = JSON.stringify({
    userId: wallet.address,
    data: dataB,
    signature: sigB,
    apiKey: apiKey,
  });
  const cdB = encryptGdexComputedData(plaintextB, apiKey);

  try {
    const resp = await axios.post(BASE + '/hl/create_order', { computedData: cdB }, { headers: HEADERS });
    console.log('✅ SUCCESS:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('❌', e.response?.status, JSON.stringify(e.response?.data));
  }

  // === Test C: lowercase userId in payload ===
  console.log('\n--- Test C: Lowercase userId in encrypted payload ---');
  const orderNonceC = generateGdexNonce().toString();
  const dataC = encodeHlActionData('hl_create_order', {
    coin: 'BTC', isLong: true,
    price: Math.round(btcMid * 1.03).toString(),
    size: '0.0002',
    reduceOnly: false, nonce: orderNonceC,
    tpPrice: '0', slPrice: '0', isMarket: true,
  });
  const sigC = signHlActionMessage('hl_create_order', wallet.address, dataC, kp.sessionPrivateKey);
  const plaintextC = JSON.stringify({
    userId: wallet.address.toLowerCase(),  // lowercase!
    data: dataC,
    signature: sigC,
    apiKey: apiKey,
  });
  const cdC = encryptGdexComputedData(plaintextC, apiKey);

  try {
    const resp = await axios.post(BASE + '/hl/create_order', { computedData: cdC }, { headers: HEADERS });
    console.log('✅ SUCCESS:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('❌', e.response?.status, JSON.stringify(e.response?.data));
  }

  // === Test D: empty string tp/sl instead of '0' ===
  console.log('\n--- Test D: Empty string tp/sl ---');
  const orderNonceD = generateGdexNonce().toString();
  const dataD = encodeHlActionData('hl_create_order', {
    coin: 'BTC', isLong: true,
    price: Math.round(btcMid * 1.03).toString(),
    size: '0.0002',
    reduceOnly: false, nonce: orderNonceD,
    tpPrice: '', slPrice: '', isMarket: true,
  });
  const sigD = signHlActionMessage('hl_create_order', wallet.address, dataD, kp.sessionPrivateKey);
  const plaintextD = JSON.stringify({
    userId: wallet.address.toLowerCase(),
    data: dataD,
    signature: sigD,
    apiKey: apiKey,
  });
  const cdD = encryptGdexComputedData(plaintextD, apiKey);

  try {
    const resp = await axios.post(BASE + '/hl/create_order', { computedData: cdD }, { headers: HEADERS });
    console.log('✅ SUCCESS:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('❌', e.response?.status, JSON.stringify(e.response?.data));
  }

  // === Test E: limit order (isMarket=false) well below market ===
  console.log('\n--- Test E: Limit order at 95% of market ---');
  const orderNonceE = generateGdexNonce().toString();
  const limitPrice = Math.round(btcMid * 0.95).toString();
  const dataE = encodeHlActionData('hl_create_order', {
    coin: 'BTC', isLong: true,
    price: limitPrice,
    size: '0.0002',
    reduceOnly: false, nonce: orderNonceE,
    tpPrice: '0', slPrice: '0', isMarket: false,
  });
  const sigE = signHlActionMessage('hl_create_order', wallet.address, dataE, kp.sessionPrivateKey);
  const plaintextE = JSON.stringify({
    userId: wallet.address.toLowerCase(),
    data: dataE,
    signature: sigE,
    apiKey: apiKey,
  });
  const cdE = encryptGdexComputedData(plaintextE, apiKey);

  try {
    const resp = await axios.post(BASE + '/hl/create_order', { computedData: cdE }, { headers: HEADERS });
    console.log('✅ SUCCESS:', JSON.stringify(resp.data));
    
    // Check if limit order appears in open orders
    await new Promise(r => setTimeout(r, 2000));
    const oo = await axios.post(HL_INFO, { type: 'frontendOpenOrders', user: managedAddr }, { headers: HL_HEADERS });
    console.log('Open orders after limit:', oo.data.length);
    oo.data.forEach(o => console.log('  ', JSON.stringify(o)));
  } catch (e) {
    console.log('❌', e.response?.status, JSON.stringify(e.response?.data));
  }

  console.log('\nDone');
})().catch(e => {
  console.error('Fatal:', e.message);
  if (e.response) console.error('Response:', e.response.status, JSON.stringify(e.response.data).slice(0, 300));
});
