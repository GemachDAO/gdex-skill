const axios = require('axios');
const { ethers } = require('ethers');
const { CryptoUtils, createSDK } = require('gdex.pro-sdk');
const { generateGdexSessionKeyPair, buildGdexSignInMessage, buildGdexSignInComputedData } = require('../dist/index.js');

const mnemonic = 'airport room shoe add offer price divide sell make army say celery';
const apiKey = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';
const wallet = ethers.Wallet.fromPhrase(mnemonic);
const managedAddr = '0x9967179de55bd67e6b90fcc4f908556d93938c0f';
const BASE = 'https://trade-api.gemach.io/v1';

const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Authorization': `Bearer ${apiKey}`,
};

async function main() {
  // Sign in first
  const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();
  const nonce = String(Date.now());
  const msg = buildGdexSignInMessage(wallet.address, nonce, sessionKey);
  const sig = await wallet.signMessage(msg);
  const payload = buildGdexSignInComputedData({ apiKey, userId: wallet.address, sessionKey, nonce, signature: sig });

  const resp = await axios.post(BASE + '/sign_in', {
    computedData: payload.computedData, chainId: 1,
  }, { headers: HEADERS });
  console.log('Signed in OK');

  // Try deposit from official SDK with different amounts
  const sdk = createSDK('https://trade-api.gemach.io/v1', { apiKey });

  // Test 1: amount with decimals (10 * 10^6 = 10000000)
  console.log('\n=== Test 1: amount=10000000 (10 USDC * 10^6) ===');
  try {
    const r = await sdk.hyperLiquid.hlDeposit(wallet.address, '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', '10000000', 42161, wallet.privateKey);
    console.log('Result:', JSON.stringify(r));
  } catch (e) {
    console.log('Error:', e.message || JSON.stringify(e));
  }

  // Test 2: with managed address as first arg
  console.log('\n=== Test 2: managed addr ===');
  try {
    const r = await sdk.hyperLiquid.hlDeposit(managedAddr, '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', '10', 42161, wallet.privateKey);
    console.log('Result:', JSON.stringify(r));
  } catch (e) {
    console.log('Error:', e.message || JSON.stringify(e));
  }

  // Test 3: Only 3 args (as README shows)
  console.log('\n=== Test 3: 3-arg version (as README shows) ===');
  try {
    const r = await sdk.hyperLiquid.hlDeposit(wallet.address, '10', wallet.privateKey);
    console.log('Result:', JSON.stringify(r));
  } catch (e) {
    console.log('Error:', e.message || JSON.stringify(e));
  }

  // Test 4: Check if we need a different apiKey format
  console.log('\n=== Test 4: Try without sign-in via fresh SDK ===');
  const sdk2 = createSDK('https://trade-api.gemach.io/v1', { apiKey });
  try {
    const r = await sdk2.hyperLiquid.hlDeposit(wallet.address, '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', '10', 42161, wallet.privateKey);
    console.log('Result:', JSON.stringify(r));
  } catch (e) {
    console.log('Error:', e.message || JSON.stringify(e));
  }

  // Test 5: Try spot buy to see if regular trading works
  console.log('\n=== Test 5: Check spot trading (buy) ===');
  try {
    const r = await sdk.trading.buy(
      wallet.address,
      '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
      '1',
      42161,
      '100',
      wallet.privateKey,
    );
    console.log('Spot buy result:', JSON.stringify(r)?.slice(0, 300));
  } catch (e) {
    console.log('Spot buy error:', JSON.stringify(e)?.slice(0, 300));
  }
}

main().catch(e => console.error('Fatal:', e));
