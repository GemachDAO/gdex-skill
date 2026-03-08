---
name: gdex-copy-trading
description: Copy trade setup — track top trader wallets, configure copy parameters, view performance stats, and discover top traders
---

# GDEX: Copy Trading

Track successful trader wallets and automatically copy their trades. Includes top trader discovery with P&L rankings.

## When to Use

- Finding top-performing traders to follow
- Adding wallets to copy-trade tracking
- Configuring copy trade parameters (size limits, slippage, etc.)
- Managing tracked wallets

## Prerequisites

- `@gdexsdk/gdex-skill` installed
- Authenticated via `loginWithApiKey()` — see **gdex-authentication**

## Discover Top Traders

```typescript
import { GdexSkill, GDEX_API_KEY_PRIMARY } from '@gdexsdk/gdex-skill';

const skill = new GdexSkill();
skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);

const traders = await skill.getTopTraders({
  period: '7d',      // '1d' | '7d' | '30d' | 'all'
  limit: 10,
  sortBy: 'pnl',     // 'pnl' | 'winRate' | 'volume' | 'tradeCount'
});
```

### Top Trader Response

```typescript
interface TopTrader {
  address: string;
  label?: string;
  chain: string | number;
  totalPnlUsd: number;
  winRate: number;
  tradeCount: number;
  totalVolumeUsd: number;
  performance?: {
    pnl7d?: number;
    pnl30d?: number;
    roi?: number;
  };
}
```

## Add a Wallet to Track

```typescript
await skill.addCopyTradeWallet({
  walletAddress: '0xTopTraderAddress',
  chain: 'solana',
  label: 'Alpha Trader',   // optional label
});
```

## Get Tracked Wallets

```typescript
const wallets = await skill.getCopyTradeWallets('your-user-id');
```

### Tracked Wallet Response

```typescript
interface CopyTradeWallet {
  address: string;
  label?: string;
  chain: string | number;
  active: boolean;
  addedAt?: string;
  stats: {
    totalCopiedTrades: number;
    profitableTrades: number;
    totalPnlUsd: number;
    winRate: number;
  };
}
```

## Configure Copy Trade Settings

```typescript
await skill.setCopyTradeSettings({
  enabled: true,
  maxTradeSize: '100',       // max $100 per copied trade
  slippage: 1,               // 1% max slippage
  delay: 5,                  // 5 second delay before copying
  copyBuysOnly: false,       // copy both buys and sells
  copySellsOnly: false,
  chains: ['solana', 8453],  // only copy on these chains
  maxPositions: 10,          // max concurrent positions
});
```

### Settings Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `enabled` | `boolean` | Enable/disable copy trading |
| `maxTradeSize` | `string` | Maximum USD per copied trade |
| `slippage` | `number` | Max slippage % |
| `delay` | `number` | Seconds to wait before copying |
| `copyBuysOnly` | `boolean` | Only copy buy trades |
| `copySellsOnly` | `boolean` | Only copy sell trades |
| `chains` | `array` | Limit to specific chains |
| `maxPositions` | `number` | Max concurrent positions |

## Get Current Settings

```typescript
const settings = await skill.getCopyTradeSettings();
console.log('Enabled:', settings.enabled);
console.log('Max trade size:', settings.maxTradeSize);
```

## Remove a Tracked Wallet

```typescript
await skill.removeCopyTradeWallet({
  walletAddress: '0xTopTraderAddress',
  chain: 'solana',
});
```

## Example: Full Copy Trading Setup

```typescript
const skill = new GdexSkill();
skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);

// 1. Find top performers
const traders = await skill.getTopTraders({ period: '30d', limit: 5, sortBy: 'pnl' });

// 2. Track the best one
const best = traders[0];
await skill.addCopyTradeWallet({
  walletAddress: best.address,
  chain: best.chain,
  label: `Top PnL: $${best.totalPnlUsd.toFixed(0)}`,
});

// 3. Configure conservative settings
await skill.setCopyTradeSettings({
  enabled: true,
  maxTradeSize: '50',
  slippage: 1,
  copyBuysOnly: true,
  maxPositions: 5,
});

// 4. Monitor performance
const wallets = await skill.getCopyTradeWallets('userId');
for (const w of wallets) {
  console.log(`${w.label}: ${w.stats.totalCopiedTrades} trades, $${w.stats.totalPnlUsd.toFixed(2)} PnL`);
}
```

## Related Skills

- **gdex-authentication** — Auth setup required for copy trading
- **gdex-portfolio** — Monitor your portfolio including copied positions
- **gdex-spot-trading** — Understanding the trades being copied
