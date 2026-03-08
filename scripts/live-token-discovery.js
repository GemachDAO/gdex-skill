/**
 * Live test — Token Discovery endpoints (no auth required).
 *
 * Tests:
 *  1. getTokenDetails — get WIF token info on Solana
 *  2. getTrendingTokens — trending on Solana (24h)
 *  3. getOHLCV — candlestick data for WIF
 *  4. getTopTraders — top traders by PnL
 */
const BASE = 'https://trade-api.gemach.io';

async function get(path, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  const url = `${BASE}${path}?${qs.toString()}`;
  console.log(`\n>>> GET ${url}`);
  const res = await fetch(url);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  console.log(`<<< ${res.status}`);
  return { status: res.status, body };
}

function summarize(label, result) {
  console.log(`\n=== ${label} ===`);
  console.log(`Status: ${result.status}`);
  if (result.status !== 200) {
    console.log('Body:', JSON.stringify(result.body).slice(0, 300));
    return false;
  }
  return true;
}

(async () => {
  const SOLANA_CHAIN = 622112261;
  const WIF_ADDRESS = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'; // WIF on Solana

  // ── 1. Token Details ──────────────────────────────────────────────────
  const details = await get('/v1/token_details', {
    tokenAddress: WIF_ADDRESS,
    token: WIF_ADDRESS,
    chain: SOLANA_CHAIN,
    chainId: SOLANA_CHAIN,
  });
  if (summarize('Token Details (WIF on Solana)', details)) {
    const d = details.body;
    // It could be nested or flat — let's inspect the shape
    if (d.symbol || d.name || d.priceUsd || d.price) {
      console.log(`  Symbol: ${d.symbol || d.token?.symbol || '?'}`);
      console.log(`  Name: ${d.name || d.token?.name || '?'}`);
      console.log(`  Price: $${d.priceUsd || d.price || d.token?.priceUsd || '?'}`);
      console.log(`  24h Change: ${d.priceChange24h || d.change24h || '?'}%`);
      console.log(`  Volume: $${d.volume24h || d.volume || '?'}`);
      console.log(`  Liquidity: $${d.liquidity || '?'}`);
      console.log(`  MarketCap: $${d.marketCap || d.mcap || '?'}`);
    } else {
      // Print first-level keys to understand the shape
      console.log('  Keys:', Object.keys(d).slice(0, 20));
      console.log('  Sample:', JSON.stringify(d).slice(0, 500));
    }
  }

  // ── 2. Trending Tokens ────────────────────────────────────────────────
  const trending = await get('/v1/trending/list', {
    chain: SOLANA_CHAIN,
    chainId: SOLANA_CHAIN,
    period: '24h',
    limit: 5,
  });
  if (summarize('Trending Tokens (Solana 24h, top 5)', trending)) {
    const tokens = Array.isArray(trending.body) ? trending.body : trending.body?.tokens || trending.body?.data || [];
    if (tokens.length === 0) {
      console.log('  (empty array or unexpected shape)');
      console.log('  Keys:', Object.keys(trending.body || {}).slice(0, 20));
      console.log('  Sample:', JSON.stringify(trending.body).slice(0, 500));
    } else {
      tokens.slice(0, 5).forEach((t, i) => {
        console.log(`  #${i + 1}: ${t.symbol || t.name || '?'} — $${t.priceUsd || t.price || '?'} (${t.priceChange || t.change || '?'}%) vol=$${t.volume24h || t.volume || '?'}`);
      });
    }
  }

  // ── 3. OHLCV Candles ──────────────────────────────────────────────────
  const ohlcv = await get('/v1/candles', {
    tokenAddress: WIF_ADDRESS,
    token: WIF_ADDRESS,
    chain: SOLANA_CHAIN,
    chainId: SOLANA_CHAIN,
    resolution: '60',   // 1-hour candles
    limit: 5,
  });
  if (summarize('OHLCV (WIF 1h candles, last 5)', ohlcv)) {
    const candles = Array.isArray(ohlcv.body) ? ohlcv.body : ohlcv.body?.candles || ohlcv.body?.data || [];
    if (candles.length === 0) {
      console.log('  (empty or unexpected shape)');
      console.log('  Keys:', Object.keys(ohlcv.body || {}).slice(0, 20));
      console.log('  Sample:', JSON.stringify(ohlcv.body).slice(0, 500));
    } else {
      candles.slice(0, 5).forEach((c, i) => {
        const time = c.time || c.t;
        const date = time ? new Date(time * 1000).toISOString() : '?';
        console.log(`  [${date}] O=${c.open || c.o} H=${c.high || c.h} L=${c.low || c.l} C=${c.close || c.c} V=${c.volume || c.v}`);
      });
    }
  }

  // ── 4. Top Traders ────────────────────────────────────────────────────
  const topTraders = await get('/v1/copy_trade/top_traders', {
    chain: SOLANA_CHAIN,
    chainId: SOLANA_CHAIN,
    period: '7d',
    limit: 5,
    sortBy: 'pnl',
  });
  if (summarize('Top Traders (7d, top 5)', topTraders)) {
    const traders = Array.isArray(topTraders.body) ? topTraders.body : topTraders.body?.traders || topTraders.body?.data || [];
    if (traders.length === 0) {
      console.log('  (empty or unexpected shape)');
      console.log('  Keys:', Object.keys(topTraders.body || {}).slice(0, 20));
      console.log('  Sample:', JSON.stringify(topTraders.body).slice(0, 500));
    } else {
      traders.slice(0, 5).forEach((t, i) => {
        console.log(`  #${i + 1}: ${t.walletAddress || t.address || '?'} PnL=$${t.pnl || t.totalPnl || '?'} winRate=${t.winRate || '?'}%`);
      });
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('\n\n========== SUMMARY ==========');
  console.log(`Token Details:   ${details.status === 200 ? '✅' : '❌'} (${details.status})`);
  console.log(`Trending:        ${trending.status === 200 ? '✅' : '❌'} (${trending.status})`);
  console.log(`OHLCV:           ${ohlcv.status === 200 ? '✅' : '❌'} (${ohlcv.status})`);
  console.log(`Top Traders:     ${topTraders.status === 200 ? '✅' : '❌'} (${topTraders.status})`);
})();
