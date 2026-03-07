const axios = require('axios');
const { ethers, AbiCoder } = require('ethers');
const { CryptoUtils } = require('gdex.pro-sdk');
const {
  generateGdexSessionKeyPair,
  buildGdexSignInMessage,
  buildGdexSignInComputedData,
  decryptGdexComputedData,
} = require('../dist/index.js');

const mnemonic = 'airport room shoe add offer price divide sell make army say celery';
const apiKey = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';
const wallet = ethers.Wallet.fromPhrase(mnemonic);
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
  // Step 1: Sign in using the official SDK's CryptoUtils style
  // Generate a session key pair - use the official SDK's getSessionKey
  const sessionKeyPair = CryptoUtils.getSessionKey();
  console.log('Session pubkey (compressed):', Buffer.from(sessionKeyPair.publicKey).toString('hex'));

  // Build nonce
  const nonce = CryptoUtils.generateUniqueNumber().toString();
  console.log('Nonce:', nonce);

  // Build sign-in message and sign with wallet
  const signInMessage = buildGdexSignInMessage(wallet.address, nonce, Buffer.from(sessionKeyPair.publicKey).toString('hex'));
  const signature = await wallet.signMessage(signInMessage);
  
  // Build sign-in computedData using official SDK's getDataToSendApi
  // First ABI-encode the sign-in data
  const signInData = CryptoUtils.encodeInputData('sign_in', {
    userId: wallet.address,
    nonce,
    sessionKey: Buffer.from(sessionKeyPair.publicKey).toString('hex'),
    signature,
  });
  console.log('Sign-in data exists:', !!signInData);

  // Or just use our working sign-in
  const signInPayload = buildGdexSignInComputedData({
    apiKey,
    userId: wallet.address,
    sessionKey: Buffer.from(sessionKeyPair.publicKey).toString('hex'),
    nonce,
    signature,
  });

  console.log('\n=== Step 1: Sign in ===');
  try {
    const resp = await axios.post(BASE + '/sign_in', {
      computedData: signInPayload.computedData,
      chainId: 1,
    }, { headers: HEADERS });
    console.log('Sign-in OK:', JSON.stringify(resp.data).slice(0, 300));
  } catch (e) {
    console.log('Sign-in error:', e.response?.status, JSON.stringify(e.response?.data)?.slice(0, 300));
    return;
  }

  // Step 2: Build deposit using official SDK's crypto utils but with the SESSION private key
  console.log('\n=== Step 2a: Deposit with session key ===');
  const depositData = CryptoUtils.encodeInputData('hl_deposit', {
    chainId: 42161,
    tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    amount: '10',
    nonce: CryptoUtils.generateUniqueNumber().toString(),
  });
  
  // Sign with session private key (as hex string with 0x prefix for the sign function)
  const sessionPrivKeyHex = '0x' + Buffer.from(sessionKeyPair.privateKey).toString('hex');
  const depositSig = CryptoUtils.sign(depositData, sessionPrivKeyHex);
  
  // Build computedData - use CONTROL wallet address as userId (like official SDK)
  const depositComputed = CryptoUtils.getDataToSendApi(
    wallet.address,  // control wallet!
    depositData,
    depositSig,
    apiKey
  );

  try {
    const resp = await axios.post(BASE + '/hl/deposit', {
      computedData: depositComputed,
    }, { headers: HEADERS });
    console.log('Deposit with session key OK:', JSON.stringify(resp.data).slice(0, 300));
  } catch (e) {
    console.log('Deposit with session key error:', e.response?.status, JSON.stringify(e.response?.data)?.slice(0, 300));
  }

  // Step 2b: Also try with wallet private key
  console.log('\n=== Step 2b: Deposit with wallet key ===');
  const depositData2 = CryptoUtils.encodeInputData('hl_deposit', {
    chainId: 42161,
    tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    amount: '10',
    nonce: CryptoUtils.generateUniqueNumber().toString(),
  });
  
  const depositSig2 = CryptoUtils.sign(depositData2, wallet.privateKey);
  const depositComputed2 = CryptoUtils.getDataToSendApi(
    wallet.address,
    depositData2,
    depositSig2,
    apiKey
  );

  try {
    const resp = await axios.post(BASE + '/hl/deposit', {
      computedData: depositComputed2,
    }, { headers: HEADERS });
    console.log('Deposit with wallet key OK:', JSON.stringify(resp.data).slice(0, 300));
  } catch (e) {
    console.log('Deposit with wallet key error:', e.response?.status, JSON.stringify(e.response?.data)?.slice(0, 300));
  }
}

main().catch(e => console.error('Fatal:', e));
