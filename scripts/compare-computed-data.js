const { createSDK } = require('gdex.pro-sdk');
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
const wallet = ethers.Wallet.fromPhrase(mnemonic);
const managedAddr = '0x9967179de55bd67e6b90fcc4f908556d93938c0f';

const sdk = createSDK('https://trade-api.gemach.io/v1', { apiKey });

// Intercept the SDK's postDirect to capture computedData
let officialComputedData = null;
const origPostDirect = sdk.httpClient.postDirect.bind(sdk.httpClient);
sdk.httpClient.postDirect = async function(url, data, config) {
  if (url === '/hl/deposit' && data?.computedData) {
    officialComputedData = data.computedData;
    // Don't actually send - just capture
    throw { code: 'INTERCEPTED', message: 'Intercepted for comparison' };
  }
  return origPostDirect(url, data, config);
};

async function main() {
  // Generate our session key
  const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();

  // Capture official SDK's computedData  
  console.log('=== Official SDK hlDeposit computedData ===');
  try {
    await sdk.hyperLiquid.hlDeposit(
      wallet.address,
      '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      '10',
      42161,
      wallet.privateKey
    );
  } catch (e) {
    // Expected - we intercepted it
  }

  if (officialComputedData) {
    console.log('Official computedData length:', officialComputedData.length);
    try {
      const decrypted = decryptGdexComputedData(officialComputedData, apiKey);
      console.log('Official decrypted:', decrypted);
      const parsed = JSON.parse(decrypted);
      console.log('\nOfficial userId:', parsed.userId);
      console.log('Official data (hex):', parsed.data?.slice(0, 100) + '...');
      console.log('Official signature:', parsed.signature?.slice(0, 40) + '...');
      console.log('Official signature length:', parsed.signature?.length);
    } catch (e) {
      console.log('Decrypt error:', e.message);
    }
  } else {
    console.log('No computedData captured from official SDK!');
  }

  // Build our computedData
  console.log('\n=== Our computedData ===');
  const ourComputedData = buildHlComputedData({
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

  console.log('Our computedData length:', ourComputedData.length);
  const ourDecrypted = decryptGdexComputedData(ourComputedData, apiKey);
  console.log('Our decrypted:', ourDecrypted);
  const ourParsed = JSON.parse(ourDecrypted);
  console.log('\nOur userId:', ourParsed.userId);
  console.log('Our data (hex):', ourParsed.data?.slice(0, 100) + '...');
  console.log('Our signature:', ourParsed.signature?.slice(0, 40) + '...');
  console.log('Our signature length:', ourParsed.signature?.length);

  // Compare the ABI-decoded data
  const { AbiCoder } = require('ethers');
  const coder = new AbiCoder();
  
  if (officialComputedData) {
    const officialParsed = JSON.parse(decryptGdexComputedData(officialComputedData, apiKey));
    
    console.log('\n=== ABI-decoded comparison ===');
    const officialDecoded = coder.decode(
      ['uint256', 'address', 'uint256', 'string'],
      '0x' + officialParsed.data
    );
    console.log('Official ABI:', {
      chainId: officialDecoded[0].toString(),
      tokenAddress: officialDecoded[1],
      amount: officialDecoded[2].toString(),
      nonce: officialDecoded[3],
    });

    const ourDecoded = coder.decode(
      ['uint256', 'address', 'uint256', 'string'],
      '0x' + ourParsed.data
    );
    console.log('Our ABI:', {
      chainId: ourDecoded[0].toString(),
      tokenAddress: ourDecoded[1],
      amount: ourDecoded[2].toString(),
      nonce: ourDecoded[3],
    });

    // Compare userId values
    console.log('\n=== Key differences ===');
    console.log('Official userId:', officialParsed.userId);
    console.log('Our userId:     ', ourParsed.userId);
    console.log('userId match:', officialParsed.userId === ourParsed.userId);
    
    console.log('\nWallet address:', wallet.address);
    console.log('Managed address:', managedAddr);
  }
}

main().catch(e => console.error('Fatal:', e));
