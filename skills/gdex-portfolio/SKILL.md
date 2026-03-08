---
name: gdex-portfolio
description: Cross-chain portfolio overview, chain-specific token balances, and paginated trade history
---

# GDEX: Portfolio & Balances

Query cross-chain portfolio summaries, chain-specific balances, and trade history.

## When to Use

- Getting a user's total portfolio value across all chains
- Checking token balances on a specific chain
- Retrieving trade history with pagination and filters

## Prerequisites

- `@gdexsdk/gdex-skill` installed
- Authenticated via `loginWithApiKey()` — see **gdex-authentication**

## Cross-Chain Portfolio

```typescript
import { GdexSkill, GDEX_API_KEY_PRIMARY } from '@gdexsdk/gdex-skill';

const skill = new GdexSkill();
skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);

const portfolio = await skill.getPortfolio({
  walletAddress: '0xYourAddress',
  chain: 'solana',  // optional: filter by chain
});
```

### Portfolio Response

```typescript
interface Portfolio {
  totalValueUsd: number;
  balances: Balance[];
  perpPositions?: PerpPosition[];
  realizedPnl?: number;
  unrealizedPnl?: number;
  totalPnl?: number;
}

interface Balance {
  tokenAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  rawBalance: string;
  balance: string;        // human-readable
  usdValue: number;
  priceUsd: number;
  change24h?: number;
  chain: string | number;
}
```

## Chain-Specific Balances

```typescript
const balances = await skill.getBalances({
  walletAddress: '0xYourAddress',
  chain: 8453,                   // Base
  tokenAddress: '0x833589...',   // optional: filter to specific token
});
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `walletAddress` | `string` | Yes | Wallet address to query |
| `chain` | `string \| ChainId` | Yes | Chain to query balances on |
| `tokenAddress` | `string` | No | Filter to a specific token |

## Trade History

```typescript
const history = await skill.getTradeHistory({
  walletAddress: '0xYourAddress',
  page: 1,
  limit: 20,
  chain: 'solana',       // optional filter
  from: 1700000000,      // optional: start timestamp (seconds)
  to: 1700086400,        // optional: end timestamp (seconds)
});
```

### Trade Record

```typescript
interface TradeRecord {
  id: string;
  type: string;        // 'buy' | 'sell'
  inputToken: string;
  outputToken: string;
  amountIn: string;
  amountOut: string;
  usdValue?: number;
  chain: string | number;
  dex?: string;
  txHash: string;
  timestamp: number;
  status: string;
}
```

## Example: Portfolio Dashboard

```typescript
const skill = new GdexSkill();
skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);

// 1. Get cross-chain overview
const portfolio = await skill.getPortfolio({ walletAddress: '0xAddr' });
console.log(`Total value: $${portfolio.totalValueUsd.toFixed(2)}`);

// 2. List balances per chain
for (const balance of portfolio.balances) {
  console.log(`${balance.symbol}: ${balance.balance} ($${balance.usdValue.toFixed(2)})`);
}

// 3. Check perp positions P&L
if (portfolio.perpPositions?.length) {
  for (const pos of portfolio.perpPositions) {
    console.log(`${pos.coin} ${pos.side}: PnL $${pos.unrealizedPnl.toFixed(2)}`);
  }
}

// 4. Recent trades
const history = await skill.getTradeHistory({ walletAddress: '0xAddr', limit: 5 });
for (const trade of history) {
  console.log(`${trade.type} ${trade.amountIn} → ${trade.amountOut} (${trade.status})`);
}
```

## Related Skills

- **gdex-authentication** — Auth setup required for portfolio queries
- **gdex-spot-trading** — Execute trades based on portfolio analysis
- **gdex-perp-trading** — View perp positions in portfolio
- **gdex-token-discovery** — Research tokens found in portfolio
