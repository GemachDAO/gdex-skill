---
name: gdex-token-discovery
description: Token details, trending tokens, and OHLCV candlestick data — no authentication required
---

# GDEX: Token Discovery

Research tokens with price data, market metrics, trending rankings, and candlestick charts. **No authentication required** — these endpoints work immediately.

## When to Use

- Looking up token price, market cap, volume, and socials
- Finding trending tokens on a specific chain
- Getting OHLCV candlestick data for charting or analysis
- Researching a token before buying

## Prerequisites

```bash
npm install @gdexsdk/gdex-skill
```

No authentication needed. Just instantiate:

```typescript
import { GdexSkill } from '@gdexsdk/gdex-skill';
const skill = new GdexSkill();
```

## Token Details

```typescript
const token = await skill.getTokenDetails({
  tokenAddress: 'So11111111111111111111111111111111111111112',
  chain: 'solana',
});
```

### Response

```typescript
interface TokenDetails {
  address: string;
  symbol: string;
  name: string;
  logoUrl?: string;
  decimals: number;
  chain: string | number;
  priceUsd?: number;
  priceChange24h?: number;
  marketCap?: number;
  fdv?: number;
  totalSupply?: string;
  circulatingSupply?: string;
  volume24h?: number;
  liquidity?: number;
  pools: TokenPool[];
  socials: Record<string, string>;  // { twitter, website, telegram, etc. }
}
```

## Trending Tokens

```typescript
const trending = await skill.getTrendingTokens({
  chain: 'solana',
  period: '24h',     // '1h' | '6h' | '24h' | '7d'
  limit: 20,         // max results
  minLiquidity: 10000,  // optional: min liquidity filter
  minVolume: 5000,      // optional: min volume filter
});
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chain` | `string \| ChainId` | Yes | Chain to search |
| `period` | `string` | No | Trending period: `'1h'`, `'6h'`, `'24h'`, `'7d'` (default: `'24h'`) |
| `limit` | `number` | No | Max results (default: 20) |
| `minLiquidity` | `number` | No | Minimum liquidity in USD |
| `minVolume` | `number` | No | Minimum 24h volume in USD |

### Response

```typescript
interface TrendingToken {
  rank: number;
  address: string;
  symbol: string;
  name: string;
  logoUrl?: string;
  chain: string | number;
  priceUsd: number;
  priceChange: number;     // % change over period
  volume24h: number;
  liquidity: number;
  marketCap?: number;
  txCount24h?: number;
}
```

## OHLCV Candlestick Data

```typescript
const candles = await skill.getOHLCV({
  tokenAddress: 'So11111111111111111111111111111111111111112',
  chain: 'solana',
  resolution: '60',   // candle interval
  from: Math.floor(Date.now() / 1000) - 86400,  // 24h ago
  to: Math.floor(Date.now() / 1000),
});
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tokenAddress` | `string` | Yes | Token contract address |
| `chain` | `string \| ChainId` | Yes | Chain |
| `resolution` | `string` | Yes | `'1'`, `'5'`, `'15'`, `'30'`, `'60'`, `'240'`, `'D'`, `'W'` (minutes or D/W) |
| `from` | `number` | Yes | Start timestamp (seconds) |
| `to` | `number` | Yes | End timestamp (seconds) |

### Response

```typescript
interface OHLCVData {
  tokenAddress: string;
  chain: string | number;
  resolution: string;
  candles: OHLCVCandle[];
}

interface OHLCVCandle {
  time: number;    // unix timestamp
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
```

## Example: Token Research Before Buying

```typescript
const skill = new GdexSkill();

// 1. Find trending tokens on Solana
const trending = await skill.getTrendingTokens({
  chain: 'solana',
  period: '1h',
  limit: 5,
  minLiquidity: 50000,
});

// 2. Get details on the top trending token
const top = trending[0];
const details = await skill.getTokenDetails({
  tokenAddress: top.address,
  chain: 'solana',
});

console.log(`${details.symbol}: $${details.priceUsd}`);
console.log(`Market Cap: $${details.marketCap}`);
console.log(`24h Volume: $${details.volume24h}`);
console.log(`Liquidity: $${details.liquidity}`);

// 3. Check price history
const candles = await skill.getOHLCV({
  tokenAddress: top.address,
  chain: 'solana',
  resolution: '15',
  from: Math.floor(Date.now() / 1000) - 3600, // last hour
  to: Math.floor(Date.now() / 1000),
});
```

## Related Skills

- **gdex-spot-trading** — Buy/sell tokens after researching them
- **gdex-portfolio** — Check if you already hold a token
- **gdex-onboarding** — Full platform overview
