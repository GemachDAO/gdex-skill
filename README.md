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
[![Tests](https://img.shields.io/badge/tests-91%20passing-22C55E.svg?style=for-the-badge)](#testing)

</div>

---

## Table of Contents

- [Install as an Agent Skill](#-install-as-an-agent-skill)
- [MCP Server](#-mcp-server)
- [SDK Installation](#-sdk-installation)
- [Quick Start](#-quick-start)
- [Verify (offline)](#-verify-offline)
- [Authentication](#-authentication)
- [API Reference](#-api-reference)
  - [Spot Trading](#spot-trading)
  - [Perpetual Futures](#perpetual-futures-hyperliquid)
  - [Limit Orders](#limit-orders)
  - [Copy Trading](#copy-trading)
  - [HL Perp Copy Trading](#hl-perp-copy-trading)
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
# Install all skills (recommended)
npx skills add GemachDAO/gdex-skill --all --agent '*' -g

# Install just the root routing skill
npx skills add GemachDAO/gdex-skill

# Install a specific skill
npx skills add GemachDAO/gdex-skill --skill gdex-spot-trading
```

GDEX uses a **multi-skill architecture** — agents load only the skills they need, keeping context lean and focused.

### Available Skills

| Skill | Description |
|-------|-------------|
| `gdex-onboarding` | Platform overview, architecture, supported chains, quickstart |
| `gdex-authentication` | Managed-custody auth, encryption, session keys, API key login |
| `gdex-spot-trading` | Buy/sell tokens on any chain with DEX routing |
| `gdex-perp-trading` | HyperLiquid perpetual futures — positions, orders, leverage |
| `gdex-perp-funding` | Deposit/withdraw USDC to/from HyperLiquid |
| `gdex-limit-orders` | Create, cancel, and list limit orders |
| `gdex-portfolio` | Cross-chain portfolio, balances, trade history |
| `gdex-token-discovery` | Token details, trending tokens, OHLCV charts (no auth) |
| `gdex-copy-trading` | Copy trade create/delete, leaderboards, tx history, DEX list (Solana only for writes) |
| `gdex-perp-copy-trading` | HL perp copy trading — top traders, create/manage configs, market data |
| `gdex-bridge` | Cross-chain bridging with quotes |
| `gdex-wallet-setup` | Generate EVM wallets, session keys, wallet info (no auth) |
| `gdex-ui-install-setup` | React/Next.js project setup, SDK context providers, environment variables |
| `gdex-ui-trading-components` | React component patterns for order forms, position tables, copy trade panels |
| `gdex-ui-portfolio-dashboard` | Portfolio dashboard components — balances, trade history, chain selectors |
| `gdex-ui-wallet-connection` | Wallet connection UI — connect buttons, auth state, chain switching |
| `gdex-ui-theming` | CSS theming — dark/light mode, trading colors, responsive breakpoints, Tailwind |
| `gdex-ui-page-layouts` | Full page compositions — trading, portfolio, copy trading, bridge pages |
| `gdex-sdk-debugging` | Troubleshoot errors — error codes, encryption debugging, chain quirks, HL gotchas |

The root `SKILL.md` acts as a router — it tells agents which skill to load for any given task. **No API key setup required** (shared keys are built in).

---

## � MCP Server

The GDEX MCP server exposes SDK documentation and code patterns as [Model Context Protocol](https://modelcontextprotocol.io) tools. Any MCP-compatible AI client can use it.

### Quick Setup

```bash
# Auto-generate config for your AI client
npx @gdexsdk/mcp-server init --client claude   # → .mcp.json
npx @gdexsdk/mcp-server init --client cursor   # → .cursor/mcp.json
npx @gdexsdk/mcp-server init --client vscode   # → .vscode/mcp.json
npx @gdexsdk/mcp-server init --client codex    # → .codex/config.toml
npx @gdexsdk/mcp-server init --client opencode  # → .opencode/mcp.json
```

### Manual Config

Add to your client's MCP config:

```json
{
  "mcpServers": {
    "gdex-mcp-server": {
      "command": "npx",
      "args": ["@gdexsdk/mcp-server"]
    }
  }
}
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `search_gdex_docs` | Search documentation by keyword |
| `get_sdk_pattern` | TypeScript code patterns by operation |
| `get_api_info` | API endpoint details (URL, method, params) |
| `explain_workflow` | Step-by-step trading workflows |
| `get_chain_info` | Supported chains and capabilities |
| `get_trading_guide` | Spot, perp, or limit trading guides |
| `get_copy_trade_guide` | Copy trading guides (Solana / HL) |
| `get_component_guide` | React UI component patterns |

---

## �📦 SDK Installation

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
| `GDEX_MANAGED_CHAIN_ID` | Chain ID for managed trades (622112261=Solana, 42161=Arbitrum for perps) | `622112261` |
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

All authenticated payloads use **AES-256-CBC** with a **deterministic** key/IV derived from the API key (no random IV):
- Key = first 32 bytes of `SHA256(apiKey)` hex
- IV = first 16 bytes of `SHA256(SHA256(apiKey))` hex
- Trade/sign-in payloads: `JSON.stringify({ userId, data, signature, apiKey })` → UTF-8 → encrypt → hex
- Session key (`/v1/user`): hex-decoded raw bytes → encrypt (not UTF-8 string)
- The API key is included inside the encrypted JSON payload (not just used for encryption)

> **WARNING:** Do NOT use random IVs or the `iv:ciphertext` format. The backend uses deterministic AES derived from the API key hash chain.

### Signatures

**Spot trade signatures** (purchase/sell) use **raw keccak256 + secp256k1** (no EIP-191 prefix):
- Message: `"<action>-<lowercaseUserId>-<dataHexWithout0x>"`
- Digest: `keccak256(utf8Bytes(message))`
- Output: `r(64 hex) + s(64 hex) + v(2 hex)` = 130 chars, no `0x` prefix
- **v = raw recovery parameter** (`00` or `01`), NOT EIP-155 (`1b`/`1c`)

**HL perp signatures** use the same algorithm but with HL-specific action prefixes (`hl_deposit`, `hl_withdraw`, `hl_create_order`, etc.) and different ABI schemas. See the [HL Managed-Custody Reference](#hl-managed-custody-reference) section.

**Sign-in signatures** use EIP-191 `personal_sign` with the control wallet — this is the ONLY operation that uses EIP-191. All post-sign-in operations use raw keccak256.

### Nonce Generation

Nonces are **client-generated** (not fetched from the server):
```typescript
const nonce = String(Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000));
```

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
const nonce = String(Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000));
const message = buildGdexSignInMessage(userId, nonce, sessionKey);
const signature = /* wallet.signMessage(message) */;

const signInPayload = buildGdexSignInComputedData({ apiKey, userId, sessionKey, nonce, signature });
await skill.signInWithComputedData({ computedData: signInPayload.computedData, chainId: 900 });

// 3. Trade
const trade = buildGdexManagedTradeComputedData({
  apiKey, action: 'purchase', userId,
  tokenAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  amount: '100000',
  nonce: String(Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000)),
  sessionPrivateKey,
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
| `encodeGdexSignInData(sessionKey, nonce, refCode?)` | ABI-encode sign-in data (`['bytes','string','string']`) |
| `buildGdexSignInComputedData({...})` | Build encrypted sign-in payload |
| `buildGdexUserSessionData(sessionKey, apiKey)` | Encrypt session key (raw hex bytes) for `/v1/user` |
| `encodeGdexTradeData(tokenAddr, amount, nonce?)` | ABI-encode trade data (`['string','uint256','string']`) |
| `signGdexTradeMessageWithSessionKey(action, userId, data, privKey)` | Sign trade with session key (v = raw recoveryParam `00`/`01`) |
| `buildGdexManagedTradeComputedData({...})` | Build encrypted trade payload |
| `encodeLimitOrderData(action, params)` | ABI-encode limit order data (buy/sell/update schemas) |
| `signLimitOrderMessage(action, userId, data, privKey)` | Sign limit order with session key |
| `buildLimitOrderComputedData({...})` | Build encrypted limit order payload |
| `encodeCopyTradeData(action, params)` | ABI-encode copy trade data (create: 12 fields, update: 16 fields, chainId is `uint256`) |
| `signCopyTradeMessage(action, userId, data, privKey)` | Sign copy trade with session key |
| `buildCopyTradeComputedData({...})` | Build encrypted copy trade payload |
| `buildEncryptedGdexPayload({...})` | Encrypt JSON `{userId, data, signature}` for `computedData` |
| `encryptGdexComputedData(plaintext, apiKey)` | AES-256-CBC encrypt UTF-8 plaintext |
| `encryptGdexHexData(hexData, apiKey)` | AES-256-CBC encrypt raw hex-decoded bytes |
| `decryptGdexComputedData(cipherHex, apiKey)` | AES-256-CBC decrypt to UTF-8 plaintext |
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

> **Critical: HyperLiquid deposits/withdrawals/orders use a different crypto flow than spot trades.** See the [HL Managed-Custody Reference](#hl-managed-custody-reference) section below for exact specifications.

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

// Update leverage via HL managed-custody (explicit session-key signing)
await skill.hlUpdateLeverage({
  coin: 'BTC',
  leverage: 40,
  isCross: true,    // true = cross margin, false = isolated (default: true)
  apiKey,
  walletAddress,
  sessionPrivateKey,
});

// Deposit USDC to HyperLiquid (human-readable amount, converted internally)
await skill.perpDeposit({ amount: '10' });   // deposit 10 USDC (minimum)
await skill.perpWithdraw({ amount: '5' });    // withdraw 5 USDC

const positions = await skill.getPerpPositions({ walletAddress: '0x...' });
// Each: { coin, side, size, entryPrice, markPrice, leverage, unrealizedPnl, liquidationPrice }
```

> **HL Deposit notes:** Amount is in human-readable USDC (e.g., `'10'` for 10 USDC). The SDK automatically converts to smallest unit (6 decimals). Minimum deposit is 10 USDC. Your managed wallet must have the deposit amount + 1% fee buffer in USDC on Arbitrum. After the on-chain tx confirms, HyperLiquid takes ~10 minutes to credit the deposit.

---

### Limit Orders

> **Endpoints: `limit_buy` / `limit_sell` / `update_order` / `orders` — NOT `orders/create` or `orders/cancel`.**

```typescript
// Limit buy — buy WIF when price drops to $0.50 on Solana
const buyResult = await skill.limitBuy({
  apiKey: GDEX_API_KEY_PRIMARY,
  userId: '0x53D029a671bd1CF61a2fB1F4F6e4bD830BFBb2eD',  // control wallet
  sessionPrivateKey: '<session-key-hex>',
  chainId: 622112261,           // Solana
  tokenAddress: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  amount: '10000000',           // lamports
  triggerPrice: '0.50',
  profitPercent: '50',          // optional: TP at 50% gain
  lossPercent: '25',            // optional: SL at 25% loss
});

// Limit sell — sell WIF when price reaches $999.99 (take-profit)
const sellResult = await skill.limitSell({
  apiKey: GDEX_API_KEY_PRIMARY,
  userId: '0x53D029a671bd1CF61a2fB1F4F6e4bD830BFBb2eD',
  sessionPrivateKey: '<session-key-hex>',
  chainId: 622112261,
  tokenAddress: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  amount: '100000',
  triggerPrice: '999.99',
});

// Delete/cancel an order
await skill.updateOrder({
  apiKey: GDEX_API_KEY_PRIMARY,
  userId: '0x53D029a671bd1CF61a2fB1F4F6e4bD830BFBb2eD',
  sessionPrivateKey: '<session-key-hex>',
  chainId: 622112261,
  orderId: '<64-char-hex-order-id>',
  isDelete: true,
});

// List active orders (uses session-key auth, not full computedData)
const { count, orders } = await skill.getLimitOrders({
  userId: '0x53D029a671bd1CF61a2fB1F4F6e4bD830BFBb2eD',
  data: encryptedSessionKey,  // from buildGdexUserSessionData()
  chainId: 622112261,
});
```

---

### Copy Trading

> **Solana-only for write operations.** Sign-in must use `chainId: 622112261`. The ABI encodes `chainId` as `uint256`.

#### Discovery (no auth)

```typescript
// Top 300 wallets by total PnL (cached 2 min)
const topWallets = await skill.getCopyTradeWallets();
// [{ address, totalPnl, receivedMinusSpent, spent, unrealizedValue, chainId }]

// Top 300 by net received
const customWallets = await skill.getCopyTradeCustomWallets();

// Hot new tokens from top wallets (cached 20s)
const gems = await skill.getCopyTradeGems();

// Supported DEXes for Solana
const dexes = await skill.getCopyTradeDexes(622112261);
// [{ dexName: 'pumpfun', dexNumber: 0, programId: '...' }, ...]
```

#### Read (session-key auth)

```typescript
import { buildGdexUserSessionData } from '@gdexsdk/gdex-skill';

const data = buildGdexUserSessionData(sessionKey, apiKey);

// List copy trade configs (cached 20s per user)
const { allCopyTrades, dexes } = await skill.getCopyTradeList({ userId, data });
// allCopyTrades: [{ copyTradeId, copyTradeName, traderWallet, isActive, lossPercent, profitPercent, ... }]

// Transaction history with PnL
const { txes } = await skill.getCopyTradeTxList({ userId, data });
```

#### Create (computedData auth)

```typescript
import {
  GDEX_API_KEY_PRIMARY,
  buildCopyTradeComputedData,
  generateGdexSessionKeyPair,
  buildGdexSignInMessage,
  buildGdexSignInComputedData,
} from '@gdexsdk/gdex-skill';

// Sign-in MUST use chainId: 622112261 for copy trade operations
const result = await skill.createCopyTrade({
  apiKey: GDEX_API_KEY_PRIMARY,
  userId: controlWalletAddress,
  sessionPrivateKey,
  chainId: 622112261,                // Solana only
  traderWallet: 'SolanaTraderAddress',
  copyTradeName: 'Alpha Trader',
  buyMode: 1,                        // 1 = fixed SOL, 2 = percentage
  copyBuyAmount: '0.001',            // SOL amount (mode 1) or percentage (mode 2)
  lossPercent: '50',                 // stop-loss at 50%
  profitPercent: '100',              // take-profit at 100%
  copySell: true,                    // also copy sell trades
  isBuyExistingToken: false,         // skip tokens already held
  excludedDexNumbers: [],            // no DEX exclusions
});
// { isSuccess: true, message: 'created new copy trade successfully', allCopyTrades: [...] }
```

#### Delete (computedData auth)

```typescript
// Delete a copy trade (isDelete: true)
const deleteResult = await skill.updateCopyTrade({
  apiKey: GDEX_API_KEY_PRIMARY,
  userId: controlWalletAddress,
  sessionPrivateKey,
  chainId: 622112261,
  copyTradeId: '<64-char-hex-id>',
  traderWallet: 'SolanaTraderAddress',
  copyTradeName: 'Alpha Trader',
  buyMode: 1,
  copyBuyAmount: '0.001',
  lossPercent: '50',
  profitPercent: '100',
  isDelete: true,                    // permanently deletes the copy trade
});
// { isSuccess: true, message: 'Updated' }
```

> **WARNING:** Both `isDelete: true` and `isChangeStatus: true` permanently delete the copy trade.
> There is no toggle/pause functionality on the current backend. Boolean fields use `''` for false
> and `'1'` for true internally; string `'0'` is truthy in JS and will trigger deletion.

#### Copy Trade ABI Reference

| Action | Fields | ABI Types |
|---|---|---|
| `create_copy_trade` | 12 | `['string','string','uint256','string'×9]` |
| `update_copy_trade` | 16 | `['string','string','uint256','string'×13]` |

**Create field order:** `[traderWallet, copyTradeName, chainId, gasPrice, buyMode, copyBuyAmount, isBuyExistingToken, lossPercent, profitPercent, nonce, copySell, excludedDexNumbers]`

**Update field order:** `[traderWallet, copyTradeName, chainId, gasPrice, buyMode, copyBuyAmount, isBuyExistingToken, lossPercent, profitPercent, nonce, copySell, excludedDexNumbers, copyTradeId, isDelete, isChangeStatus, excludedProgramIds]`

> `chainId` at position 2 is `uint256`, all other fields are `string`. Nonce is auto-generated by the SDK.

---

### HL Perp Copy Trading

> **Completely separate from Solana copy trading above.** This copies perpetual futures positions (long/short) on HyperLiquid. Sign-in uses `chainId: 1`. All ABI fields are strings.

#### Discovery (no auth)

```typescript
// Top traders by volume/tradeCount/deposit (cached 15 min)
const topByVolume = await skill.getHlTopTraders('volume');
const topByPnl = await skill.getHlTopTradersByPnl();

// Detailed trader stats (cached 1 hr)
// NOTE: Requires MANAGED wallet address, not control wallet
const stats = await skill.getHlUserStats('0xManagedWalletAddress');
// { userStats: { '24h', '7d', '30d', dailyPnls, volumes, tradesCount, allTime } }

// Market data
const dexes = await skill.getHlPerpDexes();
const assets = await skill.getHlAllAssets();
const tokens = await skill.getHlDepositTokens();

// Account state
const state = await skill.getHlClearinghouseState('0xAddress');
const orders = await skill.getHlOpenOrdersForCopy('0xAddress');
const balance = await skill.getHlUsdcBalanceForCopy('0xAddress');
```

#### Read (session-key auth)

```typescript
import { buildGdexUserSessionData } from '@gdexsdk/gdex-skill';

const data = buildGdexUserSessionData(sessionKey, apiKey);

// List HL copy trade configs
const { allCopyTrades } = await skill.getHlCopyTradeList({ userId, data });
// [{ copyTradeId, copyTradeName, copyMode, traderWallet, isActive, oppositeCopy, totalPnl, ... }]

// Fill history (cached 15s, max 100 per page)
const { txes, totalCount } = await skill.getHlCopyTradeTxList({ userId, data, page: '1', limit: '20' });
// [{ coin, px, sz, side, dir, closedPnl, copyTradeName, traderWallet, ... }]
```

#### Create (computedData auth)

```typescript
await skill.createHlCopyTrade({
  apiKey,
  userId: controlWalletAddress,
  sessionPrivateKey,
  traderWallet: '0xTraderEvmAddress',
  copyTradeName: 'BTC Whale',
  copyMode: 1,                    // 1 = fixed USD, 2 = proportion
  fixedAmountCostPerOrder: '50',  // $50 per copied trade
  lossPercent: '25',              // mandatory, > 0 and < 100
  profitPercent: '100',           // mandatory, > 0
  oppositeCopy: false,            // true = copy opposite direction
});
```

#### Update / Delete (computedData auth)

```typescript
// Update parameters
await skill.updateHlCopyTrade({
  apiKey, userId: controlWalletAddress, sessionPrivateKey,
  copyTradeId: 'abc123...',
  traderWallet: '0xTraderEvmAddress',
  copyTradeName: 'Updated Name',
  copyMode: 2, fixedAmountCostPerOrder: '0.5',
  lossPercent: '30', profitPercent: '150',
  oppositeCopy: true,
});

// Delete permanently (use isDelete)
await skill.updateHlCopyTrade({ ...existingParams, isDelete: true });

// WARNING: isChangeStatus also PERMANENTLY DELETES (does NOT toggle)
await skill.updateHlCopyTrade({ ...existingParams, isChangeStatus: true });
```

#### HL Perp Copy Trade ABI Reference

| Action | Fields | ABI Types |
|---|---|---|
| `hl_create` | 8 | `['string' × 8]` |
| `hl_update` | 11 | `['string' × 11]` |

**Create field order:** `[traderWallet, copyTradeName, copyMode, fixedAmountCostPerOrder, lossPercent, profitPercent, nonce, oppositeCopy]`

**Update field order:** `[traderWallet, copyTradeName, copyMode, fixedAmountCostPerOrder, lossPercent, profitPercent, nonce, isDelete, isChangeStatus, copyTradeId, oppositeCopy]`

> All fields are `string`. Boolean fields: `'1'` = true, `''` = false. Nonce auto-generated by SDK.
> **Note:** `copyMode` and `oppositeCopy` in responses contain ABI byte-offsets (e.g., 416), not actual values. Both `isDelete` and `isChangeStatus` permanently delete the trade.

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

| Chain | ChainId | Native Token | DEXes |
|---|---|---|---|
| **Ethereum** | `1` | ETH | Uniswap V2/V3, Odos |
| **Optimism** | `10` | ETH | Uniswap V3, Odos |
| **BNB Smart Chain** | `56` | BNB | PancakeSwap, Odos |
| **Sonic** | `146` | S | — |
| **Fraxtal** | `252` | frxETH | Uniswap V3 |
| **Nibiru** | `6900` | NIBI | — |
| **Base** | `8453` | ETH | Uniswap V3, Odos, Arcadia |
| **Arbitrum One** | `42161` | ETH | Uniswap V3, Odos |
| **Berachain** | `80094` | BERA | — |
| **Solana** | `622112261` | SOL | Raydium, Raydium V2, Orca |
| **Sui** | `1313131213` | SUI | Cetus, Bluefin |
| **HyperLiquid** | perps only | USDC | Native perp engine |

```typescript
import { ChainId } from '@gdexsdk/gdex-skill';

ChainId.ETHEREUM   // 1
ChainId.OPTIMISM   // 10
ChainId.BSC        // 56
ChainId.SONIC      // 146
ChainId.FRAXTAL    // 252
ChainId.NIBIRU     // 6900
ChainId.BASE       // 8453
ChainId.ARBITRUM   // 42161
ChainId.BERACHAIN  // 80094
ChainId.SOLANA     // 622112261
ChainId.SUI        // 1313131213
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

All 91 tests run with **mocked HTTP** — no real API key or network connection required:

```bash
npm test              # run all 91 tests
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

## HL Managed-Custody Reference

HyperLiquid perp operations use a **distinct crypto pipeline** from spot trades. Getting any detail wrong produces a `400 Unauthorized (code 103)` error. This section documents the exact specification.

### HL Deposit Flow

The backend custodially executes the on-chain deposit: it loads the user's server-side private key, constructs an Arbitrum transaction, and sends USDC to the HyperLiquid bridge receiver. The agent only provides an authorization signature.

```
Agent SDK                              Backend
────────                               ───────
1. ABI-encode deposit params     ──►   2. AES-decrypt computedData
   (uint64 chainId, address,           3. ABI-decode data
    uint256 amount, string nonce)       4. Verify chainId == 42161
2. Sign with session key          ──►  5. Verify signature vs stored sessionKey
3. AES-encrypt as computedData    ──►  6. Validate token, balance, min deposit
4. POST /v1/hl/deposit                 7. Execute ERC-20 transfer on Arbitrum
```

### HL ABI Schemas (CRITICAL)

| Action | ABI Types | Fields |
|---|---|---|
| `hl_deposit` | `['uint64', 'address', 'uint256', 'string']` | `[chainId, tokenAddress, amount, nonce]` |
| `hl_withdraw` | `['string', 'string']` | `[amount, nonce]` |
| `hl_create_order` | `['string', 'bool', 'string', 'string', 'bool', 'string', 'string', 'string', 'bool']` | `[coin, isLong, price, size, reduceOnly, nonce, tpPrice, slPrice, isMarket]` |
| `hl_place_order` | `['string', 'bool', 'string', 'string', 'bool', 'string']` | `[coin, isLong, price, size, reduceOnly, nonce]` |
| `hl_close_all` | `['string']` | `[nonce]` |
| `hl_cancel_order` | `['string', 'string', 'string']` | `[nonce, coin, orderId]` |
| `hl_cancel_all_orders` | `['string']` | `[nonce]` |
| `hl_update_leverage` | `['string', 'uint32', 'bool', 'string']` | `[coin, leverage, isCross, nonce]` |

> **WARNING:** The `hl_deposit` chainId uses `uint64`, NOT `uint256`. This is the single most common cause of "Unauthorized" errors. The backend re-encodes with `uint64` for signature verification — if you encode with `uint256`, the hex differs, signature recovery fails, and you get code 103.

### HL Signature Format

All HL write operations sign with the **session private key** (from sign-in), NOT the control wallet key:

```typescript
// Message format (no EIP-191 prefix):
const msg = `${action}-${userId.toLowerCase()}-${dataHex}`;
// e.g.: "hl_deposit-0x53d029a6...-00000000000000000000000000000000000000000000000000000000..."

const digest = keccak256(toUtf8Bytes(msg));
const sig = new SigningKey(sessionPrivateKey).sign(digest);
// Output: r(64hex) + s(64hex) + v(2hex) = 130 chars, no 0x prefix
// v = raw recovery parameter (00 or 01), NOT EIP-155 (1b/1c)
```

### HL Deposit Constraints

| Constraint | Value |
|---|---|
| Chain | Arbitrum only (chainId `42161`) |
| Token | USDC only (`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`) |
| Amount | In smallest unit (6 decimals): 10 USDC = `10000000` |
| Min deposit | 10 USDC |
| Fee buffer | Balance must cover `amount × 1.01` |
| Delivery time | ~10 minutes after Arbitrum tx confirms |
| Bridge receiver | `0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7` |
| userId | Control wallet address (from sign-in), NOT managed wallet |

### HL Error Codes

| Code | Error | Cause |
|---|---|---|
| 101 | Missing params | `computedData` not in request body |
| 102 | Invalid chainId | chainId is not 42161 |
| 102 | Invalid params | Nonce already used, or token not supported |
| 103 | Unauthorized | Signature verification failed — check ABI types (`uint64`!), userId, and that you're signing with the session key registered during sign-in |
| — | Insufficient balance | Managed wallet doesn't have enough USDC + fee on Arbitrum |
| — | Too low amount | Amount < 10 USDC |

### HTTP Headers (Required)

The backend sits behind Cloudflare. Requests MUST include browser-like headers:

```typescript
{
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Authorization': 'Bearer <apiKey>',  // NOT X-API-Key
}
```

> **WARNING:** Using a non-browser User-Agent (e.g., `axios/1.x` or any string containing bot identifiers) will result in Cloudflare 403 "Access denied". The SDK handles this automatically.

### Complete HL Deposit Example

```typescript
import {
  GdexSkill,
  GDEX_API_KEY_PRIMARY,
  generateGdexSessionKeyPair,
  buildGdexSignInMessage,
  buildGdexSignInComputedData,
  buildHlComputedData,
} from '@gdexsdk/gdex-skill';
import { ethers } from 'ethers';

const apiKey = GDEX_API_KEY_PRIMARY;
const skill = new GdexSkill();
skill.loginWithApiKey(apiKey);

// 1. Generate session keypair
const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();

// 2. Sign in (control wallet signs the Terms message)
const controlWallet = new ethers.Wallet('0xYourPrivateKey');
const nonce = String(Date.now());
const message = buildGdexSignInMessage(controlWallet.address, nonce, sessionKey);
const signature = await controlWallet.signMessage(message);

const signInPayload = buildGdexSignInComputedData({
  apiKey, userId: controlWallet.address, sessionKey, nonce,
  signature: signature.replace(/^0x/, ''),
});
await skill.signInWithComputedData({
  computedData: signInPayload.computedData, chainId: 42161,
});

// 3. Deposit USDC (amount in smallest unit, uint64 chainId is handled by SDK)
const computedData = buildHlComputedData({
  action: 'hl_deposit',
  apiKey,
  walletAddress: controlWallet.address,  // userId = control wallet
  sessionPrivateKey,
  actionParams: {
    chainId: 42161,
    tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    amount: '10000000',  // 10 USDC in smallest unit (6 decimals)
  },
});

const result = await skill.client.post('/v1/hl/deposit', { computedData });
// { hash: '0x...', isSuccess: true, amount: '10000000', message: 'Deposit successfully...' }
// Wait ~10 minutes for HyperLiquid to credit the deposit
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
