// Intercept the official SDK's actual HTTP request for hlDeposit
const http = require('http');
const https = require('https');
const { GDEXSDK, createSDK } = require('gdex.pro-sdk');

// Monkey-patch https.request to intercept actual network calls
const origRequest = https.request;
let capturedRequests = [];

https.request = function(urlOrOptions, optionsOrCallback, callback) {
  let options;
  if (typeof urlOrOptions === 'string' || urlOrOptions instanceof URL) {
    options = typeof optionsOrCallback === 'object' ? optionsOrCallback : {};
    options._url = urlOrOptions.toString();
  } else {
    options = urlOrOptions;
  }

  const req = origRequest.apply(this, arguments);

  // Capture request details
  const captured = {
    method: options.method || 'GET',
    hostname: options.hostname || options.host,
    path: options.path,
    url: options._url,
    headers: options.headers,
  };

  // Intercept write to capture body
  const origWrite = req.write.bind(req);
  const origEnd = req.end.bind(req);
  let body = '';

  req.write = function(chunk) {
    body += chunk.toString();
    return origWrite(chunk);
  };

  req.end = function(chunk) {
    if (chunk) body += chunk.toString();
    captured.body = body;
    capturedRequests.push(captured);
    console.log('\n=== INTERCEPTED REQUEST ===');
    console.log('Method:', captured.method);
    console.log('Host:', captured.hostname);
    console.log('Path:', captured.path);
    console.log('URL:', captured.url);
    console.log('Headers:', JSON.stringify(captured.headers, null, 2));
    console.log('Body:', body.slice(0, 500));
    console.log('=========================\n');
    return origEnd(chunk);
  };

  return req;
};

async function main() {
  const sdk = createSDK('https://trade-api.gemach.io/v1', {
    apiKey: '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54',
  });

  console.log('Calling hlDeposit via official SDK...');
  try {
    const result = await sdk.hyperLiquid.hlDeposit({
      mnemonic: 'airport room shoe add offer price divide sell make army say celery',
      chainId: 42161,
      tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      amount: '10',
    });
    console.log('Result:', JSON.stringify(result));
  } catch (e) {
    console.log('Error:', JSON.stringify(e)?.slice(0, 500));
    console.log('Error message:', e.message || e.error);
  }
}

main();
