/**
 * Perpetual Trading Example
 *
 * Demonstrates how to use GdexSkill for HyperLiquid perpetual futures:
 * 1. Open a 10x leveraged BTC long position
 * 2. Set take-profit at +5% and stop-loss at -3%
 * 3. Check open positions
 * 4. Close the position
 *
 * Run with: npx ts-node examples/perp-trading.ts
 */

import { GdexSkill, GDEX_API_KEY_PRIMARY } from '../src';

async function main() {
  // ── Initialize with shared API key ────────────────────────────────────────
  const skill = new GdexSkill();
  skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);
  console.log('✅ Authenticated with shared API key');

  const walletAddress = process.env.WALLET_ADDRESS ?? '0xYourWalletAddressHere';

  // ── Deposit USDC to HyperLiquid ───────────────────────────────────────────
  console.log('\n💰 Depositing $100 USDC to HyperLiquid...');
  try {
    const depositResult = await skill.perpDeposit({
      amount: '100', // $100 USDC
      walletAddress,
    });
    console.log('✅ Deposit submitted:', depositResult.txHash);
  } catch (err) {
    console.warn('⚠️  Deposit skipped:', (err as Error).message);
  }

  // ── Set Leverage ──────────────────────────────────────────────────────────
  console.log('\n⚙️  Setting BTC leverage to 10x...');
  try {
    await skill.setPerpLeverage({
      coin: 'BTC',
      leverage: 10,
      marginMode: 'cross',
      walletAddress,
    });
    console.log('✅ Leverage set to 10x');
  } catch (err) {
    console.error('❌ Leverage set failed:', (err as Error).message);
  }

  // ── Calculate TP/SL prices ────────────────────────────────────────────────
  // For this example, assume BTC is at $100,000
  const currentBtcPrice = 100_000;
  const takeProfitPrice = (currentBtcPrice * 1.05).toFixed(2); // +5%
  const stopLossPrice = (currentBtcPrice * 0.97).toFixed(2); // -3%

  console.log(`\n📊 BTC at $${currentBtcPrice.toLocaleString()}`);
  console.log(`   Take Profit: $${parseFloat(takeProfitPrice).toLocaleString()} (+5%)`);
  console.log(`   Stop Loss:   $${parseFloat(stopLossPrice).toLocaleString()} (-3%)`);

  // ── Open Long Position ────────────────────────────────────────────────────
  console.log('\n🚀 Opening BTC LONG position ($1000 at 10x = $10,000 notional)...');
  try {
    const openResult = await skill.openPerpPosition({
      coin: 'BTC',
      side: 'long',
      sizeUsd: '1000', // $1000 collateral (10x = $10,000 position)
      leverage: 10,
      takeProfitPrice,
      stopLossPrice,
      marginMode: 'cross',
      walletAddress,
    });

    console.log('✅ Position opened!');
    console.log('   Order ID:', openResult.orderId);
    console.log('   Execution Price:', openResult.executionPrice);
    console.log('   Size:', openResult.size, 'BTC');
  } catch (err) {
    console.error('❌ Open position failed:', (err as Error).message);
  }

  // ── Check Positions ───────────────────────────────────────────────────────
  console.log('\n📋 Fetching open positions...');
  try {
    const positions = await skill.getPerpPositions({ walletAddress });

    if (positions.length === 0) {
      console.log('   No open positions');
    } else {
      positions.forEach((pos) => {
        console.log(`\n   ${pos.coin} ${pos.side.toUpperCase()}`);
        console.log(`   Size: ${pos.size}`);
        console.log(`   Entry: $${pos.entryPrice}`);
        console.log(`   Mark:  $${pos.markPrice}`);
        console.log(`   P&L:   ${pos.unrealizedPnl}`);
        console.log(`   Liq:   $${pos.liquidationPrice ?? 'N/A'}`);
      });
    }
  } catch (err) {
    console.error('❌ Get positions failed:', (err as Error).message);
  }

  // ── Close Position ────────────────────────────────────────────────────────
  console.log('\n🔚 Closing BTC position (100%)...');
  try {
    const closeResult = await skill.closePerpPosition({
      coin: 'BTC',
      closePercent: 100,
      slippage: 1,
      walletAddress,
    });

    console.log('✅ Position closed!');
    console.log('   Realized P&L:', closeResult.realizedPnl ?? 'N/A');
  } catch (err) {
    console.error('❌ Close position failed:', (err as Error).message);
  }
}

main().catch(console.error);
