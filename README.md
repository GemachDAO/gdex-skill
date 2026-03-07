# @gdexsdk/gdex-skill

> **AI Agent Skill SDK** for the Gbot Trading Dashboard — enables AI agents to trade cross-chain tokens, manage perpetual positions, track portfolios, and discover tokens programmatically.

[![npm version](https://img.shields.io/npm/v/@gdexsdk/gdex-skill.svg)](https://www.npmjs.com/package/@gdexsdk/gdex-skill)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

`@gdexsdk/gdex-skill` transforms the [Gbot Trading Dashboard Backend](https://github.com/TheArcadiaGroup/gbotTradingDashboardBackend) into a clean TypeScript SDK that AI agents can use without browser access or manual UI interaction.

### What you can do

| Feature | Chains |
|---|---|
| 🔄 **Spot Trading** (buy/sell tokens) | Solana, Sui, Ethereum, Base, Arbitrum, BSC, Optimism, Avalanche, Polygon, Linea, Scroll, Blast, zkSync, Fraxtal |
| 📈 **Perpetual Futures** (long/short with TP/SL) | HyperLiquid |
| 📋 **Limit Orders** | All chains |
| 🤖 **Copy Trading** | Solana, HyperLiquid |
| 💼 **Portfolio Management** (balances, P&L, history) | All chains |
| 🔍 **Token Discovery** (trending, OHLCV, details) | All chains |
| 🏆 **Top Traders** | All chains |
| 🌉 **Cross-Chain Bridging** | All chains |
| 👛 **Wallet Info** | All chains |

## Architecture

```
AI Agent
   │
   ▼
GdexSkill SDK (this package)
   │  TypeScript methods with full type safety
   │  Input validation + error normalization
   │  Auth session management (nonce → sign → JWT)
   ▼
Gbot Backend API (HTTP/REST)
   │  @gdex.pro / self-hosted
   │  Trade queue (NATS JetStream)
   │  DEX aggregation engine
   ▼
Blockchains (Solana, Sui, EVM L1s/L2s)
```

## Installation

```bash
npm install @gdexsdk/gdex-skill
```

For EVM wallet signing (required for authentication):
```bash
npm install ethers
```

For Solana wallet signing:
```bash
npm install bs58 tweetnacl
```

## Quick Start

```typescript
import { GdexSkill, ChainId } from '@gdexsdk/gdex-skill';

const skill = new GdexSkill({
  apiUrl: 'https://api.gdex.pro',
});

// No auth needed for read-only operations
const trending = await skill.getTrendingTokens({ chain: 'solana', limit: 5 });
console.log('Top token:', trending[0].symbol, trending[0].priceUsd);

// Authenticate for trading
await skill.authenticate({
  type: 'evm',
  address: '0xYourWalletAddress',
  privateKey: process.env.EVM_PRIVATE_KEY,
});

// Buy a token on Solana
const trade = await skill.buyToken({
  chain: 'solana',
  tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount: '0.1',   // 0.1 SOL
  slippage: 1,     // 1% max slippage
});
console.log('Trade submitted:', trade.jobId);
```

## Configuration

```typescript
const skill = new GdexSkill({
  apiUrl: 'https://api.gdex.pro',  // Backend URL
  apiKey: 'your-api-key',           // Optional API key
  timeout: 30000,                   // Request timeout (ms)
  maxRetries: 3,                    // Retry attempts on failure
  debug: false,                     // Enable debug logging
  userAgent: 'MyAgent/1.0',         // Custom User-Agent
});
```

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `GDEX_API_URL` | Backend API base URL | `https://api.gdex.pro` |
| `GDEX_API_KEY` | API key for requests | — |
| `GDEX_TIMEOUT` | Request timeout (ms) | `30000` |
| `GDEX_MAX_RETRIES` | Max retry attempts | `3` |
| `GDEX_DEBUG` | Enable debug logging | `false` |
| `EVM_PRIVATE_KEY` | EVM wallet private key | — |
| `SOLANA_PRIVATE_KEY` | Solana wallet private key (base58) | — |

## API Reference

### Authentication

```typescript
// Authenticate with an EVM wallet (secp256k1)
const session = await skill.authenticate({
  type: 'evm',
  address: '0xYourAddress',
  privateKey: '0xPrivateKey',
});

// Authenticate with a Solana wallet (ed25519)
const session = await skill.authenticate({
  type: 'solana',
  address: 'YourSolanaAddress',
  privateKey: 'base58EncodedPrivateKey',
});

// Use a custom signer (e.g., hardware wallet or browser extension)
const session = await skill.authenticate({
  type: 'evm',
  address: '0xYourAddress',
  signer: async (message) => {
    return await window.ethereum.request({
      method: 'personal_sign',
      params: [message, '0xYourAddress'],
    });
  },
});

skill.logout();           // Clear session
skill.isAuthenticated();  // true/false
```

---

### Spot Trading

#### `buyToken(params)`

Buy a token on any supported chain.

```typescript
const result = await skill.buyToken({
  chain: 'solana',                                        // Chain identifier
  tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Token to buy
  amount: '0.1',                                         // Input amount (SOL)
  slippage: 1,                                           // Slippage % (default: 1)
  dex: 'raydium',                                        // Force specific DEX (optional)
  walletAddress: '...',                                  // Wallet (optional if set in auth)
  priorityFee: 50000,                                    // Priority fee in lamports (Solana)
});

// result: TradeResult
// {
//   txHash: string, jobId: string, status: 'confirmed' | 'pending' | 'failed',
//   inputAmount, outputAmount, executionPrice, priceImpact, dex
// }
```

#### `sellToken(params)`

Sell a token. Amount can be absolute or a percentage.

```typescript
// Sell 100 USDC
await skill.sellToken({
  chain: ChainId.BASE,
  tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  amount: '100',
  slippage: 0.5,
});

// Sell 50% of holdings
await skill.sellToken({
  chain: 'solana',
  tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount: '50%',
});
```

---

### Perpetual Futures (HyperLiquid)

#### `openPerpPosition(params)`

```typescript
const result = await skill.openPerpPosition({
  coin: 'BTC',              // Asset symbol
  side: 'long',             // 'long' | 'short'
  sizeUsd: '1000',          // Position size in USD
  leverage: 10,             // 1–50x (default: 5)
  takeProfitPrice: '110000', // TP price (optional)
  stopLossPrice: '95000',   // SL price (optional)
  marginMode: 'cross',      // 'cross' | 'isolated' (default: 'cross')
});
```

#### `closePerpPosition(params)`

```typescript
// Close 100% of BTC position
await skill.closePerpPosition({ coin: 'BTC' });

// Close 50% of ETH position
await skill.closePerpPosition({ coin: 'ETH', closePercent: 50 });
```

#### `setPerpLeverage(params)`

```typescript
await skill.setPerpLeverage({ coin: 'BTC', leverage: 20 });
```

#### `getPerpPositions(params)`

```typescript
const positions = await skill.getPerpPositions({ walletAddress: '0x...' });
// Returns: PerpPosition[]
// Each: { coin, side, size, entryPrice, markPrice, leverage, unrealizedPnl, liquidationPrice, ... }
```

#### `perpDeposit(params)` / `perpWithdraw(params)`

```typescript
await skill.perpDeposit({ amount: '1000' });  // Deposit $1000 USDC
await skill.perpWithdraw({ amount: '500' });  // Withdraw $500 USDC
```

---

### Limit Orders

```typescript
// Create a limit order
const order = await skill.createLimitOrder({
  chain: 'solana',
  side: 'buy',
  inputToken: 'So11111111111111111111111111111111111111112',   // SOL
  outputToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  inputAmount: '1',
  limitPrice: '160',  // Buy when 1 SOL = 160 USDC
  slippage: 1,
  expireIn: 86400,  // Expire in 24 hours
});

// Cancel order
await skill.cancelLimitOrder({ orderId: order.id, chain: 'solana' });

// List open orders
const orders = await skill.getLimitOrders({
  walletAddress: '...',
  chain: 'solana',
  status: 'open',
});
```

---

### Copy Trading

```typescript
// Configure copy trading
await skill.setCopyTradeSettings({
  enabled: true,
  maxTradeSize: '100',     // Max $100 per copied trade
  slippage: 1,
  chains: ['solana'],
  copyBuysOnly: false,
  autoStopLossPercent: 10, // Auto-SL at 10% loss
});

// Track a wallet
await skill.addCopyTradeWallet({
  walletAddress: 'TopTraderWalletAddress',
  chain: 'solana',
  label: 'Alpha trader',
});

// Get tracked wallets
const wallets = await skill.getCopyTradeWallets('userId');

// Remove a wallet
await skill.removeCopyTradeWallet({
  walletAddress: 'TopTraderWalletAddress',
  chain: 'solana',
});
```

---

### Portfolio

```typescript
// Full cross-chain portfolio
const portfolio = await skill.getPortfolio({ walletAddress: '...' });
// { totalValueUsd, balances: Balance[], perpPositions?, realizedPnl, unrealizedPnl }

// Balances on a specific chain
const balances = await skill.getBalances({
  walletAddress: '...',
  chain: ChainId.ETHEREUM,
});

// Trade history with pagination
const history = await skill.getTradeHistory({
  walletAddress: '...',
  page: 1,
  limit: 20,
  startTime: 1700000000,
  endTime: 1700086400,
});
```

---

### Token Information

```typescript
// Token details (no auth required)
const token = await skill.getTokenDetails({
  tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  chain: 'solana',
});
// { symbol, name, priceUsd, priceChange24h, marketCap, fdv, volume24h, liquidity, pools, socials }

// Trending tokens
const trending = await skill.getTrendingTokens({
  chain: 'solana',
  period: '24h',
  limit: 20,
  minLiquidity: 50000,
});

// OHLCV candlestick data (no auth required)
const ohlcv = await skill.getOHLCV({
  tokenAddress: 'So11111111111111111111111111111111111111112',
  chain: 'solana',
  resolution: '60',     // 1m, 5m, 15m, 30m, 1h, 4h, 1D, 1W
  from: 1700000000,
  to: 1700086400,
});
```

---

### Top Traders

```typescript
const traders = await skill.getTopTraders({
  chain: 'solana',
  period: '7d',
  limit: 10,
  sortBy: 'pnl',
});
// [{ address, totalPnlUsd, winRate, tradeCount, totalVolumeUsd, performance }]
```

---

### Bridge

```typescript
// Get a quote first
const quote = await skill.getBridgeQuote({
  fromChain: 'solana',
  toChain: ChainId.ETHEREUM,
  tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount: '100',
});
console.log('Expected output:', quote.outputAmount);

// Execute bridge
const result = await skill.bridge({
  fromChain: 'solana',
  toChain: ChainId.ETHEREUM,
  tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount: '100',
  destinationAddress: '0xYourEthAddress',
  slippage: 0.5,
});
```

---

### Wallet Info

```typescript
const info = await skill.getWalletInfo({
  walletAddress: 'SolanaWalletAddress',
  chain: 'solana',
});
// { address, nativeBalance, nativeSymbol, totalValueUsd, tokenCount }
```

---

## Supported Chains

| Chain | ID | Native Token | DEXes |
|---|---|---|---|
| **Solana** | `'solana'` | SOL | Raydium, Orca |
| **Sui** | `'sui'` | SUI | Cetus, Bluefin |
| **Ethereum** | `1` | ETH | Uniswap V2/V3, Odos |
| **BNB Smart Chain** | `56` | BNB | PancakeSwap, Odos |
| **Optimism** | `10` | ETH | Uniswap V3, Odos |
| **Arbitrum One** | `42161` | ETH | Uniswap V3, Odos |
| **Avalanche** | `43114` | AVAX | Uniswap V2/V3, Odos |
| **Base** | `8453` | ETH | Uniswap V3, Odos, Arcadia |
| **Polygon** | `137` | MATIC | Uniswap V3, Odos |
| **Fraxtal** | `252` | frxETH | Uniswap V3 |
| **Linea** | `59144` | ETH | Uniswap V3 |
| **Scroll** | `534352` | ETH | Uniswap V3 |
| **Blast** | `81457` | ETH | Uniswap V3 |
| **zkSync Era** | `324` | ETH | Uniswap V3 |

## Error Handling

```typescript
import {
  GdexError,
  GdexAuthError,
  GdexValidationError,
  GdexApiError,
  GdexNetworkError,
  GdexRateLimitError,
  GdexErrorCode,
} from '@gdexsdk/gdex-skill';

try {
  await skill.buyToken({ ... });
} catch (err) {
  if (err instanceof GdexAuthError) {
    console.error('Auth failed — re-authenticate');
  } else if (err instanceof GdexValidationError) {
    console.error(`Invalid input: ${err.field} — ${err.message}`);
  } else if (err instanceof GdexRateLimitError) {
    console.error(`Rate limited — retry after ${err.retryAfter}s`);
  } else if (err instanceof GdexApiError) {
    console.error(`API error ${err.statusCode}: ${err.message}`);
  } else if (err instanceof GdexNetworkError) {
    console.error(`Network error (${err.code}): ${err.message}`);
  }
}
```

### Error Classes

| Class | Code | When thrown |
|---|---|---|
| `GdexAuthError` | `AUTH_FAILED` / `AUTH_REQUIRED` | 401/403 responses, invalid credentials |
| `GdexValidationError` | `VALIDATION_ERROR` | Invalid input params (address, amount, chain) |
| `GdexApiError` | `API_ERROR` / `NOT_FOUND` | Non-success HTTP responses (4xx/5xx) |
| `GdexNetworkError` | `NETWORK_ERROR` / `TIMEOUT` | Connection failures, timeouts |
| `GdexRateLimitError` | `RATE_LIMITED` | 429 responses |

## Utility Functions

```typescript
import {
  getChainName,          // getChainName(ChainId.BASE) → "Base"
  getNativeToken,        // getNativeToken('solana') → "SOL"
  formatTokenAmount,     // formatTokenAmount("1000000", 6, "USDC") → "1 USDC"
  formatUsd,             // formatUsd("1234.5") → "$1,234.50"
  formatPercentChange,   // formatPercentChange("5.23") → "+5.23%"
  shortenAddress,        // shortenAddress("0x1234...5678") → "0x1234...5678"
  formatTimestamp,       // formatTimestamp(1700000000) → "2023-11-14T22:13:20.000Z"
  validateAddress,       // Throws GdexValidationError if invalid
  validateAmount,        // Throws GdexValidationError if invalid
  validateChain,         // Throws GdexValidationError if unsupported
} from '@gdexsdk/gdex-skill';
```

## ChainId Enum

```typescript
import { ChainId } from '@gdexsdk/gdex-skill';

ChainId.ETHEREUM   // 1
ChainId.BSC        // 56
ChainId.OPTIMISM   // 10
ChainId.ARBITRUM   // 42161
ChainId.AVALANCHE  // 43114
ChainId.BASE       // 8453
ChainId.POLYGON    // 137
ChainId.FRAXTAL    // 252
ChainId.LINEA      // 59144
ChainId.SCROLL     // 534352
ChainId.BLAST      // 81457
ChainId.ZKSYNC     // 324
```

## Advanced Usage

### Direct API Client

For advanced use cases, you can use the underlying `GdexApiClient` directly:

```typescript
import { GdexApiClient, Endpoints } from '@gdexsdk/gdex-skill';

const client = new GdexApiClient({ apiUrl: 'https://api.gdex.pro' });

// Make raw API calls
const data = await client.get(Endpoints.TRENDING, { chain: 'solana' });
const result = await client.post(Endpoints.PURCHASE_V2, { ... });
```

### Custom Auth Signer

For use with hardware wallets or browser extensions:

```typescript
// With MetaMask (browser)
await skill.authenticate({
  type: 'evm',
  address: accounts[0],
  signer: async (message) => {
    return await window.ethereum.request({
      method: 'personal_sign',
      params: [message, accounts[0]],
    });
  },
});

// With Phantom (Solana browser wallet)
await skill.authenticate({
  type: 'solana',
  address: wallet.publicKey.toBase58(),
  signer: async (message) => {
    const encoded = new TextEncoder().encode(message);
    const signature = await wallet.signMessage(encoded);
    return Buffer.from(signature).toString('base64');
  },
});
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Run `npm test` and `npm run build`
5. Submit a pull request

## License

MIT © [GemachDAO](https://github.com/GemachDAO)
