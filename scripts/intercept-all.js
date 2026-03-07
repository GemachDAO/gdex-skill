// Also intercept fetch and axios
const https = require('https');
const { createSDK } = require('gdex.pro-sdk');

// Intercept globalThis.fetch
const origFetch = globalThis.fetch;
if (origFetch) {
  globalThis.fetch = async function(...args) {
    console.log('\n=== INTERCEPTED FETCH ===');
    console.log('Args:', JSON.stringify(args).slice(0, 500));
    return origFetch.apply(this, args);
  };
}

// Intercept https.request
const origReq = https.request;
https.request = function(...args) {
  console.log('\n=== INTERCEPTED HTTPS.REQUEST ===');
  const opts = typeof args[0] === 'string' ? {} : args[0];
  console.log('Host:', opts.hostname, 'Path:', opts.path, 'Method:', opts.method);
  console.log('Headers:', JSON.stringify(opts.headers)?.slice(0, 500));
  return origReq.apply(this, args);
};

// Intercept axios at module level
const axios = require('axios');
const origAxiosPost = axios.default?.post || axios.post;
const origAxiosCreate = axios.create;

// Wrap axios.create to intercept all instances
axios.create = function(...args) {
  console.log('\n=== AXIOS.CREATE ===');
  console.log('Config:', JSON.stringify(args[0])?.slice(0, 500));
  const instance = origAxiosCreate.apply(this, args);
  
  const origPost = instance.post.bind(instance);
  instance.post = async function(url, data, config) {
    console.log('\n=== AXIOS INSTANCE POST ===');
    console.log('URL:', url);
    console.log('Data:', JSON.stringify(data)?.slice(0, 500));
    console.log('Config:', JSON.stringify(config)?.slice(0, 300));
    return origPost(url, data, config);
  };
  
  return instance;
};

// NOW create the SDK (after patching)
const sdk = createSDK('https://trade-api.gemach.io/v1', {
  apiKey: '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54',
});

console.log('hyperLiquid methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(sdk.hyperLiquid)));

async function main() {
  console.log('\n--- Calling hlDeposit ---');
  try {
    const result = await sdk.hyperLiquid.hlDeposit({
      mnemonic: 'airport room shoe add offer price divide sell make army say celery',
      chainId: 42161,
      tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      amount: '10',
    });
    console.log('Result:', JSON.stringify(result));
  } catch (e) {
    console.log('Error thrown:', e.message || JSON.stringify(e));
  }
}

main();
