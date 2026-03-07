/**
 * Live HL deposit test using our built SDK directly.
 */
const { ethers } = require('ethers');
const { randomBytes } = require('crypto');
const { SigningKey } = require('ethers');

// Import from our built dist
const {
  encryptGdexComputedData,
  encodeGdexSignInData,
  buildGdexSignInComputedData,
  buildGdexSignInMessage,
  encodeHlActionData,
  signHlActionMessage,
  buildEncryptedGdexPayload,
  generateGdexSessionKeyPair,
  generateGdexNonce,
  buildHlComputedData,
} = require('../dist/utils/gdexManagedCrypto');

const axios = require('axios');

// ── Config ──────────────────────────────────────────────────────────────────
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
  'Authorization': `Bearer ${apiKey}`,
};

async function main() {
  console.log('=== LIVE HL DEPOSIT TEST v2 (using built SDK) ===\n');

  const controlAddr = wallet.address;
  console.log('Control wallet:', controlAddr);

  // Step 1: Generate session keypair
  const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();
  console.log('Session key:', sessionKey.slice(0, 20) + '...');

  // Step 2: Sign in using our SDK's buildGdexSignInComputedData
  console.log('\n--- Step 2: Sign In ---');
  const signInNonce = generateGdexNonce().toString();
  
  // Build message and get control wallet to sign it
  const signInMsg = buildGdexSignInMessage(controlAddr, signInNonce, sessionKey);
  console.log('Sign-in message:', signInMsg.slice(0, 80) + '...');
  const signInSig = await wallet.signMessage(signInMsg);
  const signInSigHex = signInSig.replace(/^0x/, '');

  // Build encrypted payload using SDK's function
  const signInPayload = buildGdexSignInComputedData({
    apiKey,
    userId: controlAddr,
    sessionKey,
    nonce: signInNonce,
    signature: signInSigHex,
  });

  console.log('Sign-in computedData length:', signInPayload.computedData.length);
  
  try {
    const resp = await axios.post(BASE + '/sign_in', {
      computedData: signInPayload.computedData,
      chainId: 42161,
    }, { headers: HEADERS });
    console.log('Sign-in response:', JSON.stringify(resp.data).slice(0, 300));
    if (!resp.data.address) {
      console.log('Sign-in failed, aborting');
      return;
    }
    console.log('✅ Signed in! Managed wallet:', resp.data.address);
  } catch (e) {
    console.log('Sign-in error:', e.response?.status, JSON.stringify(e.response?.data)?.slice(0, 500));
    return;
  }

  // Step 3: Deposit 10 USDC using SDK's buildHlComputedData (with uint64 fix)
  console.log('\n--- Step 3: HL Deposit (10 USDC) ---');
  const chainId = 42161;
  const tokenAddress = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
  const amountSmallestUnit = '10000000'; // 10 USDC = 10 * 10^6

  const computedData = buildHlComputedData({
    action: 'hl_deposit',
    apiKey,
    walletAddress: controlAddr,
    sessionPrivateKey,
    actionParams: {
      chainId,
      tokenAddress,
      amount: amountSmallestUnit,
    },
  });

  console.log('Deposit computedData length:', computedData.length);

  try {
    const resp = await axios.post(BASE + '/hl/deposit', { computedData }, { headers: HEADERS });
    console.log('\n✅ DEPOSIT RESPONSE:', JSON.stringify(resp.data, null, 2));
  } catch (e) {
    console.log('\n❌ DEPOSIT ERROR:', e.response?.status);
    console.log('Response:', JSON.stringify(e.response?.data, null, 2));
  }
}

main().catch(e => console.error('Fatal:', e.message));
