/**
 * Live test — Copy Trading endpoints.
 *
 * Probes:
 *  1. GET  /v1/copy_trade/top_traders  — already confirmed working
 *  2. GET  /v1/copy_trade/settings     — get copy trade settings
 *  3. POST /v1/copy_trade/settings     — update settings
 *  4. GET  /v1/copy_trade/wallets      — list tracked wallets
 *  5. POST /v1/copy_trade/wallets/add  — add a wallet
 *  6. POST /v1/copy_trade/wallets/remove — remove a wallet
 */
const API_KEY = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';
const BASE = 'https://trade-api.gemach.io';
const USER_ID = '0x53D029a671bd1CF61a2fB1F4F6e4bD830BFBb2eD'; // control wallet
const SOLANA = 622112261;

const HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Authorization': `Bearer ${API_KEY}`,
};

async function get(path, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  const url = `${BASE}${path}${qs.toString() ? '?' + qs.toString() : ''}`;
  console.log(`\n>>> GET ${url}`);
  const res = await fetch(url, { headers: HEADERS });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  console.log(`<<< ${res.status}`);
  return { status: res.status, body };
}

async function post(path, data = {}) {
  const url = `${BASE}${path}`;
  console.log(`\n>>> POST ${url}`);
  console.log(`    Body: ${JSON.stringify(data).slice(0, 200)}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(data),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  console.log(`<<< ${res.status}`);
  return { status: res.status, body };
}

function show(label, result) {
  console.log(`\n=== ${label} ===`);
  console.log(`Status: ${result.status}`);
  const str = JSON.stringify(result.body);
  if (str.length > 800) {
    console.log('Body:', str.slice(0, 800) + '...');
  } else {
    console.log('Body:', str);
  }
  if (result.status === 200 && typeof result.body === 'object' && result.body !== null) {
    console.log('Top keys:', Object.keys(result.body));
  }
  return result;
}

(async () => {
  // ── 1. Get copy trade settings ────────────────────────────────────────
  const settings = show('GET /v1/copy_trade/settings',
    await get('/v1/copy_trade/settings', { userId: USER_ID }));

  // ── 2. Get tracked wallets ────────────────────────────────────────────
  const wallets = show('GET /v1/copy_trade/wallets',
    await get('/v1/copy_trade/wallets', { userId: USER_ID }));

  // ── 3. Add a test wallet ──────────────────────────────────────────────
  // Use a known top trader from previous test
  const TEST_WALLET = '5M8ACGKEXG1ojKDTMH3sMqhTihTgHYMSsZc6W8i7QW3Y';
  const addResult = show('POST /v1/copy_trade/wallets/add',
    await post('/v1/copy_trade/wallets/add', {
      walletAddress: TEST_WALLET,
      chain: SOLANA,
      chainId: SOLANA,
      label: 'Test Alpha Trader',
      userId: USER_ID,
    }));

  // ── 4. Check wallets again ────────────────────────────────────────────
  const walletsAfterAdd = show('GET /v1/copy_trade/wallets (after add)',
    await get('/v1/copy_trade/wallets', { userId: USER_ID }));

  // ── 5. Update settings ────────────────────────────────────────────────
  const setResult = show('POST /v1/copy_trade/settings',
    await post('/v1/copy_trade/settings', {
      userId: USER_ID,
      enabled: true,
      maxTradeSize: '50',
      slippage: 1,
      copyBuysOnly: false,
      copySellsOnly: false,
      maxPositions: 5,
    }));

  // ── 6. Get settings again ─────────────────────────────────────────────
  const settingsAfterUpdate = show('GET /v1/copy_trade/settings (after update)',
    await get('/v1/copy_trade/settings', { userId: USER_ID }));

  // ── 7. Remove the test wallet ─────────────────────────────────────────
  const removeResult = show('POST /v1/copy_trade/wallets/remove',
    await post('/v1/copy_trade/wallets/remove', {
      walletAddress: TEST_WALLET,
      chain: SOLANA,
      chainId: SOLANA,
      userId: USER_ID,
    }));

  // ── 8. Verify wallet removed ──────────────────────────────────────────
  const walletsAfterRemove = show('GET /v1/copy_trade/wallets (after remove)',
    await get('/v1/copy_trade/wallets', { userId: USER_ID }));

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('\n\n========== SUMMARY ==========');
  console.log(`GET  settings:     ${settings.status === 200 ? '✅' : '❌'} (${settings.status})`);
  console.log(`GET  wallets:      ${wallets.status === 200 ? '✅' : '❌'} (${wallets.status})`);
  console.log(`POST wallets/add:  ${addResult.status === 200 ? '✅' : '❌'} (${addResult.status})`);
  console.log(`POST settings:     ${setResult.status === 200 ? '✅' : '❌'} (${setResult.status})`);
  console.log(`POST wallets/rem:  ${removeResult.status === 200 ? '✅' : '❌'} (${removeResult.status})`);
})();
