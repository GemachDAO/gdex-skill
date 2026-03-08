/**
 * Live HL trading test - open a small BTC long, check position, then close it.
 */
const { ethers } = require('ethers');
const { randomBytes } = require('crypto');
const axios = require('axios');

const {
  generateGdexSessionKeyPair,
  generateGdexNonce,
  buildGdexSignInMessage,
  buildGdexSignInComputedData,
  encodeGdexSignInData,
  buildHlComputedData,
} = require('../dist/utils/gdexManagedCrypto');

// ── Config ──────────────────────────────────────────────────────────────────
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

async function checkState(label) {
  const resp = await axios.get(BASE + '/hl/clearinghouse_state', {
    params: { address: managedAddr }, headers: HEADERS,
  });
  const s = resp.data.state || resp.data;
  console.log(`[${label}] Account: $${s.marginSummary?.accountValue}, Positions: ${s.assetPositions?.length || 0}`);
  if (s.assetPositions?.length > 0) {
    s.assetPositions.forEach(p => {
      const pos = p.position || p;
      console.log(`  ${pos.coin}: ${pos.szi > 0 ? 'LONG' : 'SHORT'} size=${pos.szi}, entry=${pos.entryPx}, upnl=${pos.unrealizedPnl}`);
    });
  }
  return s;
}

async function main() {
  console.log('=== LIVE HL TRADING TEST ===\n');
  const controlAddr = wallet.address;

  // Step 1: Sign in
  console.log('--- Step 1: Sign In ---');
  const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();
  const signInNonce = generateGdexNonce().toString();
  const signInMsg = buildGdexSignInMessage(controlAddr, signInNonce, sessionKey);
  const signInSig = await wallet.signMessage(signInMsg);
  const signInPayload = buildGdexSignInComputedData({
    apiKey, userId: controlAddr, sessionKey, nonce: signInNonce,
    signature: signInSig.replace(/^0x/, ''),
  });

  const signInResp = await axios.post(BASE + '/sign_in', {
    computedData: signInPayload.computedData, chainId: 42161,
  }, { headers: HEADERS });
  console.log('Signed in. Managed wallet:', signInResp.data.address);

  // Step 2: Check initial state
  console.log('\n--- Step 2: Initial State ---');
  await checkState('Before trade');

  // Step 3: Get BTC mark price
  console.log('\n--- Step 3: Get BTC Price ---');
  let btcPrice;
  try {
    // Try via HL L1 info API
    const infoResp = await axios.post('https://api.hyperliquid.xyz/info', {
      type: 'allMids',
    }, { headers: { 'Content-Type': 'application/json' } });
    btcPrice = parseFloat(infoResp.data['BTC']);
    console.log('BTC mark price:', btcPrice);
  } catch (e) {
    console.log('Could not get BTC price from HL, using fallback');
    btcPrice = 95000; // fallback
  }

  // Step 4: Open a small BTC long (market order)
  // Use minimum size: 0.001 BTC ~ $95 at current price
  // But we only have $10, so use very small size
  // With 5x leverage, $10 collateral = $50 notional, BTC at ~95k means 0.0005 BTC
  const size = '0.0005';
  const price = Math.round(btcPrice * 1.05).toString(); // 5% above market for market orders
  
  console.log(`\n--- Step 4: Open BTC Long (size=${size}, price=${price}, isMarket=true) ---`);
  
  const orderComputedData = buildHlComputedData({
    action: 'hl_create_order',
    apiKey,
    walletAddress: controlAddr,
    sessionPrivateKey,
    actionParams: {
      coin: 'BTC',
      isLong: true,
      price: price,
      size: size,
      reduceOnly: false,
      tpPrice: '',
      slPrice: '',
      isMarket: true,
    },
  });

  try {
    const orderResp = await axios.post(BASE + '/hl/create_order', {
      computedData: orderComputedData,
    }, { headers: HEADERS });
    console.log('\n✅ ORDER RESPONSE:', JSON.stringify(orderResp.data, null, 2));
  } catch (e) {
    console.log('\n❌ ORDER ERROR:', e.response?.status);
    console.log('Response:', JSON.stringify(e.response?.data, null, 2));
    
    // If it fails, let's also try hl_place_order (no TP/SL)
    console.log('\n--- Trying hl_place_order instead ---');
    const placeComputedData = buildHlComputedData({
      action: 'hl_place_order',
      apiKey,
      walletAddress: controlAddr,
      sessionPrivateKey,
      actionParams: {
        coin: 'BTC',
        isLong: true,
        price: price,
        size: size,
        reduceOnly: false,
      },
    });
    
    try {
      const placeResp = await axios.post(BASE + '/hl/place_order', {
        computedData: placeComputedData,
      }, { headers: HEADERS });
      console.log('\n✅ PLACE ORDER RESPONSE:', JSON.stringify(placeResp.data, null, 2));
    } catch (e2) {
      console.log('\n❌ PLACE ORDER ERROR:', e2.response?.status);
      console.log('Response:', JSON.stringify(e2.response?.data, null, 2));
    }
  }

  // Step 5: Check state after order
  console.log('\n--- Step 5: Post-Trade State ---');
  await new Promise(r => setTimeout(r, 2000)); // Wait 2s for order to fill
  await checkState('After trade');

  // Step 6: Close all positions
  console.log('\n--- Step 6: Close All Positions ---');
  const closeComputedData = buildHlComputedData({
    action: 'hl_close_all',
    apiKey,
    walletAddress: controlAddr,
    sessionPrivateKey,
    actionParams: {},
  });

  try {
    const closeResp = await axios.post(BASE + '/hl/close_all', {
      computedData: closeComputedData,
    }, { headers: HEADERS });
    console.log('✅ CLOSE ALL RESPONSE:', JSON.stringify(closeResp.data, null, 2));
  } catch (e) {
    console.log('❌ CLOSE ALL ERROR:', e.response?.status);
    console.log('Response:', JSON.stringify(e.response?.data, null, 2));
  }

  // Step 7: Final state
  console.log('\n--- Step 7: Final State ---');
  await new Promise(r => setTimeout(r, 2000));
  await checkState('Final');
}

main().catch(e => console.error('Fatal:', e.message));
