---
name: gdex-limit-orders
description: Create, cancel, and list limit orders on any supported chain with price triggers and expiration
---

# GDEX: Limit Orders

Create limit orders that trigger when a token reaches your target price. Supports all chains with filtering and expiration.

## When to Use

- Setting a buy order that triggers when price drops to a target
- Setting a sell order that triggers when price rises to a target
- Listing and managing open orders
- Canceling pending orders

## Prerequisites

- `@gdexsdk/gdex-skill` installed
- Authenticated via `loginWithApiKey()` — see **gdex-authentication**

## Create a Limit Order

```typescript
import { GdexSkill, GDEX_API_KEY_PRIMARY } from '@gdexsdk/gdex-skill';

const skill = new GdexSkill();
skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);

// Buy ETH when price drops to $3000
const order = await skill.createLimitOrder({
  chain: 1,                                                     // Ethereum
  side: 'buy',
  inputToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',   // USDC
  outputToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',  // WETH
  inputAmount: '3000',
  limitPrice: '3000',
  expireIn: 86400,   // expires in 24 hours (seconds)
});
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chain` | `string \| ChainId` | Yes | Chain identifier |
| `side` | `'buy' \| 'sell'` | Yes | Order direction |
| `inputToken` | `string` | Yes | Token you're spending |
| `outputToken` | `string` | Yes | Token you're receiving |
| `inputAmount` | `string` | Yes | Amount of input token |
| `limitPrice` | `string` | Yes | Target price to trigger the order |
| `slippage` | `number` | No | Max slippage % when order fills |
| `expireIn` | `number` | No | Expiration in seconds |
| `walletAddress` | `string` | No | Override wallet address |

## List Orders

```typescript
const orders = await skill.getLimitOrders({
  walletAddress: '0xYourAddress',
  chain: 1,            // optional: filter by chain
  status: 'open',      // optional: 'open', 'filled', 'cancelled', 'expired'
  page: 1,             // optional: pagination
  limit: 20,           // optional: results per page
});
```

### Order Object

```typescript
interface LimitOrder {
  id: string;
  walletAddress: string;
  chain: string | number;
  side: 'buy' | 'sell';
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  targetOutputAmount?: string;
  limitPrice: string;
  status: 'open' | 'filled' | 'cancelled' | 'expired';
  filledAmount?: string;
  expiresAt?: string;
  createdAt: string;
  fillTxHash?: string;
}
```

## Cancel an Order

```typescript
await skill.cancelLimitOrder({
  orderId: order.id,
  chain: 1,
});
```

## Example: Solana Limit Order

```typescript
// Sell SOL when price reaches $200
const order = await skill.createLimitOrder({
  chain: 'solana',
  side: 'sell',
  inputToken: 'So11111111111111111111111111111111111111112',       // SOL
  outputToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',  // USDC
  inputAmount: '5',        // 5 SOL
  limitPrice: '200',       // trigger at $200
  slippage: 1,
  expireIn: 604800,        // 7 days
});

console.log('Order created:', order.id);
```

## Related Skills

- **gdex-authentication** — Auth setup required before creating orders
- **gdex-spot-trading** — Market orders (immediate execution) instead of limits
- **gdex-portfolio** — Track order fills in trade history
