const { createSDK } = require('gdex.pro-sdk');
const { ethers } = require('ethers');

const mnemonic = 'airport room shoe add offer price divide sell make army say celery';
const apiKey = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';
const wallet = ethers.Wallet.fromPhrase(mnemonic);
const managedAddr = '0x9967179de55bd67e6b90fcc4f908556d93938c0f';

const sdk = createSDK('https://trade-api.gemach.io/v1', { apiKey });

// Intercept the httpClient's post method
const origPost = sdk.httpClient.post.bind(sdk.httpClient);
sdk.httpClient.post = async function(url, data, config) {
  console.log('\n=== HTTP CLIENT POST ===');
  console.log('URL:', url);
  console.log('Data keys:', data ? Object.keys(data) : 'none');
  if (data?.computedData) {
    console.log('computedData (first 200):', data.computedData.slice(0, 200));
  }
  console.log('========================\n');
  return origPost(url, data, config);
};

const origPostDirect = sdk.httpClient.postDirect.bind(sdk.httpClient);
sdk.httpClient.postDirect = async function(url, data, config) {
  console.log('\n=== HTTP CLIENT POST DIRECT ===');
  console.log('URL:', url);
  console.log('Data:', JSON.stringify(data)?.slice(0, 500));
  console.log('================================\n');
  return origPostDirect(url, data, config);
};

async function main() {
  // Call with correct positional args per type definition:
  // hlDeposit(address, tokenAddress, amount, chainId, privateKey)
  console.log('Calling hlDeposit with positional args...');
  console.log('Wallet address:', wallet.address);
  console.log('Private key (first 10):', wallet.privateKey.slice(0, 12) + '...');
  
  try {
    const result = await sdk.hyperLiquid.hlDeposit(
      wallet.address,
      '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      '10',
      42161,
      wallet.privateKey
    );
    console.log('Result:', JSON.stringify(result));
  } catch (e) {
    console.log('Error:', e.message || JSON.stringify(e)?.slice(0, 500));
  }
}

main();
