---
name: gdex-trading
description: Cross-chain DeFi trading skill for AI agents — spot trading, perpetual futures, portfolio management, and token discovery on Solana, Sui, and 12+ EVM chains via managed-custody wallets. Load gdex-onboarding to get started, or load a specific skill below for your task.
metadata:
  author: GemachDAO
  version: "1.0.0"
  argument-hint: <action> [params]
---

# GDEX Trading Skill

Cross-chain DeFi trading infrastructure for AI agents. All trading goes through encrypted `computedData` payloads (AES-256-CBC) with managed-custody wallets on the Gbot Trading Dashboard backend (`https://trade-api.gemach.io/v1`).

**Start here:** Load **gdex-onboarding** for a full overview and quickstart guide.

## Available Skills

| Category | Skill | Description | Auth Required? |
|----------|-------|-------------|----------------|
| **Getting Started** | `gdex-onboarding` | Platform overview, architecture, supported chains, quickstart | — |
| **Auth** | `gdex-authentication` | Managed-custody auth, encryption, session keys, API key login | — |
| **Trading** | `gdex-spot-trading` | Buy/sell tokens on any chain with DEX routing | Yes |
| | `gdex-perp-trading` | HyperLiquid perpetual futures — positions, orders, leverage, TP/SL | Yes |
| | `gdex-perp-funding` | Deposit/withdraw USDC to/from HyperLiquid | Yes |
| | `gdex-limit-orders` | Create, cancel, and list limit orders | Yes |
| **Data** | `gdex-portfolio` | Cross-chain portfolio, balances, trade history | Yes |
| | `gdex-token-discovery` | Token details, trending tokens, OHLCV charts | **No** |
| **Platform** | `gdex-copy-trading` | Copy trade settings, tracked wallets, top traders | Yes |
| | `gdex-bridge` | Cross-chain bridging with quotes | Yes |
| | `gdex-wallet-setup` | Generate EVM wallets, session keys, wallet info | **No** |

## Quick Decision Guide

- **"Buy/sell a token"** → Load `gdex-authentication` + `gdex-spot-trading`
- **"Open a perp position"** → Load `gdex-authentication` + `gdex-perp-funding` + `gdex-perp-trading`
- **"Check token price or trending"** → Load `gdex-token-discovery` (no auth needed)
- **"Check portfolio/balances"** → Load `gdex-authentication` + `gdex-portfolio`
- **"User has no wallet"** → Load `gdex-wallet-setup` + `gdex-authentication`
- **"Copy a trader"** → Load `gdex-authentication` + `gdex-copy-trading`
- **"Bridge tokens"** → Load `gdex-authentication` + `gdex-bridge`
- **"Create a limit order"** → Load `gdex-authentication` + `gdex-limit-orders`

## Critical Notes (Live-Tested)

> **walletAddress = CONTROL address, NOT managed address.** All HL write operations (`hlCreateOrder`, `hlCloseAll`, `perpDeposit`, etc.) require `walletAddress` set to the **control wallet address** used during sign-in — NOT the managed-custody address returned by `/v1/user`. The backend verifies the session key signature against the sign-in `userId`. Passing the managed address causes `400 Unauthorized (code 103)`.

> **`hlCloseAll` / `/v1/hl/close_all_positions` is unreliable.** It frequently returns `TIMEOUT` or JSON parse errors. To close positions reliably, place a **reduce-only** `hl_create_order` sell/buy for the exact position size instead.

> **`hlUpdateLeverage` / `/v1/hl/update_leverage` is not implemented** on the backend (returns 404). Leverage is set automatically when placing orders — pass the desired leverage indirectly via position sizing.

> **Solana chainId is `622112261`, NOT `900`.** The correct Solana chain ID is `ChainId.SOLANA = 622112261`. Using `900` falls back to the EVM managed address with `balance: null`. The `/v1/user` endpoint returns a **different managed wallet** per `chainId`:
> - `chainId=1` → EVM managed: `0x9967...`
> - `chainId=622112261` → Solana managed: `CFSi4YimeCbfSNqH2WmHwJKwj1YYG1cWBtQyVPB4sCe1` (base58)
> Always use `ChainId.SOLANA` from the SDK's enum to avoid this mistake.

> **Solana Meteora swaps are broken (backend bug).** Tokens that route through Meteora DLMM (e.g. BONK) fail with `Program error: 1` because the backend doesn’t wrap SOL into WSOL before calling `Swap2`. **Raydium-routed tokens work correctly** (e.g. WIF). Check `token.dexId` — if it's `"meteora"`, the swap will fail. Prefer tokens with `isRaydium: true` or `dexId: "raydium"`.

> **Solana trades need ~0.01 SOL minimum.** ATA (Associated Token Account) creation costs ~0.002 SOL per new token, plus priority fees (default 0.0005 SOL) and base tx fees. First trade on a new token needs ~0.007 SOL overhead beyond the swap amount.

> **Bridge endpoints use different paths than expected.** The actual backend routes are `GET /v1/bridge/estimate_bridge`, `POST /v1/bridge/request_bridge`, and `GET /v1/bridge/bridge_orders`. The `request_bridge` endpoint requires ABI-encoded + signed + AES-encrypted `computedData` (same pattern as managed trades). Bridge is **native tokens only** and uses ChangeNow as provider. Amounts must be in **raw token units** (wei/lamports). See **gdex-bridge** skill for full details.

## Quick Start

```typescript
import { GdexSkill, GDEX_API_KEY_PRIMARY } from '@gdexsdk/gdex-skill';

const skill = new GdexSkill();
skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);

// No-auth endpoints work immediately
const trending = await skill.getTrendingTokens({ chain: 'solana', period: '24h', limit: 5 });

// Auth-required endpoints
const trade = await skill.buyToken({
  chain: 'solana',
  tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount: '0.1',
  slippage: 1,
});
```

**Shared API Keys:** `9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54` (primary), `2c8f0a91-5d34-4e7b-9a62-f1c3d8e4b705` (secondary)

## Installation

```bash
# Install all skills
npx skills add GemachDAO/gdex-skill --all --agent '*' -g

# Install SDK
npm install @gdexsdk/gdex-skill
```
| userId | Control wallet address (from sign-in), NOT managed wallet |
| Bridge receiver | `0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7` |

### HL Signature Format

All HL write operations sign with the **session private key** (registered during sign-in):
```
message = "{action}-{userId.toLowerCase()}-{dataHex}" // e.g. "hl_deposit-0x53d0...-0000..."
digest  = keccak256(utf8Bytes(message))
output  = r(64hex) + s(64hex) + v(2hex)  // 130 chars, v=00/01, no 0x prefix
```

### HL Error Codes

| Code | Error | Common Cause |
|---|---|---|
| 103 | Unauthorized | Wrong ABI type (uint256 instead of uint64), wrong userId, or signing with wrong key |
| 102 | Invalid chainId | chainId is not 42161 |
| 102 | Invalid params | Reused nonce or unsupported token |
| — | Insufficient balance | Managed wallet needs more USDC + fee on Arbitrum |
| — | Too low amount | Amount < 10 USDC (10000000 smallest unit) |
