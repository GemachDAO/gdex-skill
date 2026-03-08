/**
 * Detailed response-shape investigation for token discovery.
 * Print full shapes so we can fix the SDK types.
 */
const API_KEY = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';
const BASE = 'https://trade-api.gemach.io';

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
  const url = `${BASE}${path}?${qs.toString()}`;
  const res = await fetch(url, { headers: HEADERS });
  return res.json();
}

(async () => {
  const SOL = 622112261;
  const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';

  // ── 1. Token Details: full shape ──────────────────────────────────────
  console.log('=== TOKEN DETAILS ===');
  const details = await get('/v1/token_details', { tokenAddress: WIF, token: WIF, chain: SOL, chainId: SOL });
  console.log('Top keys:', Object.keys(details));
  if (details.tokens?.[0]) {
    const t = details.tokens[0];
    console.log('Token keys:', Object.keys(t));
    console.log('priceUsd:', t.priceUsd);
    console.log('priceNative:', t.priceNative);
    console.log('marketCap:', t.marketCap);
    console.log('liquidityUsd:', t.liquidityUsd);
    console.log('liquidityEth:', t.liquidityEth);
    console.log('pairAddress:', t.pairAddress);
    console.log('dexId:', t.dexId);
    console.log('dexes:', t.dexes);
    console.log('priceChanges:', JSON.stringify(t.priceChanges));
    console.log('volumes:', JSON.stringify(t.volumes));
    console.log('socialInfo:', JSON.stringify(t.socialInfo));
    console.log('securities:', JSON.stringify(t.securities));
    console.log('isRaydium:', t.isRaydium);
    console.log('isMeteora:', t.isMeteora);
    console.log('isPumpfun:', t.isPumpfun);
  }

  // ── 2. Trending: full shape of first token ────────────────────────────
  console.log('\n=== TRENDING ===');
  const trending = await get('/v1/trending/list', { chain: SOL, chainId: SOL, period: '24h', limit: 3 });
  console.log('Top keys:', Object.keys(trending));
  const trendingTokens = trending.trendingTokens || [];
  console.log('Token count:', trendingTokens.length);
  if (trendingTokens[0]) {
    const t = trendingTokens[0];
    console.log('First token keys:', Object.keys(t));
    console.log('symbol:', t.symbol, 'name:', t.name, 'address:', t.address);
    console.log('priceUsd:', t.priceUsd, 'priceNative:', t.priceNative);
    console.log('marketCap:', t.marketCap);
    console.log('liquidityUsd:', t.liquidityUsd);
    console.log('volumes:', JSON.stringify(t.volumes)?.slice(0, 200));
    console.log('priceChanges:', JSON.stringify(t.priceChanges)?.slice(0, 200));
  }

  // ── 3. OHLCV: try different resolutions and time ranges ────────────────
  console.log('\n=== OHLCV ===');
  // Try without limit, with 'D' resolution
  const ohlcv1 = await get('/v1/candles', { tokenAddress: WIF, token: WIF, chain: SOL, chainId: SOL, resolution: 'D' });
  console.log('Daily candles top keys:', Object.keys(ohlcv1));
  const bars1 = ohlcv1.data || ohlcv1.bars || ohlcv1.candles || ohlcv1;
  console.log('Daily candles count:', Array.isArray(bars1) ? bars1.length : 'not array');
  if (Array.isArray(bars1) && bars1[0]) {
    console.log('First candle keys:', Object.keys(bars1[0]));
    console.log('First candle:', JSON.stringify(bars1[0]));
  }

  // Try 1h with explicit time range
  const now = Math.floor(Date.now() / 1000);
  const ohlcv2 = await get('/v1/candles', {
    tokenAddress: WIF, token: WIF, chain: SOL, chainId: SOL,
    resolution: '60', from: now - 86400, to: now,
  });
  const bars2 = ohlcv2.data || [];
  console.log('1h candles (last 24h) count:', bars2.length);
  if (bars2[0]) {
    console.log('Sample:', JSON.stringify(bars2[0]));
  }

  // Try the TradingView endpoint as alternative
  const tv = await get('/v1/trading_view/history', {
    symbol: WIF, resolution: '60', from: now - 86400, to: now,
  });
  console.log('\nTradingView history top keys:', Object.keys(tv));
  if (tv.t && Array.isArray(tv.t)) {
    console.log('TV bars count:', tv.t.length);
    if (tv.t.length > 0) {
      console.log('First bar: t=', tv.t[0], 'o=', tv.o?.[0], 'h=', tv.h?.[0], 'l=', tv.l?.[0], 'c=', tv.c?.[0], 'v=', tv.v?.[0]);
    }
  } else {
    console.log('TV body:', JSON.stringify(tv).slice(0, 500));
  }

  // ── 4. Top Traders: full shape ────────────────────────────────────────
  console.log('\n=== TOP TRADERS ===');
  const traders = await get('/v1/copy_trade/top_traders', { chain: SOL, chainId: SOL, period: '7d', limit: 3 });
  console.log('Is array:', Array.isArray(traders));
  if (Array.isArray(traders) && traders[0]) {
    console.log('First trader keys:', Object.keys(traders[0]));
    console.log('First trader:', JSON.stringify(traders[0]).slice(0, 500));
  } else {
    console.log('Top keys:', Object.keys(traders));
    const arr = traders.traders || traders.data || [];
    if (arr[0]) {
      console.log('First trader keys:', Object.keys(arr[0]));
      console.log('First:', JSON.stringify(arr[0]).slice(0, 500));
    } else {
      console.log('Sample:', JSON.stringify(traders).slice(0, 500));
    }
  }
})();
