/**
 * Deep inspection of copy trade wallets response shape + probe alternative endpoints.
 */
const API_KEY = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';
const BASE = 'https://trade-api.gemach.io';
const USER_ID = '0x53D029a671bd1CF61a2fB1F4F6e4bD830BFBb2eD';
const SOLANA = 622112261;

const HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Authorization': `Bearer ${API_KEY}`,
};

async function probe(method, path, body) {
  const url = `${BASE}${path}`;
  const opts = { method, headers: HEADERS };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(url, opts);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = null; }
    const isHtml = text.startsWith('<!DOCTYPE') || text.startsWith('<html');
    return { status: res.status, json, isHtml, text: isHtml ? '(HTML 404)' : text.slice(0, 300) };
  } catch (e) {
    return { status: 'ERR', text: e.message };
  }
}

(async () => {
  // ── 1. Full wallet shape ──────────────────────────────────────────────
  console.log('=== WALLET RESPONSE SHAPE ===');
  const r = await probe('GET', '/v1/copy_trade/wallets');
  if (r.json && Array.isArray(r.json)) {
    console.log(`Total wallets returned: ${r.json.length}`);
    const first = r.json[0];
    console.log('\nFirst wallet (full object):');
    console.log(JSON.stringify(first, null, 2));
    console.log('\nAll keys:', Object.keys(first));
    console.log('\nField types:');
    for (const [k, v] of Object.entries(first)) {
      console.log(`  ${k}: ${typeof v} = ${JSON.stringify(v).slice(0, 80)}`);
    }
  } else if (r.json && typeof r.json === 'object') {
    console.log('NOT an array. Top keys:', Object.keys(r.json));
    console.log(JSON.stringify(r.json).slice(0, 500));
  }

  // ── 2. Does userId param filter anything? ─────────────────────────────
  console.log('\n\n=== WALLETS WITH userId PARAM ===');
  const withUser = await probe('GET', `/v1/copy_trade/wallets?userId=${USER_ID}`);
  if (withUser.json && Array.isArray(withUser.json)) {
    console.log(`With userId: ${withUser.json.length} wallets`);
  }
  const withoutUser = await probe('GET', '/v1/copy_trade/wallets');
  if (withoutUser.json && Array.isArray(withoutUser.json)) {
    console.log(`Without userId: ${withoutUser.json.length} wallets`);
  }

  // ── 3. Does chainId param filter? ─────────────────────────────────────
  console.log('\n\n=== WALLETS WITH chainId PARAM ===');
  const withChain = await probe('GET', `/v1/copy_trade/wallets?chainId=${SOLANA}`);
  if (withChain.json && Array.isArray(withChain.json)) {
    console.log(`With chainId=${SOLANA}: ${withChain.json.length} wallets`);
  }

  // ── 4. Probe alternative endpoint patterns ────────────────────────────
  console.log('\n\n=== PROBING ALTERNATIVE ENDPOINTS ===');
  const paths = [
    // Settings variations
    ['GET',  '/v1/copy-trade/settings'],
    ['GET',  '/v1/copytrade/settings'],
    ['GET',  '/v1/copy_trade/setting'],
    ['GET',  '/v1/copy_trade/config'],
    ['POST', '/v1/copy-trade/settings'],
    ['POST', '/v1/copy_trade/settings/update'],
    
    // Wallet add/remove variations
    ['POST', '/v1/copy-trade/wallets/add'],
    ['POST', '/v1/copy_trade/wallet/add'],
    ['POST', '/v1/copy_trade/wallets'],
    ['PUT',  '/v1/copy_trade/wallets'],
    ['DELETE', '/v1/copy_trade/wallets'],
    ['POST', '/v1/copy-trade/wallets/remove'],
    ['POST', '/v1/copy_trade/wallet/remove'],
    ['DELETE', `/v1/copy_trade/wallets/5M8ACGKEXG1ojKDTMH3sMqhTihTgHYMSsZc6W8i7QW3Y`],
    
    // Follow / unfollow (maybe different naming)
    ['POST', '/v1/copy_trade/follow'],
    ['POST', '/v1/copy_trade/unfollow'],
    ['POST', '/v1/follow'],
    ['POST', '/v1/unfollow'],
    
    // Watch / track  
    ['POST', '/v1/copy_trade/watch'],
    ['POST', '/v1/copy_trade/track'],
    ['GET',  '/v1/copy_trade/followed'],
    ['GET',  '/v1/copy_trade/following'],
  ];

  const body = { walletAddress: '5M8ACGKEXG1ojKDTMH3sMqhTihTgHYMSsZc6W8i7QW3Y', chain: SOLANA, chainId: SOLANA, userId: USER_ID };
  
  for (const [method, path] of paths) {
    const r = await probe(method, path, method !== 'GET' ? body : undefined);
    const mark = r.status === 200 ? '✅' : r.status === 404 ? '  ' : `⚠️ `;
    if (r.status !== 404) {
      console.log(`${mark} ${r.status} ${method.padEnd(6)} ${path}`);
      if (r.json) console.log(`   Response: ${JSON.stringify(r.json).slice(0, 200)}`);
    }
  }
})();
