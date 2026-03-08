/**
 * Quick live test — order placement after backend fix.
 */
const { ethers } = require('ethers');
const axios = require('axios');
const {
  generateGdexSessionKeyPair, generateGdexNonce,
  buildGdexSignInMessage, buildGdexSignInComputedData, buildHlComputedData,
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

  // Place BTC market long
  const size = '0.0002';
  const price = Math.round(btcMid * 1.03).toString();
  console.log(`\nPlacing BTC long: size=${size} price=${price} (notional=$${(0.0002 * btcMid).toFixed(2)})`);

  const cd = buildHlComputedData({
    action: 'hl_create_order', apiKey,
    walletAddress: wallet.address,
    sessionPrivateKey: kp.sessionPrivateKey,
    actionParams: {
      coin: 'BTC', isLong: true, price, size,
      reduceOnly: false, tpPrice: '0', slPrice: '0', isMarket: true,
    },
  });

  try {
    const resp = await axios.post(BASE + '/hl/create_order', { computedData: cd }, { headers: HEADERS });
    console.log('✅ ORDER SUCCESS:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('❌ ORDER FAILED:', e.response?.status, JSON.stringify(e.response?.data));
    
    // Now let's debug: dump what we're actually sending vs what the frontend sends
    console.log('\n--- Debug: checking our payload format ---');
    // Decrypt our own payload to verify format
    const { decryptGdexComputedData } = require('../dist/utils/gdexManagedCrypto');
    const decrypted = decryptGdexComputedData(cd, apiKey);
    const parsed = JSON.parse(decrypted);
    console.log('Our decrypted payload keys:', Object.keys(parsed));
    console.log('userId:', parsed.userId);
    console.log('data length:', parsed.data?.length);
    console.log('signature length:', parsed.signature?.length);
    console.log('apiKey present:', 'apiKey' in parsed);
    
    // The frontend spec says serverDecryptData gives { userId, data, signature, apiKey }
    // Are we missing apiKey in the payload?
    console.log('\n⚠️  Frontend includes apiKey in encrypted payload but our SDK does not!');
  }
})().catch(e => console.error('Fatal:', e.message));
