/**
 * Portfolio Check Example
 *
 * Demonstrates how to use GdexSkill to:
 * 1. Fetch cross-chain portfolio balances
 * 2. Display formatted balance table
 * 3. Fetch open perp positions
 * 4. Show trade history
 *
 * Run with: npx ts-node examples/portfolio-check.ts
 */

import { GdexSkill, ChainId, formatUsd, formatPercentChange, shortenAddress, GDEX_API_KEY_PRIMARY } from '../src';

async function main() {
  // ── Initialize with shared API key ────────────────────────────────────────
  const skill = new GdexSkill();
  skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);

  // Example wallet address (replace with your own)
  const walletAddress = process.env.WALLET_ADDRESS ?? '0xYourWalletAddressHere';

  console.log(`\n🔍 Portfolio Check for ${shortenAddress(walletAddress)}`);
  console.log('─'.repeat(60));

  // ── Cross-Chain Portfolio ─────────────────────────────────────────────────
  console.log('\n💼 Fetching cross-chain portfolio...');
  try {
    const portfolio = await skill.getPortfolio({ walletAddress });

    console.log(`\n   Total Value: ${formatUsd(portfolio.totalValueUsd)}`);

    if (portfolio.realizedPnl) {
      console.log(`   Realized P&L: ${portfolio.realizedPnl}`);
    }
    if (portfolio.unrealizedPnl) {
      console.log(`   Unrealized P&L: ${portfolio.unrealizedPnl}`);
    }

    if (portfolio.balances.length === 0) {
      console.log('\n   No token balances found');
    } else {
      console.log('\n   Token Balances:');
      console.log('   ' + '─'.repeat(56));
      console.log(
        '   ' +
          ['Token', 'Chain', 'Balance', 'USD Value', '24h'].map((h) => h.padEnd(14)).join('')
      );
      console.log('   ' + '─'.repeat(56));

      portfolio.balances.slice(0, 10).forEach((bal) => {
        const row = [
          bal.symbol.padEnd(14),
          String(bal.chain).padEnd(14),
          parseFloat(bal.balance).toFixed(4).padEnd(14),
          formatUsd(bal.usdValue ?? '0').padEnd(14),
          bal.change24h ? formatPercentChange(bal.change24h) : 'N/A',
        ].join('');
        console.log('   ' + row);
      });

      if (portfolio.balances.length > 10) {
        console.log(`   ... and ${portfolio.balances.length - 10} more tokens`);
      }
    }
  } catch (err) {
    console.error('❌ Portfolio fetch failed:', (err as Error).message);
  }

  // ── Chain-Specific Balances ───────────────────────────────────────────────
  console.log('\n\n🔗 Ethereum balances...');
  try {
    const ethBalances = await skill.getBalances({
      walletAddress,
      chain: ChainId.ETHEREUM,
    });

    if (ethBalances.length === 0) {
      console.log('   No Ethereum balances found');
    } else {
      ethBalances.slice(0, 5).forEach((bal) => {
        console.log(`   ${bal.symbol}: ${parseFloat(bal.balance).toFixed(6)} (${formatUsd(bal.usdValue ?? '0')})`);
      });
    }
  } catch (err) {
    console.error('❌ Ethereum balances failed:', (err as Error).message);
  }

  // ── HyperLiquid Perp Positions ────────────────────────────────────────────
  console.log('\n\n📊 Open perpetual positions...');
  try {
    const positions = await skill.getPerpPositions({ walletAddress });

    if (positions.length === 0) {
      console.log('   No open perp positions');
    } else {
      console.log('\n   ' + '─'.repeat(56));
      positions.forEach((pos) => {
        const pnlNum = parseFloat(pos.unrealizedPnl);
        const pnlSign = pnlNum >= 0 ? '+' : '';
        console.log(`   ${pos.coin} ${pos.side.toUpperCase()} x${pos.leverage}`);
        console.log(`   Size: ${pos.size} | Entry: $${pos.entryPrice} | Mark: $${pos.markPrice}`);
        console.log(`   Unrealized P&L: ${pnlSign}${formatUsd(pos.unrealizedPnl)}`);
        if (pos.liquidationPrice) {
          console.log(`   Liquidation: $${pos.liquidationPrice}`);
        }
        console.log('');
      });
    }
  } catch (err) {
    console.error('❌ Positions fetch failed:', (err as Error).message);
  }

  // ── Recent Trade History ──────────────────────────────────────────────────
  console.log('\n📜 Recent trade history (last 5)...');
  try {
    const history = await skill.getTradeHistory({
      walletAddress,
      limit: 5,
    });

    if (history.length === 0) {
      console.log('   No trade history found');
    } else {
      history.forEach((trade) => {
        const date = new Date(trade.timestamp * 1000).toLocaleDateString();
        const type = trade.type.toUpperCase().padEnd(8);
        const value = formatUsd(trade.usdValue ?? '0');
        console.log(`   ${date}  ${type}  ${value}  ${shortenAddress(trade.txHash)}`);
      });
    }
  } catch (err) {
    console.error('❌ Trade history failed:', (err as Error).message);
  }

  // ── Trending Tokens ───────────────────────────────────────────────────────
  console.log('\n\n🔥 Top 5 Solana trending tokens...');
  try {
    const trending = await skill.getTrendingTokens({
      chain: 'solana',
      period: '24h',
      limit: 5,
    });

    if (trending.length === 0) {
      console.log('   No trending tokens found');
    } else {
      trending.forEach((token) => {
        const change = formatPercentChange(token.priceChange);
        console.log(`   #${token.rank} ${token.symbol.padEnd(12)} $${parseFloat(token.priceUsd).toExponential(2).padEnd(14)} ${change}`);
      });
    }
  } catch (err) {
    console.error('❌ Trending tokens failed:', (err as Error).message);
  }

  console.log('\n✅ Portfolio check complete!');
}

main().catch(console.error);
