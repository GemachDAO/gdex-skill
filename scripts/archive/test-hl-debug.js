const axios = require('axios');
const { ethers } = require('ethers');
const {
  generateGdexSessionKeyPair,
  buildGdexSignInMessage,
  buildGdexSignInComputedData,
} = require('../dist/index.js');
const { CryptoUtils, createSDK } = require('gdex.pro-sdk');

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
  // Step 1: Sign in  
  const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();
  const nonce = String(Date.now());
  const signInMessage = buildGdexSignInMessage(wallet.address, nonce, sessionKey);
  const signature = await wallet.signMessage(signInMessage);
  const signInPayload = buildGdexSignInComputedData({
    apiKey, userId: wallet.address, sessionKey, nonce, signature,
  });

  console.log('=== Step 1: Sign in ===');
  let signInResp;
  try {
    const resp = await axios.post(BASE + '/sign_in', {
      computedData: signInPayload.computedData,
      chainId: 1,
    }, { headers: HEADERS });
    signInResp = resp.data;
    console.log('Sign-in OK:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('Sign-in error:', e.response?.status, JSON.stringify(e.response?.data));
    return;
  }

  // Step 2: Check various HL endpoints
  console.log('\n=== Step 2: Check HL account state ===');
  try {
    const resp = await axios.get(BASE + '/hl/user_stats', {
      params: { user_address: managedAddr },
      headers: HEADERS,
    });
    console.log('User stats:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('User stats error:', e.response?.status, JSON.stringify(e.response?.data));
  }

  // Step 3: HL GBOT USDC balance
  console.log('\n=== Step 3: HL GBOT USDC balance ===');
  try {
    const resp = await axios.get(BASE + '/hl/gbot_usdc_balance', {
      params: { address: wallet.address },
      headers: HEADERS,
    });
    console.log('GBOT balance:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('GBOT balance error:', e.response?.status, JSON.stringify(e.response?.data));
  }

  // Step 4: Try different HL endpoints
  const endpoints = [
    '/hl/clearinghouse_state',
    '/hl/trade_history',  
    '/hl/open_orders',
    '/hl/historical_orders',
    '/hl/mark_price',
  ];

  for (const ep of endpoints) {
    console.log(`\n=== ${ep} ===`);
    try {
      const resp = await axios.get(BASE + ep, {
        params: { user_address: managedAddr, coin: 'BTC' },
        headers: HEADERS,
      });
      console.log('Response:', JSON.stringify(resp.data).slice(0, 200));
    } catch (e) {
      console.log('Error:', e.response?.status, JSON.stringify(e.response?.data)?.slice(0, 200));
    }
  }

  // Step 5: Use the encrypted session data for authenticated endpoints
  console.log('\n=== Step 5: HL deposit with encrypted session data ===');
  const sessionData = CryptoUtils.getDataToSendApi(
    wallet.address,
    CryptoUtils.encodeInputData('hl_deposit', {
      chainId: 42161,
      tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      amount: '10',
      nonce: CryptoUtils.generateUniqueNumber().toString(),
    }),
    CryptoUtils.sign(
      CryptoUtils.encodeInputData('hl_deposit', {
        chainId: 42161,
        tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        amount: '10',
        nonce: CryptoUtils.generateUniqueNumber().toString(),
      }),
      wallet.privateKey
    ),
    apiKey
  );
  
  // Try POST with both regular and postDirect style
  try {
    const resp = await axios.post(BASE + '/hl/deposit', { computedData: sessionData }, { headers: HEADERS });
    console.log('Deposit OK:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('Deposit error:', e.response?.status, JSON.stringify(e.response?.data));
  }

  // Step 6: Check on-chain balance of the managed wallet
  console.log('\n=== Step 6: Check Arbitrum USDC balance ===');
  const arbRpc = 'https://arb1.arbitrum.io/rpc';
  const usdcContract = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
  const balanceOfSelector = '0x70a08231000000000000000000000000';
  try {
    const calldata = balanceOfSelector + managedAddr.slice(2).padStart(64, '0');
    const resp = await axios.post(arbRpc, {
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to: usdcContract, data: calldata }, 'latest'],
      id: 1,
    });
    const balance = parseInt(resp.data.result, 16);
    console.log('Managed wallet USDC balance (Arbitrum):', balance / 1e6, 'USDC');
  } catch (e) {
    console.log('RPC error:', e.message);
  }

  // Also check control wallet balance
  try {
    const calldata = balanceOfSelector + wallet.address.slice(2).padStart(64, '0');
    const resp = await axios.post(arbRpc, {
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to: usdcContract, data: calldata }, 'latest'],
      id: 1,
    });
    const balance = parseInt(resp.data.result, 16);
    console.log('Control wallet USDC balance (Arbitrum):', balance / 1e6, 'USDC');
  } catch (e) {
    console.log('RPC error:', e.message);
  }
}

main().catch(e => console.error('Fatal:', e));
