const fs = require('fs');

// Read the SDK source
const sdkPath = require.resolve('gdex.pro-sdk');
const sdkCode = fs.readFileSync(sdkPath, 'utf8');

// Check what HTTP library it uses
console.log('Uses axios:', sdkCode.includes('axios'));
console.log('Uses fetch:', sdkCode.includes('fetch(') || sdkCode.includes('fetch ('));
console.log('Uses XMLHttpRequest:', sdkCode.includes('XMLHttpRequest'));
console.log('Uses http.request:', sdkCode.includes('http.request'));
console.log('Uses https.request:', sdkCode.includes('https.request'));

// Look for the actual postDirect / post method
const postDirectMatch = sdkCode.match(/postDirect[^{]*\{[^}]{0,500}/g);
console.log('\npostDirect method:', postDirectMatch?.map(m => m.slice(0, 200)));

// Search for how apiUrl is used
const apiUrlUsage = sdkCode.match(/apiUrl[^;]{0,100}/g);
console.log('\napiUrl usage:', apiUrlUsage?.slice(0, 15));

// Look for the fetch or post calls
const fetchCalls = sdkCode.match(/(?:fetch|post|put|get)\s*\([^)]{0,200}/g);
console.log('\nHTTP calls:', fetchCalls?.slice(0, 20));

// Check what HttpClient actually does
const httpClientClass = sdkCode.match(/class\s+HttpClient[^{]*\{[^}]{0,2000}/);
console.log('\nHttpClient class:', httpClientClass?.[0]?.slice(0, 500));

// Look for any URL construction
const urlConstruction = sdkCode.match(/(?:baseURL|base_url|apiUrl|api_url)\s*[\+\.][^;]{0,200}/g);
console.log('\nURL construction:', urlConstruction?.slice(0, 10));
