<div align="center">

```
  ██████╗ ██████╗ ███████╗██╗  ██╗   ██████╗ ██████╗  ██████╗
 ██╔════╝ ██╔══██╗██╔════╝╚██╗██╔╝   ██╔══██╗██╔══██╗██╔═══██╗
 ██║  ███╗██║  ██║█████╗   ╚███╔╝    ██████╔╝██████╔╝██║   ██║
 ██║   ██║██║  ██║██╔══╝   ██╔██╗    ██╔═══╝ ██╔══██╗██║   ██║
 ╚██████╔╝██████╔╝███████╗██╔╝ ██╗   ██║     ██║  ██║╚██████╔╝
  ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝   ╚═╝     ╚═╝  ╚═╝ ╚═════╝
               · p r o ·    powered by GEMACH
```

**AI Agent Skill for the [Gbot Trading Dashboard](https://github.com/TheArcadiaGroup/gbotTradingDashboardBackend)**  
Cross-chain spot trading · Perpetual futures · Portfolio management · Token discovery · Managed-custody trading

[![npm version](https://img.shields.io/npm/v/@gdexsdk/gdex-skill.svg?style=for-the-badge)](https://www.npmjs.com/package/@gdexsdk/gdex-skill)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-F7DF1E.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![skills.sh](https://img.shields.io/badge/skills.sh-compatible-8B5CF6.svg?style=for-the-badge)](https://skills.sh)
[![Tests](https://img.shields.io/badge/tests-80%20passing-22C55E.svg?style=for-the-badge)](#testing)

</div>

---

## Table of Contents

- [Install as an Agent Skill](#-install-as-an-agent-skill)
- [SDK Installation](#-sdk-installation)
- [Quick Start](#-quick-start)
- [Verify (offline)](#-verify-offline)
- [Authentication](#-authentication)
- [API Reference](#-api-reference)
  - [Spot Trading](#spot-trading)
  - [Perpetual Futures](#perpetual-futures-hyperliquid)
  - [Limit Orders](#limit-orders)
  - [Copy Trading](#copy-trading)
  - [Portfolio](#portfolio)
  - [Token Information](#token-information)
  - [Top Traders](#top-traders)
  - [Bridge](#bridge)
  - [Wallet Info](#wallet-info)
  - [Wallet Generation](#wallet-generation)
- [Supported Chains](#-supported-chains)
- [Error Handling](#-error-handling)
- [Utility Functions](#-utility-functions)
- [Testing](#-testing)
- [Architecture](#-architecture)

---

## 🤖 Install as an Agent Skill

Install directly into Claude Code, Cursor, Codex, Windsurf, and [40+ other agents](https://github.com/vercel-labs/skills#supported-agents) using the [skills CLI](https://skills.sh):

```bash
npx skills add GemachDAO/gdex-skill
```

This copies `SKILL.md` into your agent's skill directory. The agent will then be able to call the Gbot Trading API for any trading, portfolio, or token discovery task — **no API key setup required** (shared keys are built in).

---

## 📦 SDK Installation

```bash
npm install @gdexsdk/gdex-skill
```

> The install script displays a quick-start banner in your terminal. Optional peer dependencies for wallet signing (only needed for user-specific wallet auth):
> ```bash
> npm install ethers        # EVM wallet auth
> npm install bs58 tweetnacl  # Solana wallet auth
> ```

---

## 🚀 Quick Start

```typescript
import { GdexSkill, GDEX_API_KEY_PRIMARY } from '@gdexsdk/gdex-skill';

// 1. Create skill instance
const skill = new GdexSkill();

// 2. Authenticate with pre-configured shared key — no wallet needed
skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);

// 3. Spot buy on Solana
const trade = await skill.buyToken({
  chain: 'solana',
  tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  amount: '0.1',   // 0.1 SOL
  slippage: 1,     // 1% max slippage
});
console.log('Trade submitted:', trade.jobId, '— status:', trade.status);

// 4. Open a BTC 10× long on HyperLiquid
const pos = await skill.openPerpPosition({
  coin: 'BTC',
  side: 'long',
  sizeUsd: '1000',
  leverage: 10,
  takeProfitPrice: '110000',
  stopLossPrice: '95000',
});

// 5. Read-only endpoints need no auth
const trending = await skill.getTrendingTokens({ chain: 'solana', period: '24h', limit: 5 });
console.log('Trending:', trending.map(t => t.symbol).join(', '));
```

---

## ✅ Verify (offline)

Confirm the SDK is installed and configured correctly — **no network connection or API key required**:

```bash
npm run verify
```

Sample output:

```
1. SDK import
  ✓  SDK imported from ../dist/index.js

2. API keys
  ✓  GDEX_API_KEY_PRIMARY   = 9b4e1c73...
  ✓  GDEX_API_KEY_SECONDARY = 2c8f0a91...
  ✓  GDEX_API_KEYS array    = 2 keys

3. GdexSkill instantiation
  ✓  new GdexSkill() — default config
  ✓  new GdexSkill({ apiUrl, timeout, maxRetries }) — custom config

4. Authentication state (offline)
  ✓  isAuthenticated() = false before login
  ✓  loginWithApiKey(GDEX_API_KEY_PRIMARY) → isAuthenticated() = true
  ✓  logout() → isAuthenticated() = false

...

  All 20 checks passed ✓
  SDK is ready — no network token required.
```

---

## 🔑 Authentication

### Shared API Keys (recommended for agents)

Two shared keys are pre-configured in the package — agents do not need to sign wallet transactions:

```typescript
import {
  GdexSkill,
  GDEX_API_KEY_PRIMARY,
  GDEX_API_KEY_SECONDARY,
  GDEX_API_KEYS,
} from '@gdexsdk/gdex-skill';

const skill = new GdexSkill();
skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);  // use primary
// or:
skill.loginWithApiKey(GDEX_API_KEY_SECONDARY); // use secondary
// or cycle through them:
skill.loginWithApiKey(GDEX_API_KEYS[0]);

skill.isAuthenticated(); // → true
skill.logout();          // clear session
```

> **Note:** Read-only endpoints (`getTrendingTokens`, `getTokenDetails`, `getOHLCV`, `getTopTraders`) do not require authentication.

### Wallet-based Auth (advanced)

For user-owned wallets or custom signers (hardware wallets, browser extensions):

```typescript
// EVM wallet (secp256k1)
await skill.authenticate({
  type: 'evm',
  address: '0xYourAddress',
  privateKey: '0xPrivateKey',
});

// Solana wallet (ed25519)
await skill.authenticate({
  type: 'solana',
  address: 'YourSolanaAddress',
  privateKey: 'base58EncodedPrivateKey',
});

// Custom signer (MetaMask / Phantom)
await skill.authenticate({
  type: 'evm',
  address: accounts[0],
  signer: async (message) =>
    window.ethereum.request({ method: 'personal_sign', params: [message, accounts[0]] }),
});
```

### Configuration

```typescript
const skill = new GdexSkill({
  apiUrl:     'https://trade-api.gemach.io/v1', // Backend (default)
  timeout:    30000,                          // Request timeout ms
  maxRetries: 3,                              // Retry attempts on 429/503
  debug:      false,                          // Log every request
});
```

The SDK does **not** read environment variables directly. If you choose to use env vars,
read them in your application (for example via `process.env`) and pass their values into
the `GdexSkill` constructor as shown above.

Recommended environment variables for your own app:

| Env Variable | Description | Default |
|---|---|---|
| `GDEX_API_URL` | Backend base URL to pass as `apiUrl` | `https://trade-api.gemach.io/v1` |
| `GDEX_API_KEY` | API key for AES encryption in managed-custody flow | — |
| `GDEX_TIMEOUT` | Request timeout (ms) to pass as `timeout` | `30000` |
| `GDEX_MAX_RETRIES` | Retry attempts to pass as `maxRetries` | `3` |
| `GDEX_DEBUG` | Enable debug logging to pass as `debug` | `false` |
| `GDEX_CONTROL_WALLET` | Control wallet address (userId) for managed custody | — |
| `GDEX_SESSION_PRIVATE` | Session private key (hex, 0x-prefixed) for managed custody | — |
| `GDEX_MANAGED_CHAIN_ID` | Chain ID for managed trades (900=Solana, 101=Sui) | `900` |
| `CONFIRM_LIVE_TRADE` | Set to `YES` to submit real trades | — |

---

## 🔒 Managed-Custody Trading

All trading on GDEX goes through **server-side managed wallets**. Your control wallet (EVM or Solana) is only used to authenticate (sign-in) — actual on-chain execution is handled by GDEX backend trade workers.

### How It Works

1. **Generate a session keypair** — secp256k1 key used to sign trades after auth
2. **Sign-in** — control wallet signs a message, encrypted as `computedData` → POST `/v1/sign_in`
3. **Resolve user** — GET `/v1/user` with encrypted session key to see managed wallets
4. **Trade** — ABI-encode trade data, sign with session key, encrypt as `computedData` → POST `/v1/purchase_v2` or `/v1/sell_v2`
5. **Poll status** — GET `/v1/trade-status/:requestId` until completed/failed

### Encryption

All authenticated payloads use **AES-256-CBC** derived from the API key:
- Key = first 32 bytes of `SHA256(apiKey)` hex
- IV = first 16 bytes of `SHA256(SHA256(apiKey))` hex
- Inner payload: `JSON.stringify({ userId, data, signature })`

### Quick Example

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

// 1. Session keypair
const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();

// 2. Sign-in (control wallet signs this message)
const userId = '0xYourControlWallet';
const nonce = String(Date.now());
const message = buildGdexSignInMessage(userId, nonce, sessionKey);
const signature = /* wallet.signMessage(message) */;

const signInPayload = buildGdexSignInComputedData({ apiKey, userId, sessionKey, nonce, signature });
await skill.signInWithComputedData({ computedData: signInPayload.computedData, chainId: 900 });

// 3. Trade
const trade = buildGdexManagedTradeComputedData({
  apiKey, action: 'purchase', userId,
  tokenAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  amount: '100000', nonce: String(Date.now()), sessionPrivateKey,
});
const result = await skill.submitManagedPurchase({
  computedData: trade.computedData, chainId: 900, slippage: 1,
});

// 4. Poll
if (result.requestId) {
  const status = await skill.getManagedTradeStatus(result.requestId);
  console.log(status.status, status.hash);
}
```

### Managed-Custody Helpers

| Function | Purpose |
|---|---|
| `generateGdexSessionKeyPair()` | Generate secp256k1 session keypair |
| `buildGdexSignInMessage(userId, nonce, sessionKey)` | Build the sign-in message for wallet signing |
| `encodeGdexSignInData(sessionKey, nonce, refCode?)` | ABI-encode sign-in data |
| `buildGdexSignInComputedData({...})` | Build encrypted sign-in payload |
| `buildGdexUserSessionData(sessionKey, apiKey)` | Encrypt session key for `/v1/user` |
| `encodeGdexTradeData(tokenAddr, amount, extra?)` | ABI-encode trade data |
| `signGdexTradeMessageWithSessionKey(action, userId, data, privKey)` | Sign trade with session key |
| `buildGdexManagedTradeComputedData({...})` | Build encrypted trade payload |
| `encryptGdexComputedData(plaintext, apiKey)` | Generic AES encryption |
| `decryptGdexComputedData(cipherHex, apiKey)` | Generic AES decryption |
| `deriveGdexAesMaterial(apiKey)` | Get raw AES key/IV from API key |

### Verify Managed Flow (offline)

```bash
npm run verify:managed
```

This generates all payloads (session keypair, sign-in, user lookup, trade), validates encrypt/decrypt roundtrips, and prints the full execution plan — without making any live API calls.

---

## 📚 API Reference

### Spot Trading

#### `buyToken(params)`

Buy a token on any supported chain.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `chain` | `string \| ChainId` | ✅ | Chain name or numeric ID |
| `tokenAddress` | `string` | ✅ | Token contract address |
| `amount` | `string` | ✅ | Native token input amount |
| `slippage` | `number` | | Max slippage % (default: 1) |
| `dex` | `string` | | Force specific DEX |
| `walletAddress` | `string` | | Override wallet address |
| `priorityFee` | `number` | | Solana priority fee (lamports) |

```typescript
const result = await skill.buyToken({
  chain: 'solana',
  tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount: '0.1',
  slippage: 1,
});
// result.jobId, result.status, result.txHash, result.outputAmount
```

#### `sellToken(params)`

```typescript
// Sell absolute amount
await skill.sellToken({ chain: 8453, tokenAddress: '0x...', amount: '100', slippage: 0.5 });

// Sell 50% of holdings
await skill.sellToken({ chain: 'solana', tokenAddress: '...', amount: '50%' });
```

---

### Perpetual Futures (HyperLiquid)

#### `openPerpPosition(params)`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `coin` | `string` | | Asset symbol (e.g., `'BTC'`, `'ETH'`) |
| `side` | `'long' \| 'short'` | | Direction |
| `sizeUsd` | `string` | | Collateral in USD |
| `leverage` | `number` | `5` | 1–50× |
| `takeProfitPrice` | `string` | | Optional TP price |
| `stopLossPrice` | `string` | | Optional SL price |
| `marginMode` | `'cross' \| 'isolated'` | `'cross'` | Margin mode |

```typescript
const pos = await skill.openPerpPosition({
  coin: 'BTC', side: 'long', sizeUsd: '1000', leverage: 10,
  takeProfitPrice: '110000', stopLossPrice: '95000',
});
```

#### `closePerpPosition(params)`

```typescript
await skill.closePerpPosition({ coin: 'BTC' });                  // close 100%
await skill.closePerpPosition({ coin: 'ETH', closePercent: 50 }); // close 50%
```

#### Other perp methods

```typescript
await skill.setPerpLeverage({ coin: 'BTC', leverage: 20 });
await skill.perpDeposit({ amount: '1000' });   // deposit $1000 USDC
await skill.perpWithdraw({ amount: '500' });   // withdraw $500 USDC

const positions = await skill.getPerpPositions({ walletAddress: '0x...' });
// Each: { coin, side, size, entryPrice, markPrice, leverage, unrealizedPnl, liquidationPrice }
```

---

### Limit Orders

```typescript
// Create
const order = await skill.createLimitOrder({
  chain: 'solana',
  side: 'buy',
  inputToken: 'So11111111111111111111111111111111111111112',    // SOL
  outputToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  inputAmount: '1',
  limitPrice: '160',  // trigger when 1 SOL = 160 USDC
  slippage: 1,
  expireIn: 86400,    // 24 hours
});

// Cancel
await skill.cancelLimitOrder({ orderId: order.id, chain: 'solana' });

// List
const orders = await skill.getLimitOrders({ walletAddress: '...', chain: 'solana', status: 'open' });
```

---

### Copy Trading

```typescript
// Add a wallet to copy
await skill.addCopyTradeWallet({ walletAddress: 'TopTraderAddress', chain: 'solana', label: 'Alpha' });

// Configure settings
await skill.setCopyTradeSettings({
  enabled: true,
  maxTradeSize: '100',       // max $100 per copied trade
  slippage: 1,
  copyBuysOnly: false,
  autoStopLossPercent: 10,   // SL at 10% loss
});

const wallets = await skill.getCopyTradeWallets('userId');
await skill.removeCopyTradeWallet({ walletAddress: 'TopTraderAddress', chain: 'solana' });
```

---

### Portfolio

```typescript
// Full cross-chain portfolio
const portfolio = await skill.getPortfolio({ walletAddress: '0x...' });
// { totalValueUsd, balances, perpPositions?, realizedPnl, unrealizedPnl }

// Chain-specific balances
const balances = await skill.getBalances({ walletAddress: '0x...', chain: ChainId.ETHEREUM });

// Paginated trade history
const history = await skill.getTradeHistory({
  walletAddress: '0x...', page: 1, limit: 20,
  startTime: 1700000000, endTime: 1700086400,
});
```

---

### Token Information

> 🔓 No authentication required for these endpoints.

```typescript
// Token details
const token = await skill.getTokenDetails({
  tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  chain: 'solana',
});
// { symbol, name, priceUsd, priceChange24h, marketCap, fdv, volume24h, liquidity }

// Trending tokens
const trending = await skill.getTrendingTokens({
  chain: 'solana',
  period: '24h',     // '1h' | '6h' | '24h' | '7d'
  limit: 20,
  minLiquidity: 50000,
});

// OHLCV candles
const ohlcv = await skill.getOHLCV({
  tokenAddress: 'So11111111111111111111111111111111111111112',
  chain: 'solana',
  resolution: '60',  // '1'|'5'|'15'|'30'|'60'|'240'|'D'|'W'
  from: Math.floor(Date.now() / 1000) - 86400,
  to: Math.floor(Date.now() / 1000),
});
```

---

### Top Traders

> 🔓 No authentication required.

```typescript
const traders = await skill.getTopTraders({
  chain: 'solana',
  period: '7d',    // '1d' | '7d' | '30d' | 'all'
  limit: 10,
  sortBy: 'pnl',   // 'pnl' | 'winRate' | 'volume' | 'tradeCount'
});
// [{ address, totalPnlUsd, winRate, tradeCount, totalVolumeUsd }]
```

---

### Bridge

```typescript
// Get quote first
const quote = await skill.getBridgeQuote({
  fromChain: 'solana',
  toChain: ChainId.ETHEREUM,
  tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount: '100',
});
console.log('Output:', quote.outputAmount, '— fee (USD):', quote.feeUsd);

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
const info = await skill.getWalletInfo({ walletAddress: '...', chain: 'solana' });
// { address, nativeBalance, nativeSymbol, totalValueUsd, tokenCount }
```

---

### Wallet Generation

> 🔓 No authentication required. Keys are generated **locally** and never transmitted.

When a user doesn't have a wallet yet, generate an EVM **control wallet** for them. Then use the managed-custody sign-in flow to authenticate, and the Gbot backend automatically provisions a full trading wallet — including a Solana address and other chain-specific keys — server-side. No separate Solana wallet generation is needed.

#### `generateEvmWallet()` — your control wallet

Generates a new EVM-compatible wallet (Ethereum, Base, Arbitrum, BSC, etc.) using `ethers.Wallet.createRandom()`.

```typescript
import {
  GdexSkill,
  generateEvmWallet,
  generateGdexSessionKeyPair,
  buildGdexSignInMessage,
  GDEX_API_KEY_PRIMARY,
} from '@gdexsdk/gdex-skill';

// Step 1: generate your EVM control wallet (one-time setup)
const wallet = generateEvmWallet();
console.log(wallet.address);  // '0xAbCd...' (checksummed) — safe to share
// ⚠️  Store wallet.privateKey and wallet.mnemonic securely

// Step 2: generate a session keypair for managed-custody trading
const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();

// Step 3: build the sign-in message and sign with your control wallet
const message = buildGdexSignInMessage(wallet.address, String(Date.now()), sessionKey);
// Sign with: new ethers.Wallet(wallet.privateKey).signMessage(message)

// Step 4: submit sign_in computedData (see Managed-Custody Trading section above)
// The backend provisions Solana + all other trading wallets server-side
```

---

## 🌐 Supported Chains

| Chain | Identifier | Native Token | DEXes |
|---|---|---|---|
| **Solana** | `'solana'` | SOL | Raydium, Raydium V2, Orca |
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
| **HyperLiquid** | perps only | USDC | Native perp engine |

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

---

## ⚠️ Error Handling

```typescript
import {
  GdexAuthError,       // 401/403 — re-authenticate
  GdexValidationError, // invalid input params
  GdexApiError,        // 4xx/5xx backend errors
  GdexNetworkError,    // connection failures, timeouts
  GdexRateLimitError,  // 429 — check err.retryAfter
} from '@gdexsdk/gdex-skill';

try {
  await skill.buyToken({ ... });
} catch (err) {
  if (err instanceof GdexRateLimitError) {
    console.log(`Rate limited — retry after ${err.retryAfter}s`);
    await new Promise(r => setTimeout(r, err.retryAfter * 1000));
    // retry…
  } else if (err instanceof GdexAuthError) {
    skill.loginWithApiKey(GDEX_API_KEY_PRIMARY); // re-auth
  } else if (err instanceof GdexValidationError) {
    console.error(`Bad param "${err.field}": ${err.message}`);
  } else if (err instanceof GdexApiError) {
    console.error(`API ${err.statusCode}: ${err.message}`);
  } else if (err instanceof GdexNetworkError) {
    console.error(`Network (${err.code}): ${err.message}`);
  }
}
```

| Class | When thrown |
|---|---|
| `GdexAuthError` | 401/403, invalid credentials |
| `GdexValidationError` | Invalid address, amount, chain, slippage |
| `GdexApiError` | Non-success HTTP (4xx/5xx) |
| `GdexNetworkError` | Connection refused, ECONNABORTED, timeout |
| `GdexRateLimitError` | HTTP 429 (has `.retryAfter` in seconds) |

---

## 🛠 Utility Functions

```typescript
import {
  getChainName,         // getChainName(8453)        → "Base"
  getNativeToken,       // getNativeToken('solana')   → "SOL"
  formatTokenAmount,    // formatTokenAmount('1000000', 6, 'USDC') → "1 USDC"
  formatUsd,            // formatUsd('1234.5')         → "$1,234.50"
  formatPercentChange,  // formatPercentChange('5.23') → "+5.23%"
  shortenAddress,       // shortenAddress('0x1234...') → "0x1234...5678"
  validateAddress,      // throws GdexValidationError if invalid
  validateAmount,       // throws GdexValidationError if invalid
  validateChain,        // throws GdexValidationError if unsupported
} from '@gdexsdk/gdex-skill';
```

---

## 🧪 Testing

All 80 tests run with **mocked HTTP** — no real API key or network connection required:

```bash
npm test              # run all 80 tests
npm run test:coverage # with coverage report
npm run verify        # offline SDK smoke-test (20 checks)
npm run verify:managed # managed-custody payload validation (dry-run)
```

Test suites:
- `tests/client/auth.test.ts` — API key auth, EVM/Solana wallet signing
- `tests/actions/spotTrade.test.ts` — buy/sell, slippage, validation
- `tests/actions/perpTrade.test.ts` — open/close positions, leverage, deposits
- `tests/actions/portfolio.test.ts` — balances, history, wallet info
- `tests/actions/tokenInfo.test.ts` — trending, OHLCV, token details, top traders
- `tests/utils/walletGeneration.test.ts` — EVM control wallet generation (offline)
- `tests/utils/gdexManagedCrypto.test.ts` — managed-custody crypto helpers (AES, signing, ABI encoding)

---

## 🏗 Architecture

```
AI Agent (Claude Code / Cursor / Codex / ...)
   │
   │  npx skills add GemachDAO/gdex-skill
   │  ──────────────────────────────────
   │  SKILL.md → agent skill directory
   │
   ▼
@gdexsdk/gdex-skill  (this package)
   │  TypeScript methods with full type safety
   │  Managed-custody: AES-256-CBC encryption + secp256k1 session signing
   │  computedData payloads for all trade operations
   │  Auto-retry with exponential backoff
   │
   │  Control Wallet (EVM / Solana)
   │  └─ signs once for /v1/sign_in → session keypair
   │
   ▼
Gbot Backend API  (https://trade-api.gemach.io/v1)
   │  Decrypt computedData → verify signature → resolve nonce (gRPC)
   │  NATS JetStream trade queue
   │  Server-side managed wallets (custody)
   │  DEX aggregation engine
   ▼
Blockchains  (Solana · Sui · Ethereum · Base · Arbitrum · …)
```

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Run `npm test && npm run build && npm run verify`
5. Submit a pull request

## License

MIT © [GemachDAO](https://github.com/GemachDAO)
