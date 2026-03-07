---
name: gdex-trading
description: Execute cross-chain DeFi trades via GDEX managed-custody wallets, manage perpetual futures positions, query token prices and portfolio balances on Gbot Trading Dashboard. All trading goes through encrypted computedData payloads (AES-256-CBC) — the control wallet signs in once, then a session keypair handles trades. Generate a new EVM control wallet for users without wallets — the backend provides Solana + other trading wallets automatically via managed custody. Use when asked to buy/sell tokens, open/close perp positions, check portfolio, find trending tokens, bridge assets, or set up a new wallet.
metadata:
  author: GemachDAO
  version: "1.0.0"
  argument-hint: <action> [params]
---

# Gdex Trading Skill

Execute cross-chain DeFi operations via the Gbot Trading Dashboard backend API at `https://trade-api.gemach.io/v1`.

## Authentication

All trading goes through GDEX **managed-custody** wallets. The flow uses encrypted `computedData` payloads (AES-256-CBC) rather than plain API keys or bearer tokens.

### Quick Start (shared API key for read-only)

```typescript
import { GdexSkill, GDEX_API_KEY_PRIMARY } from '@gdexsdk/gdex-skill';

const skill = new GdexSkill();
skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);
```

**API Keys (pre-configured, shared for all agents):**
- Primary: `9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54`
- Secondary: `2c8f0a91-5d34-4e7b-9a62-f1c3d8e4b705`

Read-only actions (token details, trending, OHLCV, top traders) do not require authentication.

### Managed-Custody Trade Flow (for all trading)

All trades go through GDEX server-side managed wallets. The control wallet (EVM or Solana) is used
only for initial sign-in — GDEX provisions and manages all on-chain trading wallets.

```typescript
import {
  GdexSkill,
  GDEX_API_KEY_PRIMARY,
  generateGdexSessionKeyPair,
  buildGdexSignInMessage,
  buildGdexSignInComputedData,
  buildGdexManagedTradeComputedData,
  buildGdexUserSessionData,
} from '@gdexsdk/gdex-skill';

const skill = new GdexSkill();
skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);
const apiKey = GDEX_API_KEY_PRIMARY;

// 1. Generate a secp256k1 session keypair
const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();
// sessionKey = compressed public key (0x + 66 hex chars)

// 2. Build and sign the sign-in message with your control wallet
const userId = '0xYourControlWalletAddress'; // EVM address or Solana pubkey
const nonce = String(Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000));
const message = buildGdexSignInMessage(userId, nonce, sessionKey);
// → "By signing, you agree to GDEX Trading Terms of Use and Privacy Policy. Your GDEX log in message: <userId> <nonce> <sessionKeyHex>"

// Sign with your control wallet:
//   EVM:    wallet.signMessage(message)                → EIP-191 personal_sign
//   Solana: nacl.sign.detached(Buffer.from(message))   → base58 encoded

const signature = '...'; // your wallet's signature

// 3. Build encrypted computedData and POST to /v1/sign_in
const signInPayload = buildGdexSignInComputedData({ apiKey, userId, sessionKey, nonce, signature });
const signInResult = await skill.signInWithComputedData({
  computedData: signInPayload.computedData,
  chainId: 900, // 900=Solana, 101=Sui, or numeric EVM chain ID
});

// 4. Resolve user profile / check managed wallet
const userData = buildGdexUserSessionData(sessionKey, apiKey);
const user = await skill.getManagedUser({ userId, data: userData, chainId: 900 });

// 5. Build encrypted trade payload and submit
const trade = buildGdexManagedTradeComputedData({
  apiKey,
  action: 'purchase', // or 'sell'
  userId,
  tokenAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  amount: '100000',   // in smallest unit
  nonce: String(Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000)),
  sessionPrivateKey,
});

const result = await skill.submitManagedPurchase({
  computedData: trade.computedData,
  chainId: 900,
  slippage: 1,
});

// 6. Poll trade status
if (result.requestId) {
  const status = await skill.getManagedTradeStatus(result.requestId);
  console.log('Status:', status.status, 'Hash:', status.hash);
}
```

**Chain IDs:** 900 = Solana, 101 = Sui, 1 = Ethereum, 8453 = Base, 42161 = Arbitrum, 56 = BSC

## Setup

Install the SDK:

```bash
npm install @gdexsdk/gdex-skill
```

Initialize:

```typescript
import { GdexSkill, GDEX_API_KEY_PRIMARY } from '@gdexsdk/gdex-skill';

const skill = new GdexSkill();
skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);
```

## Supported Chains

| Chain | Identifier | DEXes |
|-------|-----------|-------|
| Solana | `solana` | Raydium, Raydium v2, Orca |
| Sui | `sui` | Cetus, Bluefin |
| Ethereum | `1` | Uniswap v2/v3 |
| Base | `8453` | Uniswap v3, Odos, Arcadia |
| Arbitrum | `42161` | Uniswap v2/v3, Odos |
| BSC | `56` | PancakeSwap |
| Optimism | `10` | Uniswap v2/v3 |
| Avalanche | `43114` | Odos |
| Polygon | `137` | Uniswap v2/v3 |
| Linea | `59144` | Odos |
| Scroll | `534352` | Odos |
| Blast | `81457` | Odos |
| zkSync | `324` | Odos |
| Fraxtal | `252` | Odos |
| HyperLiquid | Perpetuals only | Native perp engine |

## Actions

### Wallet Generation (no auth required)

When a user says they don't have a wallet, generate an EVM **control wallet** for them. The EVM wallet is all you need — once authenticated via the managed-custody `sign_in` flow, the Gbot backend automatically provisions their full trading wallet including a Solana address and other chain-specific keys. No separate Solana wallet generation is needed.

```typescript
import { generateEvmWallet, generateGdexSessionKeyPair, GDEX_API_KEY_PRIMARY } from '@gdexsdk/gdex-skill';

// Step 1: generate the EVM control wallet (one-time setup)
const wallet = generateEvmWallet();
// wallet.address    — public address (safe to share / display to user)
// wallet.privateKey — MUST be stored securely (never log or share)
// wallet.mnemonic   — 12-word backup phrase (store securely)

console.log('Your new wallet address:', wallet.address);

// Step 2: generate a session keypair for managed-custody trading
const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();
// Save sessionPrivateKey to reuse across requests

// Step 3: sign in via managed-custody flow (see Managed-Custody Trade Flow above)
// The backend provisions Solana + all other trading wallets server-side
```

> ⚠️ Always remind the user to save their private key and mnemonic securely. Keys are generated locally and never sent over the network.

### Spot Trading

**Buy a token:**
```typescript
const trade = await skill.buyToken({
  chain: 'solana',                                        // chain name or ChainId number
  tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC on Solana
  amount: '0.1',                                          // 0.1 SOL (native token)
  slippage: 1,                                            // 1% max slippage (optional, default: 1)
  dex: 'raydium',                                         // optional: prefer a specific DEX
});
// Returns: { jobId, status, inputAmount, outputAmount, txHash?, error? }
```

**Sell a token:**
```typescript
const trade = await skill.sellToken({
  chain: 8453,                                            // Base (ChainId number)
  tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
  amount: '50%',                                          // sell 50% of holdings (or absolute like '100')
  slippage: 0.5,
});
```

### Perpetual Futures (HyperLiquid)

**Open a position:**
```typescript
const pos = await skill.openPerpPosition({
  coin: 'BTC',            // asset symbol
  side: 'long',           // 'long' or 'short'
  sizeUsd: '1000',        // collateral in USD
  leverage: 10,           // multiplier (1–50), default: 5
  takeProfitPrice: '110000',  // optional take-profit
  stopLossPrice: '95000',     // optional stop-loss
  marginMode: 'cross',        // 'cross' or 'isolated', default: 'cross'
});
```

**Close a position:**
```typescript
await skill.closePerpPosition({
  coin: 'BTC',
  closePercent: 100,   // close 100% (default), or partial e.g. 50
});
```

**Get open positions:**
```typescript
const positions = await skill.getPerpPositions({
  walletAddress: '0xYourAddress',
  coin: 'BTC',   // optional filter
});
```

**Set leverage:**
```typescript
await skill.setPerpLeverage({ coin: 'ETH', leverage: 5, marginMode: 'isolated' });
```

**Deposit / Withdraw USDC:**
```typescript
await skill.perpDeposit({ amount: '500' });   // deposit $500 USDC
await skill.perpWithdraw({ amount: '100' });  // withdraw $100 USDC
```

### Limit Orders

```typescript
// Create a limit order (buy ETH when price drops to $3000)
const order = await skill.createLimitOrder({
  chain: 1,
  side: 'buy',
  inputToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',  // USDC
  outputToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
  inputAmount: '3000',
  limitPrice: '3000',
  expireIn: 86400,   // expires in 24 hours
});

// List open orders
const orders = await skill.getLimitOrders({
  walletAddress: '0xYourAddress',
  chain: 1,
  status: 'open',
});

// Cancel an order
await skill.cancelLimitOrder({ orderId: order.id, chain: 1 });
```

### Portfolio & Balances

```typescript
// Full cross-chain portfolio
const portfolio = await skill.getPortfolio({ walletAddress: '0xYourAddress' });
// Returns: { totalValueUsd, pnl24h, pnl24hPercent, tokens: [...], chains: {...} }

// Balances on a specific chain
const balances = await skill.getBalances({
  walletAddress: '0xYourAddress',
  chain: 8453,  // Base
});

// Trade history
const history = await skill.getTradeHistory({
  walletAddress: '0xYourAddress',
  page: 1,
  limit: 20,
});
```

### Token Discovery (no auth required)

```typescript
// Token details
const token = await skill.getTokenDetails({
  tokenAddress: 'So11111111111111111111111111111111111111112',
  chain: 'solana',
});
// Returns: { symbol, name, priceUsd, priceChange24h, marketCap, volume24h, ... }

// Trending tokens
const trending = await skill.getTrendingTokens({
  chain: 'solana',
  period: '24h',  // '1h' | '6h' | '24h' | '7d'
  limit: 20,
});

// OHLCV candlestick data
const candles = await skill.getOHLCV({
  tokenAddress: 'So11111111111111111111111111111111111111112',
  chain: 'solana',
  resolution: '60',  // '1'|'5'|'15'|'30'|'60'|'240'|'D'|'W'
  from: Math.floor(Date.now() / 1000) - 86400,
  to: Math.floor(Date.now() / 1000),
});
```

### Top Traders

```typescript
const traders = await skill.getTopTraders({
  period: '7d',    // '1d' | '7d' | '30d' | 'all'
  limit: 10,
  sortBy: 'pnl',   // 'pnl' | 'winRate' | 'volume' | 'tradeCount'
});
```

### Copy Trading

```typescript
// Track a wallet
await skill.addCopyTradeWallet({ walletAddress: '0xTraderAddress', chain: 1, label: 'Top Trader' });

// Get tracked wallets
const wallets = await skill.getCopyTradeWallets('your-user-id');

// Configure copy trade settings
await skill.setCopyTradeSettings({
  enabled: true,
  maxTradeSize: '100',
  slippage: 1,
  copyBuysOnly: true,
});

// Remove a tracked wallet
await skill.removeCopyTradeWallet({ walletAddress: '0xTraderAddress', chain: 1 });
```

### Cross-Chain Bridge

```typescript
// Get a quote first
const quote = await skill.getBridgeQuote({
  fromChain: 'solana',
  toChain: 8453,   // Base
  tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',  // USDC
  amount: '100',
});

// Execute bridge
const bridge = await skill.bridge({
  fromChain: 'solana',
  toChain: 8453,
  tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount: '100',
  slippage: 0.5,
});
```

### Wallet Info

```typescript
const walletInfo = await skill.getWalletInfo({
  walletAddress: '0xYourAddress',
  chain: 1,
});
```

## Error Handling

```typescript
import { GdexAuthError, GdexApiError, GdexValidationError, GdexRateLimitError } from '@gdexsdk/gdex-skill';

try {
  await skill.buyToken({ ... });
} catch (err) {
  if (err instanceof GdexRateLimitError) {
    // Wait err.retryAfter seconds before retrying
    await delay(err.retryAfter * 1000);
  } else if (err instanceof GdexAuthError) {
    // Re-authenticate
    skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);
  } else if (err instanceof GdexValidationError) {
    // Fix invalid parameter
    console.error('Invalid param:', err.message);
  } else if (err instanceof GdexApiError) {
    console.error('API error:', err.status, err.message);
  }
}
```

## Response Status Values

Trade responses (`TradeResult`) include:
- `status: 'queued'` — trade submitted to queue
- `status: 'pending'` — being processed
- `status: 'completed'` — trade executed on-chain
- `status: 'failed'` — trade failed (check `error` field)

## Notes

- All trading goes through GDEX managed-custody wallets — the control wallet is only used for sign-in
- Trade payloads use AES-256-CBC encryption (`computedData`) derived from the API key's SHA256 hash chain
- Trade signatures use raw keccak256 + secp256k1 (no EIP-191 prefix) with the session private key; **v = raw recoveryParam** (`00`/`01`), NOT EIP-155 (`1b`/`1c`)
- Session key encryption for `/v1/user` uses hex-decoded raw bytes (`encryptGdexHexData`), not UTF-8 string encoding
- Nonces are **client-generated**: `Math.floor(Date.now()/1000) + Math.floor(Math.random()*1000)` — not fetched from the server
- ABI schemas: sign-in uses `['bytes','string','string']`, trades use `['string','uint256','string']`
- All amounts are strings to preserve precision (e.g., `'0.1'`, `'1000'`)
- Chain can be specified as a string (`'solana'`, `'sui'`) or a ChainId number (`1`, `8453`, etc.)
- Chain IDs: 900 = Solana, 101 = Sui, or standard EVM chain IDs
- Sell amounts can be absolute (`'100'`) or percentage (`'50%'`)
- The SDK automatically retries on transient errors (429, 503) with exponential backoff
- `generateEvmWallet()` works fully offline — no auth or network needed; backend provides trading wallets (incl. Solana) after auth
