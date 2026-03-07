const axios = require('axios');
const { ethers } = require('ethers');
const {
  generateGdexSessionKeyPair,
  buildGdexSignInMessage,
  buildGdexSignInComputedData,
  buildHlComputedData,
  decryptGdexComputedData,
} = require('../dist/index.js');

const mnemonic = 'airport room shoe add offer price divide sell make army say celery';
const apiKey = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';
const BASE = 'https://trade-api.gemach.io/v1';
const wallet = ethers.Wallet.fromPhrase(mnemonic);
const managedAddr = '0x9967179de55bd67e6b90fcc4f908556d93938c0f';

// Match official SDK headers EXACTLY
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

async function run() {
  // Step 1: Sign in
  const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();
  const nonce = String(Date.now());
  const signInMessage = buildGdexSignInMessage(wallet.address, nonce, sessionKey);
  const signature = await wallet.signMessage(signInMessage);
  const signInPayload = buildGdexSignInComputedData({
    apiKey, userId: wallet.address, sessionKey, nonce, signature,
  });

  console.log('Step 1: Sign in...');
  try {
    const signInResp = await axios.post(BASE + '/sign_in', {
      computedData: signInPayload.computedData,
      chainId: 1,
    }, { headers: HEADERS });
    console.log('Sign-in OK:', JSON.stringify(signInResp.data).slice(0, 200));
  } catch (e) {
    console.log('Sign-in error:', e.response?.status, JSON.stringify(e.response?.data)?.slice(0, 200));
  }

  // Step 2: Deposit
  const computedData = buildHlComputedData({
    action: 'hl_deposit',
    apiKey,
    walletAddress: managedAddr,
    sessionPrivateKey,
    actionParams: {
      chainId: 42161,
      tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      amount: '10',
    },
  });

  console.log('\nStep 2: POST /hl/deposit...');
  try {
    const resp = await axios.post(BASE + '/hl/deposit', { computedData }, { headers: HEADERS });
    console.log('Deposit OK:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('Deposit error:', e.response?.status, JSON.stringify(e.response?.data)?.slice(0, 300));
  }

  // Step 3: Get BTC mark price 
  console.log('\nStep 3: Get BTC price...');
  try {
    const resp = await axios.get(BASE + '/hl/user_stats', {
      params: { user_address: managedAddr },
      headers: HEADERS,
    });
    console.log('User stats:', JSON.stringify(resp.data).slice(0, 200));
  } catch (e) {
    console.log('User stats error:', e.response?.status, JSON.stringify(e.response?.data)?.slice(0, 200));
  }
}

run();
