const { HyperLiquidAPI } = require('gdex.pro-sdk');
const fs = require('fs');
const http = require('http');
const https = require('https');

const api = new HyperLiquidAPI({
  apiKey: '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54',
  apiUrl: 'https://trade-api.gemach.io/v1',
});

const hc = api.httpClient;
console.log('httpClient type:', typeof hc);
console.log('httpClient keys:', Object.keys(hc));
console.log('httpClient proto:', Object.getOwnPropertyNames(Object.getPrototypeOf(hc)));

// Try getClient
if (typeof hc.getClient === 'function') {
  const c = hc.getClient();
  console.log('\nAxios defaults.headers:', JSON.stringify(c.defaults.headers, null, 2));
  console.log('Axios defaults.baseURL:', c.defaults.baseURL);

  // Check interceptors
  console.log('\nRequest interceptors count:', c.interceptors.request.handlers.length);
  c.interceptors.request.handlers.forEach((h, i) => {
    console.log(`Interceptor ${i} fulfilled:`, h.fulfilled?.toString().slice(0, 300));
  });
}

// Search the actual SDK code for headers
const sdkPath = require.resolve('gdex.pro-sdk');
const sdkCode = fs.readFileSync(sdkPath, 'utf8');

// Find all string literals that look like HTTP header names
const headerLike = sdkCode.match(/["']((?:x-|X-|content-|Content-|accept|Accept|origin|Origin|referer|Referer|authorization|Authorization|user-agent|User-Agent)[^"']{0,30})["']/g);
if (headerLike) {
  console.log('\nHeader-like strings in SDK:', [...new Set(headerLike)]);
}

// Also try to intercept actual HTTP requests by monkey-patching
const origRequest = https.request;
https.request = function(options, cb) {
  console.log('\n=== INTERCEPTED HTTPS REQUEST ===');
  console.log('URL:', typeof options === 'string' ? options : `${options.protocol}//${options.hostname}${options.path}`);
  console.log('Method:', options.method);
  console.log('Headers:', JSON.stringify(options.headers, null, 2));
  return origRequest.apply(this, arguments);
};

// Now make a call via official SDK
console.log('\n--- Making hlDeposit call via official SDK ---');
api.hlDeposit({
  mnemonic: 'airport room shoe add offer price divide sell make army say celery',
  chainId: 42161,
  tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  amount: '10',
}).then(r => {
  console.log('Result:', JSON.stringify(r));
}).catch(e => {
  console.log('Error:', e.response?.status, JSON.stringify(e.response?.data)?.slice(0, 200));
  console.log('Error msg:', e.message?.slice(0, 200));
});
