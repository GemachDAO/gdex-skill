---
name: gdex-bridge
description: Cross-chain bridging — get quotes and execute token transfers between Solana, Sui, and EVM chains
---

# GDEX: Cross-Chain Bridge

Bridge tokens between supported chains with quote previews and slippage control.

## When to Use

- Moving tokens from one chain to another (e.g., Solana → Base)
- Getting a bridge quote before executing
- Checking estimated fees and delivery times

## Prerequisites

- `@gdexsdk/gdex-skill` installed
- Authenticated via `loginWithApiKey()` — see **gdex-authentication**

## Get a Bridge Quote

```typescript
import { GdexSkill, GDEX_API_KEY_PRIMARY } from '@gdexsdk/gdex-skill';

const skill = new GdexSkill();
skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);

const quote = await skill.getBridgeQuote({
  fromChain: 'solana',
  toChain: 8453,          // Base
  tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',  // USDC on Solana
  amount: '100',
});
```

### Quote Response

```typescript
interface BridgeQuote {
  fromChain: string | number;
  toChain: string | number;
  inputAmount: string;
  outputAmount: string;     // estimated output after fees
  feeUsd?: number;
  estimatedTime?: number;   // seconds
  protocol?: string;        // bridge protocol used
}
```

## Execute a Bridge

```typescript
const bridge = await skill.bridge({
  fromChain: 'solana',
  toChain: 8453,            // Base
  tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount: '100',
  slippage: 0.5,
  destinationAddress: '0xOptionalDestination',  // optional: defaults to your managed wallet
});
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fromChain` | `string \| ChainId` | Yes | Source chain |
| `toChain` | `string \| ChainId` | Yes | Destination chain |
| `tokenAddress` | `string` | Yes | Token to bridge |
| `amount` | `string` | Yes | Amount to bridge |
| `slippage` | `number` | No | Max slippage % |
| `destinationAddress` | `string` | No | Destination wallet (defaults to managed wallet) |
| `walletAddress` | `string` | No | Source wallet override |

### Bridge Result

```typescript
interface BridgeResult {
  sourceTxHash: string;
  destinationTxHash?: string;   // available after completion
  fromChain: string | number;
  toChain: string | number;
  inputAmount: string;
  outputAmount: string;
  status: string;
  estimatedCompletionTime?: number;
}
```

## Supported Chains for Bridging

| Chain | ChainId |
|-------|---------|
| Ethereum | `1` |
| Optimism | `10` |
| BSC | `56` |
| Sonic | `146` |
| Fraxtal | `252` |
| Nibiru | `6900` |
| Base | `8453` |
| Arbitrum | `42161` |
| Berachain | `80094` |
| Solana | `'solana'` / `622112261` |
| Sui | `'sui'` / `1313131213` |

## Example: Bridge USDC from Solana to Base

```typescript
const skill = new GdexSkill();
skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);

// 1. Check the quote
const quote = await skill.getBridgeQuote({
  fromChain: 'solana',
  toChain: 8453,
  tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount: '100',
});
console.log(`Output: ${quote.outputAmount} USDC, Fee: $${quote.feeUsd}, Time: ${quote.estimatedTime}s`);

// 2. Execute if acceptable
const result = await skill.bridge({
  fromChain: 'solana',
  toChain: 8453,
  tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount: '100',
  slippage: 0.5,
});
console.log('Source tx:', result.sourceTxHash);
console.log('Status:', result.status);
```

## Related Skills

- **gdex-authentication** — Auth setup required for bridging
- **gdex-portfolio** — Check balances on target chain after bridging
- **gdex-spot-trading** — Trade on the destination chain after bridging
