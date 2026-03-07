/**
 * Perpetual Trading Example (HyperLiquid via GDEX Managed Custody)
 *
 * Demonstrates:
 * 1. Deposit USDC to HyperLiquid
 * 2. Check account state & balance
 * 3. Place a market long BTC order with TP/SL
 * 4. Check open positions
 * 5. Close all positions
 * 6. Withdraw USDC
 *
 * Run with: npx ts-node examples/perp-trading.ts
 */

import { GdexSkill, GDEX_API_KEY_PRIMARY } from '../src';

async function main() {
  // ── Initialize with shared API key ────────────────────────────────────────
  const skill = new GdexSkill();
  skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);
  console.log('✅ Authenticated with shared API key');

  // Managed-custody credentials (from sign-in flow)
  const walletAddress = process.env.WALLET_ADDRESS ?? '0x9967179de55bd67e6b90fcc4f908556d93938c0f';
  const sessionPrivateKey = process.env.SESSION_PRIVATE_KEY ?? '';
  const apiKey = GDEX_API_KEY_PRIMARY;

  if (!sessionPrivateKey) {
    console.error('❌ Set SESSION_PRIVATE_KEY env var (hex, from managed sign-in)');
    return;
  }

  const creds = { apiKey, walletAddress, sessionPrivateKey };

  // ── Check account state ───────────────────────────────────────────────────
  console.log('\n📊 Checking HyperLiquid account state...');
  const state = await skill.getHlAccountState(walletAddress);
  console.log(`   Account Value: $${state.accountValue}`);
  console.log(`   Withdrawable:  $${state.withdrawable}`);
  console.log(`   Positions:     ${state.positions.length}`);

  // ── Deposit USDC (Arbitrum) ───────────────────────────────────────────────
  console.log('\n💰 Depositing $10 USDC from Arbitrum to HyperLiquid...');
  try {
    const depositResult = await skill.perpDeposit({
      ...creds,
      tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC on Arbitrum
      amount: '10',
      chainId: 42161,
    });
    console.log('✅ Deposit:', depositResult.message);
  } catch (err) {
    console.warn('⚠️  Deposit:', (err as Error).message);
  }

  // ── Get BTC mark price ────────────────────────────────────────────────────
  const btcPrice = await skill.getHlMarkPrice('BTC');
  console.log(`\n📈 BTC Mark Price: $${btcPrice.toLocaleString()}`);

  // ── Open BTC long with TP/SL ──────────────────────────────────────────────
  const tpPrice = (btcPrice * 1.05).toFixed(0);  // +5%
  const slPrice = (btcPrice * 0.97).toFixed(0);  // -3%
  console.log(`\n🚀 Opening BTC LONG (market, TP=$${tpPrice}, SL=$${slPrice})...`);
  try {
    const order = await skill.hlCreateOrder({
      ...creds,
      coin: 'BTC',
      isLong: true,
      price: btcPrice.toString(),
      size: '0.001',
      isMarket: true,
      tpPrice,
      slPrice,
    });
    console.log('✅ Order:', order.message, order.orderId ? `(ID: ${order.orderId})` : '');
  } catch (err) {
    console.error('❌ Order failed:', (err as Error).message);
  }

  // ── Check positions ───────────────────────────────────────────────────────
  console.log('\n📋 Positions:');
  const positions = await skill.getPerpPositions({ walletAddress });
  if (positions.length === 0) {
    console.log('   No open positions');
  } else {
    for (const pos of positions) {
      console.log(`   ${pos.coin} ${pos.side.toUpperCase()} x${pos.leverage}`);
      console.log(`   Size: ${pos.size} | Entry: $${pos.entryPrice} | P&L: ${pos.unrealizedPnl}`);
    }
  }

  // ── Close all positions ───────────────────────────────────────────────────
  console.log('\n🔚 Closing all positions...');
  try {
    const closeResult = await skill.hlCloseAll(creds);
    console.log('✅ Close all:', closeResult.message);
  } catch (err) {
    console.error('❌ Close failed:', (err as Error).message);
  }

  // ── Withdraw ──────────────────────────────────────────────────────────────
  console.log('\n💸 Withdrawing $5 USDC...');
  try {
    const withdrawResult = await skill.perpWithdraw({ ...creds, amount: '5' });
    console.log('✅ Withdraw:', withdrawResult.message);
  } catch (err) {
    console.error('❌ Withdraw failed:', (err as Error).message);
  }
}

main().catch(console.error);
