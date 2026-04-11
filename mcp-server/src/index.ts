#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadSkills, searchSkills, getSkillContent, listSkills } from './knowledge.js';
import { handleInit } from './init.js';

// Handle init command before starting server
const args = process.argv.slice(2);
if (args[0] === 'init') {
  await handleInit(args);
  process.exit(0);
}

const server = new McpServer(
  { name: 'gdex-mcp-server', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

const skills = await loadSkills();

// ── Inline guide constants (for tools that don't map 1:1 to a skill file) ──

const LEVERAGE_GUIDE = `# Leverage Management Guide

## Overview
HyperLiquid supports 1x–50x leverage depending on the asset. Leverage can be set
via managed custody (hlUpdateLeverage) or direct execution (hlExecuteIsolatedPerp).

## Cross Margin vs Isolated Margin
- **Cross margin** (isCross: true): All positions share the same collateral pool.
  If one position moves against you, unrealized profit from other positions can
  prevent liquidation. Recommended for most traders.
- **Isolated margin** (isCross: false): Each position has its own dedicated margin.
  Limits loss to that position's margin only. Safer for high-risk trades.

## Set Leverage (Managed Custody)
\`\`\`typescript
await skill.hlUpdateLeverage({
  apiKey,
  walletAddress,         // control wallet address
  sessionPrivateKey,
  coin: 'BTC',
  leverage: 20,          // 1x to maxLeverage for the asset
  isCross: true,         // true = cross, false = isolated
});
\`\`\`

## Set Leverage (Direct Execution)
\`\`\`typescript
// Cross-margin: pass leverage in trade params
await skill.hlExecuteCrossPerp(privateKey, {
  coin: 'BTC', isLong: true, price: '100000',
  positionSize: '0.001', leverage: 20,
}, true);

// Isolated-margin: automatically sets leverage + forces isolated mode
await skill.hlExecuteIsolatedPerp(privateKey, {
  coin: 'ETH', isLong: true, price: '3500',
  positionSize: '0.1', leverage: 10,
}, true);
\`\`\`

## Query Leverage Context
\`\`\`typescript
// Get a trader's leverage on a specific coin (useful for copy trading)
const leverage = await skill.getHlTraderLeverageContext(traderWallet, 'BTC');

// View leverage on your own positions
const account = await skill.getHlAccountState(walletAddress);
account.positions.forEach(p =>
  console.log(\`\${p.coin}: \${p.leverage}x, liq: $\${p.liquidationPrice}\`)
);
\`\`\`

## Max Leverage by Asset
| Asset | Max Leverage |
|-------|-------------|
| BTC | 50x |
| ETH | 50x |
| SOL | 20x |
| Most altcoins | 5x–20x |

## Important Notes
- Backend auto-sets max leverage before managed-custody trades unless you call hlUpdateLeverage() first
- Leverage changes apply to NEW orders, not existing positions
- Higher leverage = higher liquidation risk — use stop losses
- Cross margin is default; specify isCross: false for isolated`;

const LEVERAGE_CROSS_GUIDE = `# Cross-Margin Leverage Guide

Cross margin shares collateral across all positions. If BTC goes up while ETH goes
down, the BTC profit helps prevent ETH liquidation.

## Set Cross-Margin Leverage (Managed Custody)
\`\`\`typescript
await skill.hlUpdateLeverage({
  apiKey, walletAddress, sessionPrivateKey,
  coin: 'BTC', leverage: 20, isCross: true,
});
\`\`\`

## Cross-Margin Trade (Direct Execution)
\`\`\`typescript
await skill.hlExecuteCrossPerp(privateKey, {
  coin: 'BTC', isLong: true, price: '100000',
  positionSize: '0.001', leverage: 20,
  takeProfit: { price: '105000', triggerPrice: '105000' },
  stopLoss: { price: '97000', triggerPrice: '97000' },
}, true);
\`\`\`

## Key Notes
- Cross is the default margin mode
- All positions share the same collateral pool
- Higher capital efficiency but cascading liquidation risk
- Recommended for correlated positions (e.g., long BTC + long ETH)`;

const LEVERAGE_ISOLATED_GUIDE = `# Isolated-Margin Leverage Guide

Isolated margin dedicates a specific amount of collateral to each position.
If a position is liquidated, only that position's margin is lost.

## Set Isolated Leverage (Managed Custody)
\`\`\`typescript
await skill.hlUpdateLeverage({
  apiKey, walletAddress, sessionPrivateKey,
  coin: 'DOGE', leverage: 5, isCross: false,
});
\`\`\`

## Isolated-Margin Trade (Direct Execution)
\`\`\`typescript
// hlExecuteIsolatedPerp automatically sets leverage and forces isolated mode
await skill.hlExecuteIsolatedPerp(privateKey, {
  coin: 'DOGE', isLong: true, price: '0.15',
  positionSize: '1000', leverage: 5,
  takeProfit: { price: '0.18', triggerPrice: '0.18' },
  stopLoss: { price: '0.13', triggerPrice: '0.13' },
}, true);
\`\`\`

## Key Notes
- Each position has its own margin — losses don't cascade
- Better for high-risk/speculative trades on volatile assets
- Lower capital efficiency (margin is locked per position)
- Must specify leverage explicitly (no auto-max)`;

const LEVERAGE_PATTERNS = `# Leverage Code Patterns

## Set Leverage (Managed Custody)
\`\`\`typescript
await skill.hlUpdateLeverage({
  apiKey, walletAddress, sessionPrivateKey,
  coin: 'BTC', leverage: 20, isCross: true,
});
\`\`\`

## Cross-Margin Trade (Direct)
\`\`\`typescript
await skill.hlExecuteCrossPerp(privateKey, {
  coin: 'BTC', isLong: true, price: '100000',
  positionSize: '0.001', leverage: 20,
}, true);
\`\`\`

## Isolated-Margin Trade (Direct)
\`\`\`typescript
await skill.hlExecuteIsolatedPerp(privateKey, {
  coin: 'ETH', isLong: true, price: '3500',
  positionSize: '0.1', leverage: 10,
}, true);
\`\`\`

## Query Leverage
\`\`\`typescript
const lev = await skill.getHlTraderLeverageContext(traderWallet, 'BTC');
const account = await skill.getHlAccountState(walletAddress);
\`\`\``;

const POSITION_PATTERNS = `# Position Management Code Patterns

## View Positions
\`\`\`typescript
const positions = await skill.getPerpPositions({ walletAddress });
const btcOnly = await skill.getPerpPositions({ walletAddress, coin: 'BTC' });
\`\`\`

## Full Account State
\`\`\`typescript
const state = await skill.getHlAccountState(walletAddress);
// state.accountValue, state.totalMarginUsed, state.withdrawable, state.positions
\`\`\`

## Mark Prices
\`\`\`typescript
const btcPrice = await skill.getHlMarkPrice('BTC');
const allPrices = await skill.getHlAllMids();
\`\`\`

## Balances
\`\`\`typescript
const hlBalance = await skill.getHlUsdcBalance(walletAddress);
const gbotBalance = await skill.getGbotUsdcBalance(walletAddress);
\`\`\`

## Open Orders & History
\`\`\`typescript
const orders = await skill.getHlOpenOrders(walletAddress);
const trades = await skill.getHlTradeHistory(walletAddress);
const spotState = await skill.getHlSpotState(walletAddress);
\`\`\``;

const DIRECT_TRADING_PATTERNS = `# Direct Trading Code Patterns (Private Key)

## Cross-Margin Perp
\`\`\`typescript
await skill.hlExecuteCrossPerp(privateKey, {
  coin: 'BTC', isLong: true, price: '100000',
  positionSize: '0.001', leverage: 20,
  takeProfit: { price: '105000', triggerPrice: '105000' },
  stopLoss: { price: '97000', triggerPrice: '97000' },
}, true);
\`\`\`

## Isolated-Margin Perp
\`\`\`typescript
await skill.hlExecuteIsolatedPerp(privateKey, {
  coin: 'ETH', isLong: false, price: '3500',
  positionSize: '0.1', leverage: 10,
}, true);
\`\`\`

## Spot on HyperLiquid
\`\`\`typescript
await skill.hlExecuteSpot(privateKey, {
  coin: 'PURR', isBuy: true, price: '0.01', size: '100',
}, true);
\`\`\`

## Cancel Order
\`\`\`typescript
await skill.hlDirectCancelOrder(privateKey, 'BTC', orderId);
\`\`\``;

const DIRECT_TRADING_GUIDE = `# Direct Trading Guide (Private Key Execution)

Direct execution trades on HyperLiquid without managed custody. Your private key
signs the order directly. No computedData encryption, no session keys needed.

## When to Use
- You have your own wallet and private key
- You want lower latency (skip backend proxy)
- You need full control over order parameters

## Cross-Margin Perpetual Trade
\`\`\`typescript
const btcPrice = await skill.getHlMarkPrice('BTC');

await skill.hlExecuteCrossPerp(privateKey, {
  coin: 'BTC',
  isLong: true,
  price: btcPrice.toString(),
  positionSize: '0.001',    // BTC amount
  leverage: 20,
  reduceOnly: false,
  takeProfit: {
    price: (btcPrice * 1.05).toFixed(0),
    triggerPrice: (btcPrice * 1.05).toFixed(0),
  },
  stopLoss: {
    price: (btcPrice * 0.97).toFixed(0),
    triggerPrice: (btcPrice * 0.97).toFixed(0),
  },
  builderFee: { address: '0x...', feeRate: 0.001 },  // optional
}, true); // isMarket = true
\`\`\`

## Isolated-Margin Perpetual Trade
\`\`\`typescript
await skill.hlExecuteIsolatedPerp(privateKey, {
  coin: 'ETH',
  isLong: false,           // short
  price: ethPrice.toString(),
  positionSize: '0.1',
  leverage: 10,            // required for isolated
  takeProfit: { price: tpPrice, triggerPrice: tpPrice },
  stopLoss: { price: slPrice, triggerPrice: slPrice },
}, true);
\`\`\`

## Spot Trade on HyperLiquid
\`\`\`typescript
await skill.hlExecuteSpot(privateKey, {
  coin: 'PURR',
  isBuy: true,
  price: purrPrice.toString(),
  size: '100',
}, true);
\`\`\`

## Cancel Order
\`\`\`typescript
await skill.hlDirectCancelOrder(privateKey, 'BTC', orderId);
\`\`\`

## Create Custom Trader Instance
\`\`\`typescript
const trader = await skill.createHlTrader(['wss://custom-ws-url']);
\`\`\`

## Key Notes
- Private key signs directly — no AES encryption or computedData needed
- Cross margin shares collateral; isolated has per-position margin
- \`isMarket: true\` uses aggressive pricing (3% slippage) for immediate fills
- Builder fees are optional (for referral programs)
- Use \`getHlMarkPrice()\` to get current price before placing orders`;

const POSITION_MANAGEMENT_GUIDE = `# Position Management Guide

All read operations query HyperLiquid L1 directly — no authentication required.
Only the wallet address is needed.

## View All Positions
\`\`\`typescript
const positions = await skill.getPerpPositions({ walletAddress });
positions.forEach(p => {
  console.log(\`\${p.coin} \${p.side} \${p.size} @ \${p.entryPrice}\`);
  console.log(\`  Leverage: \${p.leverage}x, PnL: \${p.unrealizedPnl}\`);
  console.log(\`  Liquidation: $\${p.liquidationPrice}\`);
});
\`\`\`

## Filter by Coin
\`\`\`typescript
const btcPositions = await skill.getPerpPositions({ walletAddress, coin: 'BTC' });
\`\`\`

## Full Account State
\`\`\`typescript
const state = await skill.getHlAccountState(walletAddress);
console.log(\`Account Value: $\${state.accountValue}\`);
console.log(\`Total Notional: $\${state.totalNtlPos}\`);
console.log(\`Margin Used: $\${state.totalMarginUsed}\`);
console.log(\`Withdrawable: $\${state.withdrawable}\`);
console.log(\`Positions: \${state.positions.length}\`);
\`\`\`

## Check Mark Prices
\`\`\`typescript
const btcPrice = await skill.getHlMarkPrice('BTC');
const allPrices = await skill.getHlAllMids(); // { BTC: '100000', ETH: '3500', ... }
\`\`\`

## Check USDC Balance
\`\`\`typescript
// Direct L1 query (no auth)
const hlBalance = await skill.getHlUsdcBalance(walletAddress);

// Backend query (requires auth)
const gbotBalance = await skill.getGbotUsdcBalance(walletAddress);
\`\`\`

## View Open Orders
\`\`\`typescript
const orders = await skill.getHlOpenOrders(walletAddress);
\`\`\`

## View Trade History
\`\`\`typescript
const trades = await skill.getHlTradeHistory(walletAddress);
\`\`\`

## Spot State on HyperLiquid
\`\`\`typescript
const spotState = await skill.getHlSpotState(walletAddress);
\`\`\`

## PerpPosition Fields
| Field | Type | Description |
|-------|------|-------------|
| coin | string | Asset symbol (BTC, ETH, etc.) |
| side | 'long' \\| 'short' | Position direction |
| size | string | Absolute position size |
| entryPrice | string | Average entry price |
| markPrice | string | Current mark price |
| leverage | number | Current leverage multiplier |
| liquidationPrice | string? | Estimated liquidation price |
| unrealizedPnl | string | Unrealized profit/loss |
| margin | string | Margin used by this position |
| positionValue | string | Total notional value |

## HlAccountState Fields
| Field | Type | Description |
|-------|------|-------------|
| accountValue | string | Total account value in USD |
| totalNtlPos | string | Total notional position value |
| totalRawUsd | string | Raw USD balance |
| totalMarginUsed | string | Total margin in use |
| withdrawable | string | Available for withdrawal |
| positions | PerpPosition[] | All open positions |`;

const ORDER_MANAGEMENT_GUIDE = `# Order Management Guide

## Order Types

### 1. Market Order with TP/SL (hlCreateOrder)
The primary way to open positions with take-profit and stop-loss.
\`\`\`typescript
await skill.hlCreateOrder({
  apiKey, walletAddress, sessionPrivateKey,
  coin: 'BTC',
  isLong: true,
  price: markPrice.toString(),    // use current mark price for market orders
  size: '0.001',                  // position size in asset units
  isMarket: true,
  tpPrice: (markPrice * 1.05).toFixed(0),  // +5% take profit
  slPrice: (markPrice * 0.97).toFixed(0),   // -3% stop loss
});
\`\`\`

### 2. Simple Order (hlPlaceOrder)
No TP/SL — for limit orders or simple entries.
\`\`\`typescript
await skill.hlPlaceOrder({
  apiKey, walletAddress, sessionPrivateKey,
  coin: 'ETH', isLong: true,
  price: '3000',      // limit price
  size: '0.5',
  reduceOnly: false,
});
\`\`\`

### 3. Close a Position
Place an opposite-side reduce-only order equal to the position size.
\`\`\`typescript
await skill.hlCreateOrder({
  apiKey, walletAddress, sessionPrivateKey,
  coin: 'BTC',
  isLong: false,                    // opposite of your position
  price: markPrice.toString(),
  size: currentPosition.size,       // full position size
  isMarket: true,
  reduceOnly: true,                 // critical: prevents opening a new position
});
\`\`\`

### 4. Cancel a Specific Order
\`\`\`typescript
await skill.hlCancelOrder({
  apiKey, walletAddress, sessionPrivateKey,
  coin: 'BTC',
  orderId: '12345',
});
\`\`\`

### 5. Cancel All Orders
\`\`\`typescript
await skill.hlCancelAllOrders({
  apiKey, walletAddress, sessionPrivateKey,
});
\`\`\`

### 6. Close All Positions (Unreliable)
\`\`\`typescript
// WARNING: This endpoint is unreliable. Use per-coin close instead.
await skill.hlCloseAll({
  apiKey, walletAddress, sessionPrivateKey,
});
\`\`\`

### 7. Limit Buy (Spot — Any Chain)
\`\`\`typescript
await skill.limitBuy({
  apiKey, userId, sessionPrivateKey,
  tokenAddress: '0x...', amount: '0.1',
  triggerPrice: '3000',
  profitPercent: '10', lossPercent: '5',
  chainId: 8453,
});
\`\`\`

### 8. Limit Sell (Spot — Any Chain)
\`\`\`typescript
await skill.limitSell({
  apiKey, userId, sessionPrivateKey,
  tokenAddress: '0x...', amount: '50%',
  triggerPrice: '5000',
  chainId: 8453,
});
\`\`\`

## Direct Execution Orders (Private Key)
\`\`\`typescript
// Cross-margin perp with TP/SL
await skill.hlExecuteCrossPerp(privateKey, {
  coin: 'BTC', isLong: true, price: '100000',
  positionSize: '0.001', leverage: 20,
  takeProfit: { price: '105000', triggerPrice: '105000' },
  stopLoss: { price: '97000', triggerPrice: '97000' },
}, true);

// Cancel by order ID
await skill.hlDirectCancelOrder(privateKey, 'BTC', orderId);
\`\`\`

## Key Notes
- \`hlCreateOrder\` = full-featured (TP/SL); \`hlPlaceOrder\` = simple
- Always use \`reduceOnly: true\` when closing positions
- To close a long: place a short of equal size (vice versa)
- \`hlCloseAll\` is unreliable — close positions individually per coin
- Managed-custody credentials: apiKey + walletAddress (control) + sessionPrivateKey
- For HL orders: coin is uppercase (BTC, ETH, SOL)
- For limit orders: amount can be percentage ('50%') for sells`;

const PERP_FUNDING_GUIDE = `# Perp Funding Guide — Deposit & Withdraw USDC

## Deposit USDC to HyperLiquid
\`\`\`typescript
await skill.perpDeposit({
  apiKey, walletAddress, sessionPrivateKey,
  amount: '100',              // human-readable USDC (auto-converts to 6 decimals)
  chainId: 42161,             // Arbitrum
  tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC on Arb
});
\`\`\`

## Withdraw USDC from HyperLiquid
\`\`\`typescript
await skill.perpWithdraw({
  apiKey, walletAddress, sessionPrivateKey,
  amount: '50',
});
\`\`\`

## Check Balances
\`\`\`typescript
const hlBalance = await skill.getHlUsdcBalance(walletAddress);     // L1 query
const gbotBalance = await skill.getGbotUsdcBalance(walletAddress); // backend
\`\`\`

## Key Notes
- Deposits use chainId: 42161 (Arbitrum) with USDC token address
- Amount is in human-readable USDC (e.g., '100' = 100 USDC)
- SDK auto-converts to smallest unit (6 decimals) for the backend
- Withdrawals may take 1-2 minutes to process
- Use walletAddress = control wallet (NOT managed wallet)`;

// --- Tool: search_gdex_docs ---
server.tool(
  'search_gdex_docs',
  'Search GDEX documentation and skill files by keyword. Returns matching skill sections.',
  { query: z.string().describe('Search query — keywords to find across all GDEX skills and documentation') },
  async ({ query }) => {
    const results = searchSkills(skills, query);
    if (results.length === 0) {
      return { content: [{ type: 'text', text: `No results found for "${query}". Available skills:\n${listSkills(skills).map(s => `- ${s.name}: ${s.description}`).join('\n')}` }] };
    }

    const output = results.slice(0, 5).map(r => {
      const matchSections = r.matches.slice(0, 3).join(', ');
      return `### ${r.skill.name}\n${r.skill.description}\n\nMatching sections: ${matchSections}\n\n${r.skill.content.slice(0, 1500)}${r.skill.content.length > 1500 ? '\n...(truncated)' : ''}`;
    }).join('\n\n---\n\n');

    return { content: [{ type: 'text', text: output }] };
  },
);

// --- Tool: get_sdk_pattern ---
const SDK_OPERATIONS = [
  'spot-trade', 'perp-trade', 'copy-trade', 'perp-copy-trade',
  'bridge', 'auth', 'portfolio', 'token-discovery', 'limit-orders',
  'perp-funding', 'wallet-setup', 'leverage', 'positions', 'direct-trading',
] as const;

server.tool(
  'get_sdk_pattern',
  'Get TypeScript code patterns for common GDEX SDK operations. Returns working code examples.',
  { operation: z.enum(SDK_OPERATIONS).describe('The SDK operation to get code patterns for') },
  async ({ operation }) => {
    const skillMap: Record<string, string> = {
      'spot-trade': 'gdex-spot-trading',
      'perp-trade': 'gdex-perp-trading',
      'copy-trade': 'gdex-copy-trading',
      'perp-copy-trade': 'gdex-perp-copy-trading',
      'bridge': 'gdex-bridge',
      'auth': 'gdex-authentication',
      'portfolio': 'gdex-portfolio',
      'token-discovery': 'gdex-token-discovery',
      'limit-orders': 'gdex-limit-orders',
      'perp-funding': 'gdex-perp-funding',
      'wallet-setup': 'gdex-wallet-setup',
      'leverage': 'gdex-perp-trading',
      'positions': 'gdex-perp-trading',
      'direct-trading': 'gdex-perp-trading',
    };

    const skillName = skillMap[operation];
    const content = getSkillContent(skills, skillName);
    if (!content) {
      return { content: [{ type: 'text', text: `No patterns found for operation "${operation}".` }] };
    }

    // For specialized operations within perp-trading, extract relevant sections
    if (operation === 'leverage') {
      return { content: [{ type: 'text', text: LEVERAGE_PATTERNS }] };
    }
    if (operation === 'positions') {
      return { content: [{ type: 'text', text: POSITION_PATTERNS }] };
    }
    if (operation === 'direct-trading') {
      return { content: [{ type: 'text', text: DIRECT_TRADING_PATTERNS }] };
    }

    // Extract code blocks
    const codeBlocks = content.match(/```typescript[\s\S]*?```/g) ?? [];
    const text = codeBlocks.length > 0
      ? `# ${skillName} — Code Patterns\n\n${codeBlocks.join('\n\n')}`
      : `# ${skillName}\n\n${content.slice(0, 3000)}`;

    return { content: [{ type: 'text', text }] };
  },
);

// --- Tool: get_api_info ---
server.tool(
  'get_api_info',
  'Get GDEX API endpoint details — URL, method, parameters, and response format.',
  { endpoint: z.string().describe('Endpoint name or keyword (e.g., "buy_token", "hl_create_order", "deposit", "portfolio")') },
  async ({ endpoint }) => {
    const results = searchSkills(skills, endpoint);
    if (results.length === 0) {
      return { content: [{ type: 'text', text: `No API info found for "${endpoint}".` }] };
    }

    // Return the most relevant skill content (focused on parameters and endpoints)
    const skill = results[0].skill;
    const paramSections: string[] = [];

    for (const [heading, content] of skill.sections) {
      if (heading.includes('parameter') || heading.includes('endpoint') || heading.includes('api') || heading.includes('response')) {
        paramSections.push(`## ${heading}\n\n${content}`);
      }
    }

    const text = paramSections.length > 0
      ? `# API Info: ${skill.name}\n${skill.description}\n\n${paramSections.join('\n\n')}`
      : `# API Info: ${skill.name}\n${skill.description}\n\n${skill.content.slice(0, 3000)}`;

    return { content: [{ type: 'text', text }] };
  },
);

// --- Tool: explain_workflow ---
const WORKFLOWS = [
  'spot-trade', 'perp-trade', 'copy-trade', 'perp-copy-trade',
  'bridge', 'auth', 'limit-order', 'perp-funding', 'full-trading-app',
  'leverage', 'position-management', 'direct-trading', 'order-management',
] as const;

server.tool(
  'explain_workflow',
  'Explain an end-to-end GDEX trading workflow with step-by-step instructions and code.',
  { workflow: z.enum(WORKFLOWS).describe('The workflow to explain') },
  async ({ workflow }) => {
    const workflowGuides: Record<string, string> = {
      'spot-trade': `# Spot Trading Workflow

1. **Install SDK:** \`npm install @gdexsdk/gdex-skill\`
2. **Initialize & authenticate:**
\`\`\`typescript
import { GdexSkill, GDEX_API_KEY_PRIMARY } from '@gdexsdk/gdex-skill';
const skill = new GdexSkill();
skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);
\`\`\`
3. **Buy a token:**
\`\`\`typescript
const result = await skill.buyToken({
  chain: 'solana',
  tokenAddress: 'TOKEN_ADDRESS',
  amount: '0.1',  // 0.1 SOL
  slippage: 1,
});
\`\`\`
4. **Sell a token:**
\`\`\`typescript
const result = await skill.sellToken({
  chain: 'solana',
  tokenAddress: 'TOKEN_ADDRESS',
  amount: '50%',  // sell 50% of holdings
  slippage: 1,
});
\`\`\`

**Key notes:**
- Solana chainId is \`622112261\`, not \`900\`
- Meteora-routed tokens are broken — use Raydium
- First Solana trade needs ~0.01 SOL for ATA creation`,

      'perp-trade': `# Perpetual Futures Workflow

1. **Install & auth** (same as spot)
2. **Deposit USDC to HyperLiquid:**
\`\`\`typescript
await skill.perpDeposit({ amount: '100', chainId: 42161 }); // 100 USDC
\`\`\`
3. **Set leverage (optional — backend defaults to max):**
\`\`\`typescript
await skill.hlUpdateLeverage({
  ...creds, coin: 'BTC', leverage: 20, isCross: true,
});
\`\`\`
4. **Open a position with TP/SL:**
\`\`\`typescript
await skill.hlCreateOrder({
  ...creds, coin: 'BTC', isLong: true,
  price: markPrice.toString(), size: '0.001',
  isMarket: true,
  tpPrice: (markPrice * 1.05).toFixed(0),  // +5% take profit
  slPrice: (markPrice * 0.97).toFixed(0),   // -3% stop loss
});
\`\`\`
5. **Check positions:**
\`\`\`typescript
const positions = await skill.getPerpPositions({ walletAddress });
const account = await skill.getHlAccountState(walletAddress);
\`\`\`
6. **Close a position:**
\`\`\`typescript
await skill.hlCreateOrder({
  ...creds, coin: 'BTC', isLong: false,  // opposite side to close
  price: markPrice.toString(), size: currentPosition.size,
  isMarket: true, reduceOnly: true,
});
\`\`\`

**Key notes:**
- Use \`hlUpdateLeverage()\` to explicitly set leverage (1x–50x depending on asset)
- Backend calls setMaxLeverage() before each trade, but explicit is recommended
- \`hlCloseAll\` is unreliable — close positions per-coin with reduceOnly orders
- All managed-custody operations use \`walletAddress\` = control wallet (NOT managed)
- Use \`getHlMarkPrice('BTC')\` to get current price before placing orders
- For direct execution (with private key), use \`hlExecuteCrossPerp()\` or \`hlExecuteIsolatedPerp()\``,

      'auth': `# Authentication Workflow

**Option A: Shared API Key (recommended for agents)**
\`\`\`typescript
import { GdexSkill, GDEX_API_KEY_PRIMARY } from '@gdexsdk/gdex-skill';
const skill = new GdexSkill();
skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);
// Ready to trade immediately
\`\`\`

**Option B: Wallet-based auth**
1. Generate or import a control wallet (see gdex-wallet-setup)
2. Sign in with the control wallet
3. Backend provisions a managed wallet
4. All trades use encrypted computedData payloads (AES-256-CBC)

**Key concepts:**
- Control wallet: signs in, used as \`userId\` in API calls
- Managed wallet: server-side, executes trades on-chain
- Session key: secp256k1 keypair registered during sign-in, signs trade payloads
- AES key derivation: \`SHA256(SHA256(SHA256(apiKey)))\``,

      'full-trading-app': `# Full Trading App Workflow

1. **Set up React/Next.js project:** Load \`gdex-ui-install-setup\`
2. **Add SDK context provider:** Wrap app in \`GdexProvider\`
3. **Add wallet connection:** Load \`gdex-ui-wallet-connection\`
4. **Add trading components:** Load \`gdex-ui-trading-components\`
5. **Add portfolio dashboard:** Load \`gdex-ui-portfolio-dashboard\`
6. **Add theming:** Load \`gdex-ui-theming\`
7. **Compose pages:** Load \`gdex-ui-page-layouts\`

See the Frontend skills for complete component patterns and code examples.`,

      'leverage': `# Leverage Management Workflow

1. **Check current leverage for a position:**
\`\`\`typescript
const account = await skill.getHlAccountState(walletAddress);
// Each position includes: leverage, margin, liquidationPrice
account.positions.forEach(p =>
  console.log(\`\${p.coin}: \${p.leverage}x, liq: $\${p.liquidationPrice}\`)
);
\`\`\`

2. **Set leverage (managed custody):**
\`\`\`typescript
await skill.hlUpdateLeverage({
  apiKey, walletAddress, sessionPrivateKey,
  coin: 'BTC',
  leverage: 20,    // 1x to maxLeverage (asset-dependent: BTC=50x, ETH=50x, etc.)
  isCross: true,   // true = cross margin, false = isolated margin
});
\`\`\`

3. **Set leverage (direct execution):**
\`\`\`typescript
// Cross-margin: leverage set via the trade itself
await skill.hlExecuteCrossPerp(privateKey, {
  coin: 'BTC', isLong: true, price: '100000',
  positionSize: '0.001', leverage: 20,
}, true);

// Isolated-margin: automatically sets leverage + forces isolated mode
await skill.hlExecuteIsolatedPerp(privateKey, {
  coin: 'ETH', isLong: true, price: '3500',
  positionSize: '0.1', leverage: 10,
}, true);
\`\`\`

4. **Get a trader's leverage context (for copy trading):**
\`\`\`typescript
const lev = await skill.getHlTraderLeverageContext(traderWallet, 'BTC');
console.log(\`Trader uses \${lev}x on BTC\`);
\`\`\`

**Key notes:**
- Cross margin: shares collateral across all positions (recommended for most cases)
- Isolated margin: each position has its own margin — lower risk of full liquidation
- Max leverage varies by asset (BTC/ETH = 50x, altcoins = 5x–20x)
- Backend auto-sets max leverage before managed-custody trades unless you call hlUpdateLeverage() first
- Leverage changes apply to new orders, not existing positions`,

      'position-management': `# Position Management Workflow

1. **View all positions:**
\`\`\`typescript
const positions = await skill.getPerpPositions({ walletAddress });
positions.forEach(p => console.log(
  \`\${p.coin} \${p.side} \${p.size} @ \${p.entryPrice}, PnL: \${p.unrealizedPnl}\`
));
\`\`\`

2. **View full account state:**
\`\`\`typescript
const state = await skill.getHlAccountState(walletAddress);
console.log(\`Account: $\${state.accountValue}, Margin: $\${state.totalMarginUsed}\`);
console.log(\`Withdrawable: $\${state.withdrawable}\`);
\`\`\`

3. **Check mark price before trading:**
\`\`\`typescript
const btcPrice = await skill.getHlMarkPrice('BTC');
const allPrices = await skill.getHlAllMids(); // all assets
\`\`\`

4. **Check USDC balance:**
\`\`\`typescript
const hlBalance = await skill.getHlUsdcBalance(walletAddress);    // L1 query
const gbotBalance = await skill.getGbotUsdcBalance(walletAddress); // backend query
\`\`\`

5. **View open orders:**
\`\`\`typescript
const orders = await skill.getHlOpenOrders(walletAddress);
\`\`\`

6. **View trade history:**
\`\`\`typescript
const trades = await skill.getHlTradeHistory(walletAddress);
\`\`\`

7. **View spot state on HyperLiquid:**
\`\`\`typescript
const spotState = await skill.getHlSpotState(walletAddress);
\`\`\`

**Key notes:**
- All read operations query HyperLiquid L1 directly — no auth required
- Only \`walletAddress\` is needed (control wallet address)
- Mark prices come from L2 mid prices, updated in real-time
- \`getGbotUsdcBalance\` uses the GDEX backend (requires auth)`,

      'direct-trading': `# Direct Trading Workflow (Private Key)

Direct execution bypasses GDEX managed custody and trades directly on HyperLiquid.
Requires a wallet private key.

1. **Cross-margin perp trade:**
\`\`\`typescript
const btcPrice = await skill.getHlMarkPrice('BTC');
await skill.hlExecuteCrossPerp(privateKey, {
  coin: 'BTC',
  isLong: true,
  price: btcPrice.toString(),
  positionSize: '0.001',
  leverage: 20,
  takeProfit: { price: (btcPrice * 1.05).toFixed(0), triggerPrice: (btcPrice * 1.05).toFixed(0) },
  stopLoss: { price: (btcPrice * 0.97).toFixed(0), triggerPrice: (btcPrice * 0.97).toFixed(0) },
}, true); // isMarket = true
\`\`\`

2. **Isolated-margin perp trade:**
\`\`\`typescript
await skill.hlExecuteIsolatedPerp(privateKey, {
  coin: 'ETH',
  isLong: false,   // short
  price: ethPrice.toString(),
  positionSize: '0.1',
  leverage: 10,    // required for isolated
  takeProfit: { price: tpPrice, triggerPrice: tpPrice },
  stopLoss: { price: slPrice, triggerPrice: slPrice },
}, true);
\`\`\`

3. **Spot trade on HyperLiquid:**
\`\`\`typescript
await skill.hlExecuteSpot(privateKey, {
  coin: 'PURR',
  isBuy: true,
  price: purrPrice.toString(),
  size: '100',
}, true);
\`\`\`

4. **Cancel an order directly:**
\`\`\`typescript
await skill.hlDirectCancelOrder(privateKey, 'BTC', orderId);
\`\`\`

5. **Create a custom trader instance:**
\`\`\`typescript
const trader = await skill.createHlTrader(['wss://custom-ws-url']);
// Use trader directly for advanced operations
\`\`\`

**Key notes:**
- Direct execution does NOT use computedData encryption — private key signs directly
- Cross-margin shares collateral; isolated-margin uses per-position margin
- \`isMarket: true\` uses aggressive pricing for immediate fills
- Builder fees are optional: \`{ address: '0x...', feeRate: 0.001 }\`
- For managed-custody trading (no private key), use hlCreateOrder() / hlPlaceOrder()`,

      'order-management': `# Order Management Workflow

1. **Market order with TP/SL (managed custody):**
\`\`\`typescript
const result = await skill.hlCreateOrder({
  apiKey, walletAddress, sessionPrivateKey,
  coin: 'BTC', isLong: true,
  price: markPrice.toString(),
  size: '0.001',
  isMarket: true,
  tpPrice: (markPrice * 1.05).toFixed(0),
  slPrice: (markPrice * 0.97).toFixed(0),
});
\`\`\`

2. **Simple order without TP/SL:**
\`\`\`typescript
const result = await skill.hlPlaceOrder({
  apiKey, walletAddress, sessionPrivateKey,
  coin: 'ETH', isLong: true,
  price: '3500', size: '0.1',
  reduceOnly: false,
});
\`\`\`

3. **Close a position (reduce-only opposite-side order):**
\`\`\`typescript
await skill.hlCreateOrder({
  apiKey, walletAddress, sessionPrivateKey,
  coin: 'BTC', isLong: false,  // opposite of position
  price: markPrice.toString(), size: positionSize,
  isMarket: true, reduceOnly: true,
});
\`\`\`

4. **Cancel a specific order:**
\`\`\`typescript
await skill.hlCancelOrder({
  apiKey, walletAddress, sessionPrivateKey,
  coin: 'BTC', orderId: '12345',
});
\`\`\`

5. **Cancel all orders:**
\`\`\`typescript
await skill.hlCancelAllOrders({ apiKey, walletAddress, sessionPrivateKey });
\`\`\`

6. **Close all positions (unreliable — use per-coin close instead):**
\`\`\`typescript
await skill.hlCloseAll({ apiKey, walletAddress, sessionPrivateKey });
\`\`\`

7. **Limit buy on any chain:**
\`\`\`typescript
await skill.limitBuy({
  apiKey, userId, sessionPrivateKey,
  tokenAddress: '0x...', amount: '0.1',
  triggerPrice: '3000', profitPercent: '10', lossPercent: '5',
  chainId: 8453,  // Base
});
\`\`\`

8. **Limit sell:**
\`\`\`typescript
await skill.limitSell({
  apiKey, userId, sessionPrivateKey,
  tokenAddress: '0x...', amount: '50%',
  triggerPrice: '5000',
  chainId: 8453,
});
\`\`\`

**Key notes:**
- \`hlCreateOrder\` = full order with TP/SL; \`hlPlaceOrder\` = simple order
- Always set \`reduceOnly: true\` when closing a position
- To close a long, place a short of equal size (and vice versa)
- \`hlCloseAll\` is known to be unreliable — close per-coin instead
- Managed-custody credentials: \`apiKey\`, \`walletAddress\` (control wallet), \`sessionPrivateKey\`
- For direct execution without managed custody, use \`hlExecuteCrossPerp()\``,
    };

    // For workflows not in the map, pull from skill content
    if (workflowGuides[workflow]) {
      return { content: [{ type: 'text', text: workflowGuides[workflow] }] };
    }

    const skillMap: Record<string, string> = {
      'copy-trade': 'gdex-copy-trading',
      'perp-copy-trade': 'gdex-perp-copy-trading',
      'bridge': 'gdex-bridge',
      'limit-order': 'gdex-limit-orders',
      'perp-funding': 'gdex-perp-funding',
    };

    const skillName = skillMap[workflow];
    const content = getSkillContent(skills, skillName);
    if (!content) {
      return { content: [{ type: 'text', text: `No workflow guide found for "${workflow}".` }] };
    }

    return { content: [{ type: 'text', text: `# ${workflow} Workflow\n\n${content.slice(0, 4000)}` }] };
  },
);

// --- Tool: get_chain_info ---
server.tool(
  'get_chain_info',
  'Get supported chains, chain IDs, DEXes, and capabilities.',
  { chain: z.string().optional().describe('Optional: filter by chain name (e.g., "solana", "base", "arbitrum"). Omit for all chains.') },
  async ({ chain }) => {
    const chainTable = `# Supported Chains

| Chain | ChainId | DEXes | Perps | Bridge |
|-------|---------|-------|-------|--------|
| Ethereum | 1 | Uniswap v2/v3, Odos | — | Yes |
| Optimism | 10 | Uniswap v3, Odos | — | Yes |
| BSC | 56 | PancakeSwap, Odos | — | Yes |
| Sonic | 146 | — | — | Yes |
| Fraxtal | 252 | Uniswap v3 | — | Yes |
| Nibiru | 6900 | — | — | Yes |
| Base | 8453 | Uniswap v3, Odos, Arcadia | — | Yes |
| Arbitrum | 42161 | Uniswap v3, Odos | — | Yes |
| Berachain | 80094 | — | — | Yes |
| Solana | 622112261 | Raydium, Raydium v2, Orca | — | Yes |
| Sui | 1313131213 | Cetus, Bluefin | — | Yes |
| HyperLiquid | — | — | Native perp engine | — |

**Critical notes:**
- Solana chainId is \`622112261\`, NOT \`900\`
- For managed-custody: 900 = Solana, 101 = Sui, or standard EVM chain IDs
- \`/v1/user\` returns different managed wallets per chainId
- Solana copy trades require sign-in with \`chainId: 622112261\`
- HL perp copy trades require sign-in with \`chainId: 1\`
- HL operations (deposit, orders) use \`chainId: 42161\` (Arbitrum)`;

    if (chain) {
      const chainLower = chain.toLowerCase();
      const lines = chainTable.split('\n').filter(line =>
        line.toLowerCase().includes(chainLower) || line.startsWith('|') && line.includes('---') || line.startsWith('#') || line.startsWith('**')
      );
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    return { content: [{ type: 'text', text: chainTable }] };
  },
);

// --- Tool: get_trading_guide ---
server.tool(
  'get_trading_guide',
  'Get a complete trading guide. Covers spot, perp, limit orders, leverage, funding (deposit/withdraw), and direct private-key trading.',
  { type: z.enum(['spot', 'perp', 'limit', 'leverage', 'funding', 'direct']).describe('Trading type: spot, perp, limit, leverage, funding (deposit/withdraw USDC), or direct (private-key HL trading)') },
  async ({ type }) => {
    // Types with dedicated skill files
    const skillMap: Record<string, string> = {
      'spot': 'gdex-spot-trading',
      'perp': 'gdex-perp-trading',
      'limit': 'gdex-limit-orders',
      'funding': 'gdex-perp-funding',
    };

    // Types with inline guides (no dedicated skill file)
    const inlineGuides: Record<string, string> = {
      'leverage': LEVERAGE_GUIDE,
      'direct': DIRECT_TRADING_GUIDE,
    };

    if (inlineGuides[type]) {
      return { content: [{ type: 'text', text: inlineGuides[type] }] };
    }

    const content = getSkillContent(skills, skillMap[type]);
    if (!content) {
      return { content: [{ type: 'text', text: `No trading guide found for type "${type}".` }] };
    }

    return { content: [{ type: 'text', text: `# ${type.charAt(0).toUpperCase() + type.slice(1)} Trading Guide\n\n${content}` }] };
  },
);

// --- Tool: get_copy_trade_guide ---
server.tool(
  'get_copy_trade_guide',
  'Get a copy trading guide for Solana spot or HyperLiquid perp copy trading.',
  { chain: z.enum(['solana', 'hyperliquid']).describe('Platform: solana (spot copy) or hyperliquid (perp copy)') },
  async ({ chain }) => {
    const skillName = chain === 'solana' ? 'gdex-copy-trading' : 'gdex-perp-copy-trading';
    const content = getSkillContent(skills, skillName);
    if (!content) {
      return { content: [{ type: 'text', text: `No copy trade guide found for "${chain}".` }] };
    }

    return { content: [{ type: 'text', text: `# ${chain === 'solana' ? 'Solana Spot' : 'HyperLiquid Perp'} Copy Trading Guide\n\n${content}` }] };
  },
);

// --- Tool: get_component_guide ---
server.tool(
  'get_component_guide',
  'Get React UI component patterns for GDEX trading interfaces.',
  { component: z.string().describe('Component name or category (e.g., "SpotTradeForm", "PositionTable", "portfolio", "theming", "wallet", "page-layouts")') },
  async ({ component }) => {
    // Search across UI skills
    const uiSkills = ['gdex-ui-trading-components', 'gdex-ui-portfolio-dashboard', 'gdex-ui-wallet-connection', 'gdex-ui-theming', 'gdex-ui-page-layouts', 'gdex-ui-install-setup'];
    const results: string[] = [];

    for (const skillName of uiSkills) {
      const content = getSkillContent(skills, skillName);
      if (content && content.toLowerCase().includes(component.toLowerCase())) {
        results.push(`## From: ${skillName}\n\n${content}`);
      }
    }

    if (results.length === 0) {
      return { content: [{ type: 'text', text: `No component guide found for "${component}". Available UI skills: ${uiSkills.join(', ')}` }] };
    }

    return { content: [{ type: 'text', text: `# Component Guide: ${component}\n\n${results.join('\n\n---\n\n')}` }] };
  },
);

// --- Tool: get_leverage_guide ---
server.tool(
  'get_leverage_guide',
  'Get a comprehensive guide on leverage management for HyperLiquid perpetual trading — cross vs isolated margin, setting leverage, querying leverage context.',
  { mode: z.enum(['cross', 'isolated', 'overview']).optional().describe('Leverage mode to focus on: cross (shared collateral), isolated (per-position margin), or overview (all). Default: overview') },
  async ({ mode }) => {
    const modeLabel = mode ?? 'overview';
    if (modeLabel === 'cross') {
      return { content: [{ type: 'text', text: LEVERAGE_CROSS_GUIDE }] };
    }
    if (modeLabel === 'isolated') {
      return { content: [{ type: 'text', text: LEVERAGE_ISOLATED_GUIDE }] };
    }
    return { content: [{ type: 'text', text: LEVERAGE_GUIDE }] };
  },
);

// --- Tool: get_position_management_guide ---
server.tool(
  'get_position_management_guide',
  'Get a guide on managing perpetual positions — viewing positions, account state, mark prices, balances, open orders, and trade history.',
  { operation: z.enum(['view-positions', 'account-state', 'prices', 'balances', 'orders', 'history', 'overview']).optional().describe('Specific operation or overview. Default: overview') },
  async ({ operation }) => {
    return { content: [{ type: 'text', text: POSITION_MANAGEMENT_GUIDE }] };
  },
);

// --- Tool: get_order_management_guide ---
server.tool(
  'get_order_management_guide',
  'Get a guide on order management — market orders, limit orders, TP/SL, cancellation, and closing positions on HyperLiquid.',
  { orderType: z.enum(['market', 'limit', 'tp-sl', 'cancel', 'close', 'overview']).optional().describe('Specific order type or overview. Default: overview') },
  async ({ orderType }) => {
    return { content: [{ type: 'text', text: ORDER_MANAGEMENT_GUIDE }] };
  },
);

// --- Tool: get_perp_funding_guide ---
server.tool(
  'get_perp_funding_guide',
  'Get a guide on depositing and withdrawing USDC to/from HyperLiquid for perpetual trading.',
  {},
  async () => {
    const content = getSkillContent(skills, 'gdex-perp-funding');
    if (!content) {
      return { content: [{ type: 'text', text: PERP_FUNDING_GUIDE }] };
    }
    return { content: [{ type: 'text', text: `# Perp Funding Guide — Deposit & Withdraw USDC\n\n${content}` }] };
  },
);

// --- Tool: get_direct_trading_guide ---
server.tool(
  'get_direct_trading_guide',
  'Get a guide on direct private-key trading on HyperLiquid — cross perp, isolated perp, and spot execution without managed custody.',
  { type: z.enum(['cross-perp', 'isolated-perp', 'spot', 'overview']).optional().describe('Trading type or overview. Default: overview') },
  async ({ type }) => {
    return { content: [{ type: 'text', text: DIRECT_TRADING_GUIDE }] };
  },
);

// --- Start server ---
const transport = new StdioServerTransport();
await server.connect(transport);
