/**
 * Test with apiKey included in the encrypted payload (matching frontend behavior).
 */
const { ethers, AbiCoder, SigningKey, keccak256, toUtf8Bytes } = require('ethers');
const { createCipheriv, createHash } = require('crypto');
const axios = require('axios');
const {
  generateGdexSessionKeyPair, generateGdexNonce,
  buildGdexSignInMessage, buildGdexSignInComputedData,
  encodeHlActionData, signHlActionMessage, encryptGdexComputedData,
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

(async () => {
  // Sign in
  const kp = generateGdexSessionKeyPair();
  const nonce = generateGdexNonce().toString();
  const msg = buildGdexSignInMessage(wallet.address, nonce, kp.sessionKey);
  const sig = await wallet.signMessage(msg);
  const payload = buildGdexSignInComputedData({
    apiKey, userId: wallet.address, sessionKey: kp.sessionKey, nonce, signature: sig.replace(/^0x/, ''),
  });
  await axios.post(BASE + '/sign_in', { computedData: payload.computedData, chainId: 42161 }, { headers: HEADERS });
  console.log('✅ Signed in');

  // Get BTC price
  const midsResp = await axios.post('https://api.hyperliquid.xyz/info', { type: 'allMids' }, { headers: { 'Content-Type': 'application/json' } });
  const btcMid = parseFloat(midsResp.data['BTC']);
  console.log('BTC mid:', btcMid);

  const size = '0.0002';
  const price = Math.round(btcMid * 1.03).toString();
  console.log(`\nPlacing BTC long: size=${size} price=${price}`);

  // Build computedData manually WITH apiKey in the encrypted payload
  const orderNonce = generateGdexNonce().toString();
  const data = encodeHlActionData('hl_create_order', {
    coin: 'BTC', isLong: true, price, size,
    reduceOnly: false, nonce: orderNonce,
    tpPrice: '0', slPrice: '0', isMarket: true,
  });
  const signature = signHlActionMessage(
    'hl_create_order', wallet.address, data, kp.sessionPrivateKey,
  );

  // KEY DIFFERENCE: include apiKey in the JSON payload
  const plaintext = JSON.stringify({
    userId: wallet.address,
    data: data,
    signature: signature,
    apiKey: apiKey,    // <-- THIS was missing!
  });
  const computedData = encryptGdexComputedData(plaintext, apiKey);

  try {
    const resp = await axios.post(BASE + '/hl/create_order', { computedData }, { headers: HEADERS });
    console.log('✅ ORDER SUCCESS:', JSON.stringify(resp.data));

    // Check position
    await new Promise(r => setTimeout(r, 2000));
    const stateResp = await axios.post('https://api.hyperliquid.xyz/info', {
      type: 'clearinghouseState', user: managedAddr,
    }, { headers: { 'Content-Type': 'application/json' } });
    
    console.log('\nAccount value:', stateResp.data.crossMarginSummary.accountValue);
    console.log('Positions:', stateResp.data.assetPositions.length);
    for (const ap of stateResp.data.assetPositions) {
      const p = ap.position;
      console.log(`  ${p.coin}: size=${p.szi} entry=${p.entryPx} leverage=${JSON.stringify(p.leverage)}`);
    }
  } catch (e) {
    console.log('❌ STILL FAILED:', e.response?.status, JSON.stringify(e.response?.data));
  }
})().catch(e => console.error('Fatal:', e.message));
