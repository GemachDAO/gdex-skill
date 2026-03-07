const { createSDK } = require('gdex.pro-sdk');
const { ethers } = require('ethers');
const {
  generateGdexSessionKeyPair,
  buildGdexSignInMessage,
  buildGdexSignInComputedData,
  buildHlComputedData,
} = require('../dist/index.js');

const mnemonic = 'airport room shoe add offer price divide sell make army say celery';
const apiKey = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';
const wallet = ethers.Wallet.fromPhrase(mnemonic);
const managedAddr = '0x9967179de55bd67e6b90fcc4f908556d93938c0f';

const sdk = createSDK('https://trade-api.gemach.io/v1', { apiKey });

// Intercept all HTTP calls
const origPostDirect = sdk.httpClient.postDirect.bind(sdk.httpClient);
sdk.httpClient.postDirect = async function(url, data, config) {
  console.log(`\n[POST_DIRECT] ${url}`);
  console.log('[POST_DIRECT] Data:', JSON.stringify(data)?.slice(0, 400));
  const result = await origPostDirect(url, data, config);
  console.log('[POST_DIRECT] Response:', JSON.stringify(result)?.slice(0, 400));
  return result;
};

async function main() {
  // Step 1: Sign in using OUR working sign-in flow (via raw SDK httpClient)
  const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();
  const nonce = String(Date.now());
  const signInMessage = buildGdexSignInMessage(wallet.address, nonce, sessionKey);
  const signature = await wallet.signMessage(signInMessage);
  const signInPayload = buildGdexSignInComputedData({
    apiKey, userId: wallet.address, sessionKey, nonce, signature,
  });

  console.log('=== Step 1: Sign in via postDirect ===');
  try {
    const signInResult = await sdk.httpClient.postDirect('/sign_in', {
      computedData: signInPayload.computedData,
      chainId: 1,
    });
    console.log('Sign-in result:', JSON.stringify(signInResult)?.slice(0, 300));
  } catch (e) {
    console.log('Sign-in error:', e.message || JSON.stringify(e)?.slice(0, 300));
  }

  // Step 2: Now use the official SDK's hlDeposit
  console.log('\n=== Step 2: Official SDK hlDeposit ===');
  try {
    const result = await sdk.hyperLiquid.hlDeposit(
      wallet.address,
      '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      '10',
      42161,
      wallet.privateKey
    );
    console.log('Deposit result:', JSON.stringify(result)?.slice(0, 400));
  } catch (e) {
    console.log('Deposit error:', e.message || JSON.stringify(e)?.slice(0, 300));
  }

  // Step 3: Also try using OUR computedData but through the official SDK's httpClient
  console.log('\n=== Step 3: Our computedData via official httpClient ===');
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
  
  try {
    const result = await sdk.httpClient.postDirect('/hl/deposit', { computedData });
    console.log('Our deposit result:', JSON.stringify(result)?.slice(0, 400));
  } catch (e) {
    console.log('Our deposit error:', JSON.stringify(e)?.slice(0, 500));
  }
}

main();
