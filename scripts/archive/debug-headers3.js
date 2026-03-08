// Decode all the headers the official SDK sets
const { GDEXSDK, createSDK } = require('gdex.pro-sdk');

// Create SDK with the proper constructor
const sdk = createSDK('https://trade-api.gemach.io/v1', {
  apiKey: '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54',
});

// Access the real HttpClient
const client = sdk.httpClient.getClient();
console.log('BaseURL:', client.defaults.baseURL);
console.log('Timeout:', client.defaults.timeout);
console.log('\nALL Default Headers:');
console.log(JSON.stringify(client.defaults.headers, null, 2));

// Also check interceptors
console.log('\nRequest interceptors:', client.interceptors.request.handlers.length);
console.log('Response interceptors:', client.interceptors.response.handlers.length);
