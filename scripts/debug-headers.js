const { HyperLiquidAPI } = require('gdex.pro-sdk');
const fs = require('fs');

const api = new HyperLiquidAPI({
  apiKey: '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54',
  apiUrl: 'https://trade-api.gemach.io/v1',
});

// Get all property names (including private/obfuscated)
const allKeys = Object.keys(api);
console.log('API instance keys:', allKeys);

// Look for httpClient
for (const key of allKeys) {
  const val = api[key];
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const subKeys = Object.keys(val);
    if (subKeys.some(k => k.includes('client') || k.includes('Client') || k.includes('axios') || k.includes('http'))) {
      console.log(`\n${key} has sub-keys:`, subKeys);
    }
    // Check if it has a getClient method
    if (typeof val.getClient === 'function') {
      console.log(`\n${key}.getClient() exists!`);
      const client = val.getClient();
      console.log('Headers:', JSON.stringify(client.defaults.headers, null, 2));
      console.log('BaseURL:', client.defaults.baseURL);
    }
  }
}

// Also search SDK source for header patterns
const sdkPath = require.resolve('gdex.pro-sdk');
const sdkCode = fs.readFileSync(sdkPath, 'utf8');

// Look for x- headers, Origin, Referer, or header setting patterns  
const patterns = [
  /["']x-[a-z-]+["']/gi,
  /["']Origin["']/gi,
  /["']Referer["']/gi,
  /headers\s*[=:]\s*\{[^}]{0,300}\}/g,
  /["']User-Agent["']/gi,
  /["']x-api[^"']*["']/gi,
];

for (const pat of patterns) {
  const matches = sdkCode.match(pat);
  if (matches) {
    console.log(`\nPattern ${pat}:`, [...new Set(matches)]);
  }
}
