/**
 * Basic Trading Example
 *
 * Demonstrates how to use GdexSkill to:
 * 1. Initialize the SDK with a shared API key
 * 2. Buy a token on Solana
 * 3. Sell a token on Base (EVM)
 *
 * Run with: npx ts-node examples/basic-trade.ts
 */

import { GdexSkill, ChainId, GDEX_API_KEY_PRIMARY } from '../src';

async function main() {
  // ── Initialize SDK with shared API key ────────────────────────────────────
  const skill = new GdexSkill({
    // Uses https://trade-api.gemach.io/v1 by default
    debug: true,
  });

  // Authenticate with pre-configured shared API key (no wallet signing needed)
  skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);
  console.log('✅ GdexSkill initialized and authenticated with shared API key');

  // ── Buy a token on Solana ─────────────────────────────────────────────────
  console.log('\n📈 Buying BONK token on Solana...');
  try {
    const buyResult = await skill.buyToken({
      chain: 'solana',
      // BONK token address on Solana
      tokenAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      amount: '0.01', // 0.01 SOL
      slippage: 1, // 1% max slippage
    });

    console.log('✅ Buy order submitted!');
    console.log('   Job ID:', buyResult.jobId);
    console.log('   Status:', buyResult.status);
    console.log('   Input:', buyResult.inputAmount, 'SOL');
    console.log('   Output:', buyResult.outputAmount, 'BONK');
  } catch (err) {
    console.error('❌ Buy failed:', (err as Error).message);
  }

  // ── Sell a token on Base ──────────────────────────────────────────────────
  console.log('\n📉 Selling USDC on Base (50% of holdings)...');
  try {
    const sellResult = await skill.sellToken({
      chain: ChainId.BASE,
      // USDC on Base
      tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      amount: '50%', // Sell 50% of holdings
      slippage: 0.5,
    });

    console.log('✅ Sell order submitted!');
    console.log('   Job ID:', sellResult.jobId);
    console.log('   Status:', sellResult.status);
  } catch (err) {
    console.error('❌ Sell failed:', (err as Error).message);
  }

  // ── Get token info (no auth required) ────────────────────────────────────
  console.log('\n🔍 Fetching SOL token details...');
  try {
    const tokenDetails = await skill.getTokenDetails({
      tokenAddress: 'So11111111111111111111111111111111111111112',
      chain: 'solana',
    });

    console.log('✅ Token Details:');
    console.log('   Symbol:', tokenDetails.symbol);
    console.log('   Price USD:', tokenDetails.priceUsd);
    console.log('   24h Change:', tokenDetails.priceChange24h);
    console.log('   Market Cap:', tokenDetails.marketCap);
  } catch (err) {
    console.error('❌ Token details failed:', (err as Error).message);
  }
}

main().catch(console.error);
