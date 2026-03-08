/**
 * Live test — Token Discovery endpoints with proper headers.
 *
 * Tests:
 *  1. getTokenDetails — WIF on Solana
 *  2. getTrendingTokens — Solana 24h
 *  3. getOHLCV — WIF 1h candles
 *  4. getTopTraders — top by PnL
 */
const API_KEY = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';
const BASE = 'https://trade-api.gemach.io';

const HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Authorization': `Bearer ${API_KEY}`,
};

async function get(path, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  const url = `${BASE}${path}?${qs.toString()}`;
  console.log(`\n>>> GET ${url}`);
  const res = await fetch(url, { headers: HEADERS });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  console.log(`<<< ${res.status}`);
  return { status: res.status, body };
}

(async () => {
  const SOLANA = 622112261;
  const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';

  // ── 1. Token Details ──────────────────────────────────────────────────
  const details = await get('/v1/token_details', {
    tokenAddress: WIF, token: WIF, chain: SOLANA, chainId: SOLANA,
  });
  console.log('\n=== 1. Token Details (WIF) ===');
  if (details.status === 200) {
    const tokens = details.body?.tokens;
    if (Array.isArray(tokens) && tokens.length > 0) {
      const t = tokens[0];
      console.log(`  Symbol: ${t.symbol}`);
      console.log(`  Name: ${t.name}`);
      console.log(`  Decimals: ${t.decimals}`);
      console.log(`  DexId: ${t.dexId}`);
      console.log(`  Price: $${t.priceUsd || t.price || '?'}`);
      console.log(`  Liquidity: $${t.liquidity || '?'}`);
      console.log(`  Keys: ${Object.keys(t).join(', ')}`);
    } else {
      console.log('  Shape:', JSON.stringify(details.body).slice(0, 500));
    }
  } else {
    console.log(`  ❌ ${details.status}:`, JSON.stringify(details.body).slice(0, 300));
  }

  // ── 2. Trending Tokens ────────────────────────────────────────────────
  const trending = await get('/v1/trending/list', {
    chain: SOLANA, chainId: SOLANA, period: '24h', limit: 5,
  });
  console.log('\n=== 2. Trending Tokens (Solana, 24h) ===');
  if (trending.status === 200) {
    const data = Array.isArray(trending.body) ? trending.body
      : trending.body?.tokens || trending.body?.data || trending.body?.list || [];
    if (data.length > 0) {
      data.slice(0, 5).forEach((t, i) => {
        console.log(`  #${i+1}: ${t.symbol || t.name || '?'} — $${t.priceUsd || t.price || '?'} vol=$${t.volume24h || t.volume || '?'}`);
      });
    } else {
      console.log('  Keys:', Object.keys(trending.body || {}).slice(0, 20));
      console.log('  Sample:', JSON.stringify(trending.body).slice(0, 500));
    }
  } else {
    console.log(`  ❌ ${trending.status}:`, JSON.stringify(trending.body).slice(0, 300));
  }

  // ── 3. OHLCV ──────────────────────────────────────────────────────────
  const ohlcv = await get('/v1/candles', {
    tokenAddress: WIF, token: WIF, chain: SOLANA, chainId: SOLANA,
    resolution: '60', limit: 5,
  });
  console.log('\n=== 3. OHLCV (WIF 1h candles) ===');
  if (ohlcv.status === 200) {
    const candles = Array.isArray(ohlcv.body) ? ohlcv.body
      : ohlcv.body?.candles || ohlcv.body?.data || ohlcv.body?.bars || [];
    if (candles.length > 0) {
      candles.slice(0, 5).forEach((c) => {
        const time = c.time || c.t;
        const date = time ? new Date(time * 1000).toISOString() : '?';
        console.log(`  [${date}] O=${c.open||c.o} H=${c.high||c.h} L=${c.low||c.l} C=${c.close||c.c} V=${c.volume||c.v}`);
      });
    } else {
      console.log('  Keys:', Object.keys(ohlcv.body || {}).slice(0, 20));
      console.log('  Sample:', JSON.stringify(ohlcv.body).slice(0, 500));
    }
  } else {
    console.log(`  ❌ ${ohlcv.status}:`, JSON.stringify(ohlcv.body).slice(0, 300));
  }

  // ── 4. Top Traders ────────────────────────────────────────────────────
  const topTraders = await get('/v1/copy_trade/top_traders', {
    chain: SOLANA, chainId: SOLANA, period: '7d', limit: 5,
  });
  console.log('\n=== 4. Top Traders ===');
  if (topTraders.status === 200) {
    const traders = Array.isArray(topTraders.body) ? topTraders.body
      : topTraders.body?.traders || topTraders.body?.data || [];
    if (traders.length > 0) {
      traders.slice(0, 5).forEach((t, i) => {
        console.log(`  #${i+1}: ${t.walletAddress || t.address || '?'} PnL=$${t.pnl || t.totalPnl || '?'}`);
      });
    } else {
      console.log('  Keys:', Object.keys(topTraders.body || {}).slice(0, 20));
      console.log('  Sample:', JSON.stringify(topTraders.body).slice(0, 500));
    }
  } else {
    console.log(`  ❌ ${topTraders.status}:`, JSON.stringify(topTraders.body).slice(0, 300));
  }

  // ── Also try alternate trending path ──────────────────────────────────
  const trending2 = await get('/v1/trending/622112261', {});
  console.log('\n=== 2b. Trending (alternate path /v1/trending/:chain) ===');
  if (trending2.status === 200) {
    const data = Array.isArray(trending2.body) ? trending2.body : trending2.body?.tokens || [];
    console.log(`  Got ${data.length} tokens`);
    if (data.length > 0) {
      data.slice(0, 3).forEach((t, i) => console.log(`  #${i+1}: ${t.symbol || t.name} — $${t.priceUsd || t.price || '?'}`));
    } else {
      console.log('  Sample:', JSON.stringify(trending2.body).slice(0, 500));
    }
  } else {
    console.log(`  ❌ ${trending2.status}:`, JSON.stringify(trending2.body).slice(0, 300));
  }

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('\n\n========== SUMMARY ==========');
  console.log(`1. Token Details:  ${details.status === 200 ? '✅' : '❌'} (${details.status})`);
  console.log(`2. Trending:       ${trending.status === 200 ? '✅' : '❌'} (${trending.status})`);
  console.log(`2b. Trending alt:  ${trending2.status === 200 ? '✅' : '❌'} (${trending2.status})`);
  console.log(`3. OHLCV:          ${ohlcv.status === 200 ? '✅' : '❌'} (${ohlcv.status})`);
  console.log(`4. Top Traders:    ${topTraders.status === 200 ? '✅' : '❌'} (${topTraders.status})`);
})();
