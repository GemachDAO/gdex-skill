const axios = require('axios');
const { ethers, AbiCoder } = require('ethers');
const { keccak256 } = require('js-sha3');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const { CryptoUtils } = require('gdex.pro-sdk');
const {
  generateGdexSessionKeyPair,
  buildGdexSignInMessage,
  buildGdexSignInComputedData,
  generateGdexNonce,
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

// Replicate officialSDK sign: keccak256 of data STRING, signed with elliptic
function signLikeOfficialSDK(dataHex, privateKeyHex) {
  const hash = keccak256(dataHex); // hash the hex STRING itself
  const key = ec.keyFromPrivate(privateKeyHex.replace('0x', ''));
  const sig = key.sign(hash, 'hex', { canonical: true });
  const r = sig.r.toString('hex').padStart(64, '0');
  const s = sig.s.toString('hex').padStart(64, '0');
  const v = sig.recoveryParam.toString(16).padStart(2, '0');
  return r + s + v;
}

// Replicate officialSDK getDataToSendApi: {userId, data, signature} → objectToHex → encrypt
function buildComputedData(userId, dataHex, signatureHex, apiKey) {
  return CryptoUtils.getDataToSendApi(userId, dataHex, signatureHex, apiKey);
}

async function main() {
  // Step 1: Sign in — register session key
  const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();
  console.log('Session key (public):', sessionKey);
  console.log('Session privkey (first 8):', sessionPrivateKey.slice(0, 10) + '...');

  const nonce = String(Date.now());
  const signInMessage = buildGdexSignInMessage(wallet.address, nonce, sessionKey);
  const signature = await wallet.signMessage(signInMessage);
  const signInPayload = buildGdexSignInComputedData({
    apiKey, userId: wallet.address, sessionKey, nonce, signature,
  });

  console.log('\n=== Step 1: Sign in ===');
  try {
    const resp = await axios.post(BASE + '/sign_in', {
      computedData: signInPayload.computedData,
      chainId: 1,
    }, { headers: HEADERS });
    console.log('Sign-in OK:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('Sign-in error:', e.response?.status, JSON.stringify(e.response?.data));
    return;
  }

  // Step 2a: Deposit signed with SESSION KEY (the one registered during sign-in)
  // Using official SDK's signing method (hash just dataHex, not action-address-data)
  console.log('\n=== Step 2a: Deposit with session key + official signing + CONTROL wallet userId ===');
  const abiCoder = AbiCoder.defaultAbiCoder();
  const depositNonce1 = generateGdexNonce().toString();
  const depositData1 = abiCoder.encode(
    ['uint256', 'address', 'uint256', 'string'],
    [42161, '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 10, depositNonce1]
  ).slice(2); // remove 0x prefix

  const depositSig1 = signLikeOfficialSDK(depositData1, sessionPrivateKey);
  const computed1 = buildComputedData(wallet.address, depositData1, depositSig1, apiKey);

  try {
    const resp = await axios.post(BASE + '/hl/deposit', { computedData: computed1 }, { headers: HEADERS });
    console.log('SUCCESS:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('Error:', e.response?.status, JSON.stringify(e.response?.data));
  }

  // Step 2b: Deposit signed with WALLET KEY + official signing + CONTROL wallet userId
  console.log('\n=== Step 2b: Deposit with wallet key + official signing + CONTROL wallet userId ===');
  const depositNonce2 = generateGdexNonce().toString();
  const depositData2 = abiCoder.encode(
    ['uint256', 'address', 'uint256', 'string'],
    [42161, '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 10, depositNonce2]
  ).slice(2);

  const depositSig2 = signLikeOfficialSDK(depositData2, wallet.privateKey);
  const computed2 = buildComputedData(wallet.address, depositData2, depositSig2, apiKey);

  try {
    const resp = await axios.post(BASE + '/hl/deposit', { computedData: computed2 }, { headers: HEADERS });
    console.log('SUCCESS:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('Error:', e.response?.status, JSON.stringify(e.response?.data));
  }

  // Step 2c: Deposit with session key + MANAGED wallet userId  
  console.log('\n=== Step 2c: Deposit with session key + official signing + MANAGED wallet userId ===');
  const managedAddr = '0x9967179de55bd67e6b90fcc4f908556d93938c0f';
  const depositNonce3 = generateGdexNonce().toString();
  const depositData3 = abiCoder.encode(
    ['uint256', 'address', 'uint256', 'string'],
    [42161, '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 10, depositNonce3]
  ).slice(2);

  const depositSig3 = signLikeOfficialSDK(depositData3, sessionPrivateKey);
  const computed3 = buildComputedData(managedAddr, depositData3, depositSig3, apiKey);

  try {
    const resp = await axios.post(BASE + '/hl/deposit', { computedData: computed3 }, { headers: HEADERS });
    console.log('SUCCESS:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('Error:', e.response?.status, JSON.stringify(e.response?.data));
  }
}

main().catch(e => console.error('Fatal:', e));
