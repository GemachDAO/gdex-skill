/**
 * Probe all real copy trade endpoints from the backend documentation.
 * 
 * Routes under /copy_trade/ (or /v1/copy_trade/):
 *   GET  /list          — user's copy trade configs (session key auth)
 *   GET  /tx_list       — copy trade tx history (session key auth)
 *   POST /create        — create copy trade (computedData)
 *   POST /update        — update/delete copy trade (computedData)
 *   GET  /custom_wallets — top 300 by net received (no auth)
 *   GET  /wallets       — top 300 by totalPnl (no auth)
 *   GET  /gems          — hot new tokens (no auth)
 *   GET  /top_traders   — top trader rankings (no auth)
 *   GET  /dexes_list    — supported DEXes (no auth)
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
    return { status: res.status, json, isHtml };
  } catch (e) {
    return { status: 'ERR', text: e.message };
  }
}

function show(label, r) {
  const mark = r.status === 200 ? '✅' : r.isHtml ? '❌' : '⚠️';
  console.log(`${mark} ${r.status} ${label}`);
  if (r.json && !r.isHtml) {
    const str = JSON.stringify(r.json);
    if (str.length > 600) {
      console.log(`   ${str.slice(0, 600)}...`);
    } else {
      console.log(`   ${str}`);
    }
    if (typeof r.json === 'object' && !Array.isArray(r.json)) {
      console.log(`   Top keys: ${Object.keys(r.json).join(', ')}`);
    }
    if (Array.isArray(r.json)) {
      console.log(`   Array length: ${r.json.length}`);
      if (r.json[0]) console.log(`   First item keys: ${Object.keys(r.json[0]).join(', ')}`);
    }
  }
  return r;
}

(async () => {
  // Try both /v1/copy_trade/ and /copy_trade/ prefixes
  const prefixes = ['/v1/copy_trade', '/copy_trade'];
  
  for (const prefix of prefixes) {
    console.log(`\n\n======== PREFIX: ${prefix} ========\n`);
    
    // No-auth discovery endpoints
    show(`GET ${prefix}/wallets`, await probe('GET', `${prefix}/wallets`));
    show(`GET ${prefix}/custom_wallets`, await probe('GET', `${prefix}/custom_wallets`));
    show(`GET ${prefix}/gems`, await probe('GET', `${prefix}/gems`));
    show(`GET ${prefix}/top_traders?chainId=${SOLANA}`, await probe('GET', `${prefix}/top_traders?chainId=${SOLANA}`));
    show(`GET ${prefix}/dexes_list?chainId=${SOLANA}`, await probe('GET', `${prefix}/dexes_list?chainId=${SOLANA}`));
    
    // Auth-required read endpoints (try without proper session key first to see if route exists)
    show(`GET ${prefix}/list?userId=${USER_ID}`, await probe('GET', `${prefix}/list?userId=${USER_ID}`));
    show(`GET ${prefix}/tx_list?userId=${USER_ID}`, await probe('GET', `${prefix}/tx_list?userId=${USER_ID}`));
    
    // Write endpoints (just test route existence)
    show(`POST ${prefix}/create`, await probe('POST', `${prefix}/create`, { computedData: 'test' }));
    show(`POST ${prefix}/update`, await probe('POST', `${prefix}/update`, { computedData: 'test' }));
  }
})();
