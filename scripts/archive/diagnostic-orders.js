/**
 * Diagnostic test for hl_create_order based on the full backend spec.
 * 
 * Backend pipeline:
 * 1. serverDecryptData(computedData) → { userId, data, signature, apiKey }
 * 2. decodeInputData('hl_create_order', data) → [coin, isLong, price, size, reduceOnly, nonce, tpPrice, slPrice, isMarket]
 * 3. Validate coin, format price, validate TP/SL, format size, check min $11
 * 4. Verify nonce (unused), load wallet, verify secp256k1 signature
 * 5. approveBuilder(privateKey) → setReferralCode(privateKey) → setMaxLeverage(privateKey)
 * 6. executeTradeUsingNktkasSDK(privateKey, params, isMarket)
 * 
 * "Sent order failed" = all steps 1-5 passed, step 6 failed (HL SDK returned status != 'ok')
 * "Invalid params" without code = HL SDK rejected params before sending
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
  // === Step 1: Sign in ===
  const kp = generateGdexSessionKeyPair();
  const nonce = generateGdexNonce().toString();
  const msg = buildGdexSignInMessage(wallet.address, nonce, kp.sessionKey);
  const sig = await wallet.signMessage(msg);
  const payload = buildGdexSignInComputedData({
    apiKey, userId: wallet.address, sessionKey: kp.sessionKey, nonce, signature: sig.replace(/^0x/, ''),
  });
  const signInResp = await axios.post(BASE + '/sign_in', { computedData: payload.computedData, chainId: 42161 }, { headers: HEADERS });
  console.log('✅ Signed in:', signInResp.data.address || 'ok');

  // === Step 2: Get HL meta and prices ===
  const [metaResp, midsResp, stateResp] = await Promise.all([
    axios.post('https://api.hyperliquid.xyz/info', { type: 'meta' }, { headers: { 'Content-Type': 'application/json' } }),
    axios.post('https://api.hyperliquid.xyz/info', { type: 'allMids' }, { headers: { 'Content-Type': 'application/json' } }),
    axios.post('https://api.hyperliquid.xyz/info', { type: 'clearinghouseState', user: managedAddr }, { headers: { 'Content-Type': 'application/json' } }),
  ]);

  const balance = parseFloat(stateResp.data.crossMarginSummary.accountValue);
  console.log(`\n💰 Account: $${balance}`);
  console.log('📊 Positions:', stateResp.data.assetPositions.length);

  // Get asset info for BTC, ETH, SOL
  const assetsOfInterest = ['BTC', 'ETH', 'SOL'];
  for (const name of assetsOfInterest) {
    const asset = metaResp.data.universe.find(u => u.name === name);
    const mid = parseFloat(midsResp.data[name] || '0');
    if (asset) {
      console.log(`\n${name}: mid=$${mid} szDecimals=${asset.szDecimals} maxLeverage=${asset.maxLeverage}`);
      
      // Calculate viable order:
      // At max leverage, margin = notional / maxLev
      // Need: notional >= $11 AND notional / maxLev <= balance
      const maxNotional = balance * asset.maxLeverage;
      const minSizeForNotional = 11 / mid; // Min size for $11 notional
      const sizeIncrement = Math.pow(10, -asset.szDecimals);
      const minSizeLots = Math.ceil(minSizeForNotional / sizeIncrement) * sizeIncrement;
      const notional = minSizeLots * mid;
      const marginNeeded = notional / asset.maxLeverage;
      
      console.log(`  Max notional: $${maxNotional.toFixed(2)} | Min size: ${minSizeLots.toFixed(asset.szDecimals)} (=$${notional.toFixed(2)}) | Margin: $${marginNeeded.toFixed(2)}`);
    }
  }

  // === Step 3: Test orders systematically ===
  console.log('\n' + '='.repeat(60));
  console.log('TESTING ORDERS');
  console.log('='.repeat(60));

  const btcMid = parseFloat(midsResp.data['BTC']);
  const ethMid = parseFloat(midsResp.data['ETH']);
  const solMid = parseFloat(midsResp.data['SOL'] || '0');

  const tests = [
    // === BTC tests ===
    // Test 1: BTC market long, minimum viable size, 3% above market
    {
      coin: 'BTC', isLong: true,
      price: Math.round(btcMid * 1.03).toString(),
      size: '0.0002',  // ~$13.4 at 67k, margin at 40x = $0.33
      reduceOnly: false, tpPrice: '0', slPrice: '0', isMarket: true,
      label: 'BTC market long 0.0002 (+3% price)'
    },
    // Test 2: BTC market long, slightly larger size
    {
      coin: 'BTC', isLong: true, 
      price: Math.round(btcMid * 1.03).toString(),
      size: '0.0003',  // ~$20.2 at 67k, margin at 40x = $0.50
      reduceOnly: false, tpPrice: '0', slPrice: '0', isMarket: true,
      label: 'BTC market long 0.0003 (+3% price)'
    },
    // Test 3: BTC limit long below market (should create pending order)
    {
      coin: 'BTC', isLong: true,
      price: Math.round(btcMid * 0.98).toString(),
      size: '0.0002',
      reduceOnly: false, tpPrice: '0', slPrice: '0', isMarket: false,
      label: 'BTC limit long 0.0002 (-2% price)'
    },
    // Test 4: BTC with empty strings for tp/sl instead of '0'
    {
      coin: 'BTC', isLong: true,
      price: Math.round(btcMid * 1.03).toString(),
      size: '0.0002',
      reduceOnly: false, tpPrice: '', slPrice: '', isMarket: true,
      label: 'BTC market long, empty tp/sl strings'
    },
    // === ETH tests ===
    // Test 5: ETH market long
    {
      coin: 'ETH', isLong: true,
      price: Math.round(ethMid * 1.03).toString(),
      size: '0.006',  // ~$11.7 at 1960, margin at 25x = $0.47
      reduceOnly: false, tpPrice: '0', slPrice: '0', isMarket: true,
      label: 'ETH market long 0.006 (+3% price)'
    },
    // Test 6: ETH with 4 decimal precision
    {
      coin: 'ETH', isLong: true,
      price: Math.round(ethMid * 1.03).toString(),
      size: '0.0060',  // explicitly 4 decimals
      reduceOnly: false, tpPrice: '0', slPrice: '0', isMarket: true,
      label: 'ETH market long 0.0060 (4dp)'
    },
    // Test 7: SOL market long
    {
      coin: 'SOL', isLong: true,
      price: (Math.ceil(solMid * 1.03)).toString(),
      size: '0.2',  // ~$16.6 at 83
      reduceOnly: false, tpPrice: '0', slPrice: '0', isMarket: true,
      label: `SOL market long 0.2 (+3% price)`
    },
    // === Short tests ===
    // Test 8: BTC market short (sell side)
    {
      coin: 'BTC', isLong: false,
      price: Math.round(btcMid * 0.97).toString(),  // below market for short
      size: '0.0002',
      reduceOnly: false, tpPrice: '0', slPrice: '0', isMarket: true,
      label: 'BTC market SHORT 0.0002 (-3% price)'
    },
  ];

  let succeeded = false;
  for (const t of tests) {
    const mid = parseFloat(midsResp.data[t.coin] || '0');
    const notional = parseFloat(t.size) * mid;
    console.log(`\n--- ${t.label} ---`);
    console.log(`  Params: coin=${t.coin} isLong=${t.isLong} price=${t.price} size=${t.size} market=${t.isMarket}`);
    console.log(`  Notional: $${notional.toFixed(2)} | Min required: $11`);

    try {
      const cd = buildHlComputedData({
        action: 'hl_create_order', apiKey,
        walletAddress: wallet.address,
        sessionPrivateKey: kp.sessionPrivateKey,
        actionParams: {
          coin: t.coin,
          isLong: t.isLong,
          price: t.price,
          size: t.size,
          reduceOnly: t.reduceOnly,
          tpPrice: t.tpPrice,
          slPrice: t.slPrice,
          isMarket: t.isMarket,
        },
      });

      const resp = await axios.post(BASE + '/hl/create_order', { computedData: cd }, { headers: HEADERS });
      console.log(`  ✅ SUCCESS: ${JSON.stringify(resp.data)}`);
      succeeded = true;

      // Check position after success
      await new Promise(r => setTimeout(r, 2000));
      const posResp = await axios.post('https://api.hyperliquid.xyz/info', {
        type: 'clearinghouseState', user: managedAddr,
      }, { headers: { 'Content-Type': 'application/json' } });
      
      const state = posResp.data;
      console.log(`  Account value: $${state.crossMarginSummary.accountValue}`);
      console.log(`  Total margin used: $${state.crossMarginSummary.totalMarginUsed}`);
      console.log(`  Positions: ${state.assetPositions.length}`);
      for (const ap of state.assetPositions) {
        const p = ap.position;
        console.log(`    ${p.coin}: size=${p.szi} entry=${p.entryPx} lev=${JSON.stringify(p.leverage)} margin=${p.marginUsed}`);
      }
      break;  // Stop on first success
    } catch (e) {
      const status = e.response?.status;
      const data = e.response?.data;
      console.log(`  ❌ ${status}: ${JSON.stringify(data)}`);
      
      // Categorize the error
      if (data?.code === 103 && data?.error?.includes('Unauthorized')) {
        console.log('  → Signature verification failed');
      } else if (data?.code === 103 && data?.error?.includes('Min order')) {
        console.log('  → Order too small (need $11+ notional)');
      } else if (data?.code === 102) {
        console.log('  → Nonce issue');
      } else if (data?.error === 'Sent order failed') {
        console.log('  → Passed backend validation, HL SDK rejected (likely margin/leverage issue)');
      } else if (data?.error === 'Invalid params') {
        console.log('  → Backend or SDK param validation failed');
      }
    }

    // Delay between tests to avoid nonce collision
    await new Promise(r => setTimeout(r, 1000));
  }

  if (!succeeded) {
    console.log('\n❌ ALL ORDERS FAILED');
    console.log('\nDiagnosis:');
    console.log('- All "Sent order failed" = backend decrypted/validated OK, but HL rejected');
    console.log('- The backend calls setMaxLeverage() before each order');
    console.log('- If setMaxLeverage fails silently, account stays at 1x leverage');
    console.log('- At 1x leverage with $10, max notional = $10 < $11 min = IMPOSSIBLE');
    console.log('- Need: either more funds, or backend fix for setMaxLeverage on managed accounts');
  }

  // === After all tests: check if any open orders remain ===
  console.log('\n--- Checking open orders ---');
  try {
    const ordersResp = await axios.post('https://api.hyperliquid.xyz/info', {
      type: 'frontendOpenOrders', user: managedAddr,
    }, { headers: { 'Content-Type': 'application/json' } });
    console.log('Open orders:', ordersResp.data.length);
    for (const o of ordersResp.data) {
      console.log(`  ${o.coin}: ${o.side} ${o.sz} @ ${o.limitPx} (oid: ${o.oid})`);
    }
  } catch (e) {
    console.log('Error checking orders:', e.message);
  }
})().catch(e => {
  console.error('Fatal:', e.message);
  if (e.response) {
    console.error('Response:', e.response.status, JSON.stringify(e.response.data));
  }
});
