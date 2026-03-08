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
  'Authorization': 'Bearer ' + apiKey,
};

(async () => {
  // Step 1: Get HL meta info to understand asset specs
  console.log('=== HL Meta Info ===');
  const metaResp = await axios.post('https://api.hyperliquid.xyz/info', { type: 'meta' }, {
    headers: { 'Content-Type': 'application/json' },
  });
  const meta = metaResp.data;
  // Find BTC and ETH specs
  for (const u of meta.universe) {
    if (u.name === 'BTC' || u.name === 'ETH') {
      console.log(u.name, JSON.stringify(u));
    }
  }

  // Step 2: Check HL clearinghouse state for leverage as seen by HL L1
  console.log('\n=== HL L1 State ===');
  const stateResp = await axios.post('https://api.hyperliquid.xyz/info', {
    type: 'clearinghouseState', user: managedAddr,
  }, { headers: { 'Content-Type': 'application/json' } });
  console.log('Full state:', JSON.stringify(stateResp.data, null, 2));

  // Step 3: Sign in and try the order
  const kp = generateGdexSessionKeyPair();
  const nonce = generateGdexNonce().toString();
  const msg = buildGdexSignInMessage(wallet.address, nonce, kp.sessionKey);
  const sig = await wallet.signMessage(msg);
  const payload = buildGdexSignInComputedData({
    apiKey, userId: wallet.address, sessionKey: kp.sessionKey, nonce, signature: sig.replace(/^0x/, ''),
  });
  await axios.post(BASE + '/sign_in', { computedData: payload.computedData, chainId: 42161 }, { headers: HEADERS });
  console.log('\nSigned in');

  // Step 4: Get BTC price and try order with exact HL-compatible price (5 sig figs, integer for BTC)
  const midsResp = await axios.post('https://api.hyperliquid.xyz/info', { type: 'allMids' }, {
    headers: { 'Content-Type': 'application/json' },
  });
  const btcMid = parseFloat(midsResp.data['BTC']);
  console.log('BTC mid:', btcMid);

  // For market buy: price should be above market (buy at higher price)
  // HL rounds BTC prices to 1 decimal. Must be 5 sig figs max.
  // For market order, many systems use a very high price for buy
  const buyPrice = (Math.ceil(btcMid / 10) * 10).toString(); // Round up to nearest 10
  // BTC min size on HL: szDecimals tells us precision
  // With $10 at cross margin, HL might use max leverage by default

  console.log('\n=== Testing orders ===');
  
  // Test A: Small BTC order at rounded price
  const testOrders = [
    { coin: 'BTC', size: '0.001', price: buyPrice, isLong: true, reduceOnly: false, tpPrice: '', slPrice: '', isMarket: true },
    { coin: 'BTC', size: '0.0005', price: buyPrice, isLong: true, reduceOnly: false, tpPrice: '', slPrice: '', isMarket: true },
    // BTC with isMarket=false (limit order, safer)
    { coin: 'BTC', size: '0.0002', price: (Math.floor(btcMid * 0.99)).toString(), isLong: true, reduceOnly: false, tpPrice: '', slPrice: '', isMarket: false },
    // ETH order
    { coin: 'ETH', size: '0.01', price: (Math.ceil(parseFloat(midsResp.data['ETH']) * 1.03)).toString(), isLong: true, reduceOnly: false, tpPrice: '', slPrice: '', isMarket: true },
    // SOL order (smaller unit price)
    { coin: 'SOL', size: '0.1', price: (Math.ceil(parseFloat(midsResp.data['SOL'] || '0') * 1.05)).toString(), isLong: true, reduceOnly: false, tpPrice: '', slPrice: '', isMarket: true },
  ];

  for (const t of testOrders) {
    const notional = parseFloat(t.size) * parseFloat(midsResp.data[t.coin] || '0');
    console.log(`\n${t.coin}: size=${t.size} price=${t.price} market=${t.isMarket} notional=$${notional.toFixed(2)}`);
    
    try {
      const cd = buildHlComputedData({
        action: 'hl_create_order', apiKey,
        walletAddress: wallet.address, sessionPrivateKey: kp.sessionPrivateKey,
        actionParams: t,
      });
      const resp = await axios.post(BASE + '/hl/create_order', { computedData: cd }, { headers: HEADERS });
      console.log('  ✅ SUCCESS:', JSON.stringify(resp.data));
      
      // If success, check positions
      await new Promise(r => setTimeout(r, 2000));
      const posResp = await axios.post('https://api.hyperliquid.xyz/info', {
        type: 'clearinghouseState', user: managedAddr,
      }, { headers: { 'Content-Type': 'application/json' } });
      console.log('  Positions:', posResp.data.assetPositions?.length);
      if (posResp.data.assetPositions?.length > 0) {
        for (const ap of posResp.data.assetPositions) {
          const p = ap.position;
          console.log(`    ${p.coin}: size=${p.szi} entry=${p.entryPx} leverage=${JSON.stringify(p.leverage)}`);
        }
      }
      break;
    } catch (e) {
      console.log('  ❌', e.response?.status, JSON.stringify(e.response?.data)?.slice(0, 300));
    }
    await new Promise(r => setTimeout(r, 500));
  }
})().catch(e => console.error('Fatal:', e.message));
