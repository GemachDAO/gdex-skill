/**
 * Live test: set max leverage → place order on HyperLiquid.
 * 
 * The backend spec says executeTradeUsingNktkasSDK calls setMaxLeverage(privateKey)
 * before every order, but in practice it's failing for managed custody.
 * This test first explicitly sets leverage to max, then places the order.
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
  // === Sign in ===
  const kp = generateGdexSessionKeyPair();
  const nonce = generateGdexNonce().toString();
  const msg = buildGdexSignInMessage(wallet.address, nonce, kp.sessionKey);
  const sig = await wallet.signMessage(msg);
  const payload = buildGdexSignInComputedData({
    apiKey, userId: wallet.address, sessionKey: kp.sessionKey, nonce, signature: sig.replace(/^0x/, ''),
  });
  await axios.post(BASE + '/sign_in', { computedData: payload.computedData, chainId: 42161 }, { headers: HEADERS });
  console.log('✅ Signed in');

  // === Get HL meta and prices ===
  const [metaResp, midsResp] = await Promise.all([
    axios.post('https://api.hyperliquid.xyz/info', { type: 'meta' }, { headers: { 'Content-Type': 'application/json' } }),
    axios.post('https://api.hyperliquid.xyz/info', { type: 'allMids' }, { headers: { 'Content-Type': 'application/json' } }),
  ]);

  const btcMeta = metaResp.data.universe.find(u => u.name === 'BTC');
  const btcMid = parseFloat(midsResp.data['BTC']);
  console.log(`\nBTC: mid=$${btcMid} maxLeverage=${btcMeta.maxLeverage}x szDecimals=${btcMeta.szDecimals}`);

  // === Step 1: Try to set leverage to max (40x for BTC) ===
  console.log('\n--- Setting BTC leverage to 40x (cross) ---');
  const leverageCD = buildHlComputedData({
    action: 'hl_update_leverage',
    apiKey,
    walletAddress: wallet.address,
    sessionPrivateKey: kp.sessionPrivateKey,
    actionParams: {
      coin: 'BTC',
      leverage: btcMeta.maxLeverage,
      isCross: true,
    },
  });

  try {
    const levResp = await axios.post(BASE + '/hl/update_leverage', { computedData: leverageCD }, { headers: HEADERS });
    console.log('✅ Leverage set:', JSON.stringify(levResp.data));
  } catch (e) {
    console.log('❌ Leverage endpoint:', e.response?.status, JSON.stringify(e.response?.data)?.slice(0, 300));
    
    // If the endpoint doesn't exist (404), try other patterns
    if (e.response?.status === 404) {
      console.log('   → Endpoint not found. Trying alternatives...');
      const alternatives = ['/hl/set_leverage', '/hl/leverage'];
      for (const alt of alternatives) {
        try {
          const resp = await axios.post(BASE + alt, { computedData: leverageCD }, { headers: HEADERS });
          console.log(`✅ ${alt} worked:`, JSON.stringify(resp.data));
          break;
        } catch (e2) {
          if (e2.response?.status !== 404) {
            console.log(`   ⚠️ ${alt}: ${e2.response?.status} ${JSON.stringify(e2.response?.data)?.slice(0, 200)}`);
          }
        }
      }
    }
  }

  await new Promise(r => setTimeout(r, 2000));

  // === Step 2: Check account state ===
  console.log('\n--- Account state ---');
  const stateResp = await axios.post('https://api.hyperliquid.xyz/info', {
    type: 'clearinghouseState', user: managedAddr,
  }, { headers: { 'Content-Type': 'application/json' } });
  console.log('Balance:', stateResp.data.crossMarginSummary.accountValue);
  console.log('Positions:', stateResp.data.assetPositions.length);

  // === Step 3: Place BTC market order ===
  // Use the smallest viable size: $11+ notional at 40x leverage
  // 0.00017 BTC × $67k ≈ $11.39, margin ≈ $0.28
  const size = '0.0002';  // ~$13.4, margin at 40x ~$0.34
  const price = Math.round(btcMid * 1.03).toString();  // 3% above mid for market buy
  
  console.log(`\n--- Placing BTC long: size=${size} price=${price} market=true ---`);
  console.log(`   Notional: $${(parseFloat(size) * btcMid).toFixed(2)}`);
  console.log(`   Margin at 40x: $${(parseFloat(size) * btcMid / 40).toFixed(2)}`);

  const orderCD = buildHlComputedData({
    action: 'hl_create_order',
    apiKey,
    walletAddress: wallet.address,
    sessionPrivateKey: kp.sessionPrivateKey,
    actionParams: {
      coin: 'BTC',
      isLong: true,
      price: price,
      size: size,
      reduceOnly: false,
      tpPrice: '0',
      slPrice: '0',
      isMarket: true,
    },
  });

  try {
    const orderResp = await axios.post(BASE + '/hl/create_order', { computedData: orderCD }, { headers: HEADERS });
    console.log('✅ ORDER SUCCESS:', JSON.stringify(orderResp.data));

    // Check position
    await new Promise(r => setTimeout(r, 2000));
    const posResp = await axios.post('https://api.hyperliquid.xyz/info', {
      type: 'clearinghouseState', user: managedAddr,
    }, { headers: { 'Content-Type': 'application/json' } });

    console.log('\n--- Position after order ---');
    console.log('Account value:', posResp.data.crossMarginSummary.accountValue);
    console.log('Margin used:', posResp.data.crossMarginSummary.totalMarginUsed);
    for (const ap of posResp.data.assetPositions) {
      const p = ap.position;
      console.log(`  ${p.coin}: size=${p.szi} entry=${p.entryPx} leverage=${JSON.stringify(p.leverage)} margin=${p.marginUsed}`);
    }

    // === Step 4: Close position ===
    console.log('\n--- Closing all positions ---');
    const closeCD = buildHlComputedData({
      action: 'hl_close_all',
      apiKey,
      walletAddress: wallet.address,
      sessionPrivateKey: kp.sessionPrivateKey,
      actionParams: {},
    });
    try {
      const closeResp = await axios.post(BASE + '/hl/close_all_positions', { computedData: closeCD }, { headers: HEADERS });
      console.log('✅ CLOSE ALL:', JSON.stringify(closeResp.data));
    } catch (e) {
      console.log('❌ Close all:', e.response?.status, JSON.stringify(e.response?.data)?.slice(0, 300));
    }

    // Final state
    await new Promise(r => setTimeout(r, 2000));
    const finalResp = await axios.post('https://api.hyperliquid.xyz/info', {
      type: 'clearinghouseState', user: managedAddr,
    }, { headers: { 'Content-Type': 'application/json' } });
    console.log('\n--- Final state ---');
    console.log('Account value:', finalResp.data.crossMarginSummary.accountValue);
    console.log('Positions:', finalResp.data.assetPositions.length);

  } catch (e) {
    console.log('❌ ORDER FAILED:', e.response?.status, JSON.stringify(e.response?.data)?.slice(0, 300));
    
    if (e.response?.data?.error === 'Sent order failed') {
      console.log('\n📋 Diagnosis:');
      console.log('   Auth/validation passed but HL exchange rejected the order.');
      console.log('   The backend calls setMaxLeverage() before trading, but it may');
      console.log('   be failing silently. At 1x leverage, $10 balance < $11 min order.');
      console.log('   The hl_update_leverage endpoint needs to be added to the backend.');
    }
  }
})().catch(e => {
  console.error('Fatal:', e.message);
  if (e.response) console.error('Response:', e.response.status, JSON.stringify(e.response.data));
});
