/**
 * Live test — Token Discovery via SDK (GdexSkill class).
 * Uses the actual SDK methods after the response-shape fixes.
 */
const { GdexSkill, GDEX_API_KEY_PRIMARY, ChainId } = require('../dist/index');

(async () => {
  const skill = new GdexSkill();
  skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);

  const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';

  // ── 1. Token Details ──────────────────────────────────────────────────
  console.log('=== 1. getTokenDetails (WIF on Solana) ===');
  try {
    const details = await skill.getTokenDetails({
      tokenAddress: WIF,
      chain: ChainId.SOLANA,
    });
    console.log('  ✅ Symbol:', details.symbol);
    console.log('  Name:', details.name);
    console.log('  Decimals:', details.decimals);
    console.log('  Price: $' + details.priceUsd);
    console.log('  MarketCap: $' + details.marketCap);
    console.log('  LiquidityUsd: $' + details.liquidityUsd);
    console.log('  DexId:', details.dexId);
    console.log('  isRaydium:', details.isRaydium);
    console.log('  isMeteora:', details.isMeteora);
    console.log('  PriceChanges:', JSON.stringify(details.priceChanges));
    console.log('  Volumes:', JSON.stringify(details.volumes));
    console.log('  Security:', JSON.stringify(details.securities?.holderCount), 'holders');
  } catch (e) {
    console.log('  ❌', e.message);
  }

  // ── 2. Trending Tokens ────────────────────────────────────────────────
  console.log('\n=== 2. getTrendingTokens (Solana, 24h) ===');
  try {
    const trending = await skill.getTrendingTokens({
      chain: ChainId.SOLANA,
      period: '24h',
      limit: 5,
    });
    console.log('  ✅ Got', trending.length, 'trending tokens');
    trending.slice(0, 5).forEach((t, i) => {
      console.log(`  #${i + 1}: ${t.symbol} (${t.name}) — $${t.priceUsd} mcap=$${t.marketCap} liq=$${t.liquidityUsd}`);
    });
  } catch (e) {
    console.log('  ❌', e.message);
  }

  // ── 3. OHLCV ──────────────────────────────────────────────────────────
  console.log('\n=== 3. getOHLCV (WIF, daily) ===');
  try {
    const ohlcv = await skill.getOHLCV({
      tokenAddress: WIF,
      chain: ChainId.SOLANA,
      resolution: 'D',
    });
    console.log('  ✅ Candles:', ohlcv.candles.length);
    if (ohlcv.candles.length > 0) {
      ohlcv.candles.slice(0, 3).forEach(c => {
        console.log(`    [${new Date(c.time * 1000).toISOString()}] O=${c.open} H=${c.high} L=${c.low} C=${c.close}`);
      });
    } else {
      console.log('  (Backend returned 0 candles — data may not be populated)');
    }
  } catch (e) {
    console.log('  ❌', e.message);
  }

  // ── 4. Top Traders ────────────────────────────────────────────────────
  console.log('\n=== 4. getTopTraders (Solana, 7d) ===');
  try {
    const traders = await skill.getTopTraders({
      chain: ChainId.SOLANA,
      period: '7d',
      limit: 5,
    });
    console.log('  ✅ Got', traders.length, 'traders');
    traders.slice(0, 5).forEach((t, i) => {
      const addr = t.wallet_address || t.address;
      const pnl7d = t.realized_profit_7d ?? 'N/A';
      console.log(`  #${i + 1}: ${addr?.slice(0, 12)}... PnL(7d)=$${pnl7d} name=${t.name || t.twitter_username || '?'}`);
    });
  } catch (e) {
    console.log('  ❌', e.message);
  }

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('\n========== DONE ==========');
})();
