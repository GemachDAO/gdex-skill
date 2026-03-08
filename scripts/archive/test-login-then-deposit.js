const { createSDK } = require('gdex.pro-sdk');
const { ethers } = require('ethers');

const mnemonic = 'airport room shoe add offer price divide sell make army say celery';
const apiKey = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';
const wallet = ethers.Wallet.fromPhrase(mnemonic);

const sdk = createSDK('https://trade-api.gemach.io/v1', { apiKey });

// Intercept all HTTP calls
const origPost = sdk.httpClient.post.bind(sdk.httpClient);
sdk.httpClient.post = async function(url, data, config) {
  console.log(`\n[POST] ${url}`);
  console.log('[POST] Data:', JSON.stringify(data)?.slice(0, 300));
  const result = await origPost(url, data, config);
  console.log('[POST] Response:', JSON.stringify(result)?.slice(0, 300));
  return result;
};

const origPostDirect = sdk.httpClient.postDirect.bind(sdk.httpClient);
sdk.httpClient.postDirect = async function(url, data, config) {
  console.log(`\n[POST_DIRECT] ${url}`);
  console.log('[POST_DIRECT] Data:', JSON.stringify(data)?.slice(0, 300));
  const result = await origPostDirect(url, data, config);
  console.log('[POST_DIRECT] Response:', JSON.stringify(result)?.slice(0, 300));
  return result;
};

const origGet = sdk.httpClient.get.bind(sdk.httpClient);
sdk.httpClient.get = async function(url, config) {
  console.log(`\n[GET] ${url}`);
  const result = await origGet(url, config);
  console.log('[GET] Response:', JSON.stringify(result)?.slice(0, 300));
  return result;
};

const origGetDirect = sdk.httpClient.getDirect.bind(sdk.httpClient);
sdk.httpClient.getDirect = async function(url, config) {
  console.log(`\n[GET_DIRECT] ${url}`);
  const result = await origGetDirect(url, config);
  console.log('[GET_DIRECT] Response:', JSON.stringify(result)?.slice(0, 300));
  return result;
};

async function main() {
  // Step 1: Login via official SDK
  console.log('=== Step 1: Login ===');
  try {
    const loginResult = await sdk.user.login(
      wallet.address,
      wallet.privateKey,
      1  // chainId
    );
    console.log('Login result:', JSON.stringify(loginResult)?.slice(0, 300));
  } catch (e) {
    console.log('Login error:', e.message || JSON.stringify(e)?.slice(0, 300));
  }

  // Step 2: Try deposit after login
  console.log('\n=== Step 2: Deposit ===');
  try {
    const result = await sdk.hyperLiquid.hlDeposit(
      wallet.address,
      '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      '10',
      42161,
      wallet.privateKey
    );
    console.log('Deposit result:', JSON.stringify(result)?.slice(0, 300));
  } catch (e) {
    console.log('Deposit error:', e.message || JSON.stringify(e)?.slice(0, 300));
  }
}

main();
