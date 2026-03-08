# We Gave an AI Agent a Crypto Wallet. It Didn't Lose the Seed Phrase.

### *Introducing GDEX Skill — the SDK that lets your AI agent trade crypto across 17 chains while you touch grass*

---

**TL;DR:** We built an entire DeFi trading brain for AI agents in 48 hours. Spot trading, perpetual futures, limit orders, copy trading, cross-chain bridges — the whole damn buffet. Your agent can now long ETH at 50x leverage at 3am while you're dreaming about lambos. As it should be.

---

## What Happened Today

Let's be real. Most "AI crypto" projects are just a ChatGPT wrapper that tells you Bitcoin is volatile. Groundbreaking stuff.

We woke up and chose violence.

**GDEX Skill** is a production-grade TypeScript SDK that gives AI agents — Claude, GPT, Cursor, your custom homebrew frankenstein — the ability to actually *trade*. Not "here's what I think you should do." Not "I recommend diversifying." We mean **execute the trade, manage the position, check the P&L, and close when it's time.**

And we did it in 48 hours. 32,537 lines of code. 91 passing tests. 19 skills. From an empty README to a full autonomous trading brain.

You're welcome.

---

## The Numbers Don't Lie (But Your Portfolio Might)

| Stat | Value |
|------|-------|
| Lines of code | 32,537 |
| Test suites | 7 |
| Passing tests | 91/91 |
| E2E live tests | 39/42 (3 failures = backend's problem, not ours) |
| Supported chains | 17 |
| Trading skills | 19 |
| MCP tools | 8 |
| Time to build | 48 hours |
| Coffees consumed | classified |

---

## What Can Your Agent Actually Do?

### 🔥 Spot Trade Across 17 Chains

Solana, Ethereum, Arbitrum, Base, BSC, Polygon, Avalanche, Optimism, zkSync, Linea, Scroll, Blast, Sonic, Fraxtal, Nibiru, Berachain, Sui. Your agent can buy and sell tokens on all of them. With DEX routing. Automatically.

```typescript
const sdk = new GdexSkill();
sdk.loginWithApiKey('your-api-key');

// Your agent just bought a memecoin on Solana. God help us all.
await sdk.buyToken({
  chainId: '622112261',
  tokenAddress: 'So11111111111111111111111111111111111111112',
  amount: '10',
  slippage: 5
});
```

### 📈 Perpetual Futures on HyperLiquid

50x leverage. Long BTC. Short ETH. Set take-profit at 420%. Stop-loss at... well, wherever your risk tolerance ends and your prayers begin.

```typescript
// Your agent is a degen now. Congrats.
await sdk.hlCreateOrder({
  walletAddress: managed.evm,
  coin: 'BTC',
  side: 'long',
  size: '0.001',
  price: '95000',
  leverage: 20,
  orderType: 'limit',
  takeProfitPercent: '50',
  stopLossPercent: '10'
});
```

### 📊 Limit Orders with TP/SL

Because your agent has more patience than you ever will.

### 🐋 Copy Trading

Your agent can find the top traders on Solana, copy their wallets, and ride along. It can also copy HyperLiquid perp whales — long what they long, or inverse them if your agent has contrarian energy.

```typescript
// Find Solana whales and ride their coattails
const wallets = await sdk.getCopyTradeWallets();
await sdk.createCopyTrade({
  walletAddress: wallets[0].address,
  tradeAmount: '100',
  chainId: '622112261'
});
```

### 🌉 Cross-Chain Bridge

Move tokens between chains. Your agent doesn't care about bridges being "scary" — it just moves the money.

### 💼 Portfolio Management

Cross-chain balances, trade history, positions — your agent sees everything. Across all 17 chains. In one call.

---

## What Makes This Different From Everything Else

**1. It actually works in production.** Not a hackathon demo. Not a "coming soon." 39 out of 42 live E2E tests pass against real endpoints with real money.

**2. Managed custody that doesn't suck.** Your agent gets its own managed wallet — EVM and Solana — derived from your master key. AES-256-CBC encryption. secp256k1 session key signing. Zero wallet popups. Zero "sign this message" friction.

**3. Built for autonomous agents.** Every SKILL.md file has an "Autonomous Agent Playbook" section. Error recovery. Backend quirk documentation. Your agent knows that `hlCloseAll` is unreliable and to use reduce-only orders instead. It knows Meteora swaps are broken and to route through Raydium. This isn't a tutorial — it's battle intelligence.

**4. MCP Server included.** Claude Desktop, Cursor, VS Code — one command and your agent has all 8 GDEX tools available.

```bash
npx @gdexsdk/mcp-server init --client claude
# Done. Your Claude can now trade crypto. Sleep tight.
```

**5. 19 modular skills.** Agent only needs spot trading? Load one skill. Need the full arsenal? Load them all. No bloat.

---

## 5 Projects That'll Make People Nervous

Here's what you can build with GDEX Skill today. Not tomorrow. Not "once we ship v2." Today.

### 1. 🤖 The 24/7 Trading Agent

An autonomous agent that monitors token sentiment on Twitter/X, checks OHLCV data via `getOHLCV()`, and executes trades when conditions align. It runs perpetually. It doesn't sleep. It doesn't panic sell. It doesn't check Reddit.

**Stack:** Claude + GDEX Skill + Twitter API + Cron
**Difficulty:** Medium
**Will it make money?** More than you refreshing CoinGecko at 2am.

### 2. 🐋 The Whale Mirror

An agent that uses `getCopyTradeWallets()` to find top Solana traders, analyzes their recent performance via trade history, and auto-copies the ones with the best hit rate. It prunes underperformers weekly.

**Stack:** GDEX Skill + scheduler + simple scoring model
**Difficulty:** Easy
**Vibe:** "If you can't beat 'em, stalk 'em and do what they do"

### 3. 📊 The Cross-Chain Arbitrage Scanner

17 chains. Same tokens, different prices. Your agent bridges assets when spreads appear, catches the arb, and bridges back. It uses `estimateBridge()` to check if the arb is even worth the gas.

**Stack:** GDEX Skill + price feed + bridge module
**Difficulty:** Hard (but satisfying)
**Warning:** You'll start talking about "basis points" at dinner parties.

### 4. 🎯 The Funding Rate Farmer

Your agent monitors HyperLiquid funding rates. When rates are extreme, it opens positions to collect funding and hedges on spot. Uses `perpDeposit()`, `hlCreateOrder()`, and `buyToken()` in coordination.

**Stack:** GDEX Skill + HL WebSocket + hedging logic
**Difficulty:** Advanced
**Feels like:** Free money (until it isn't)

### 5. 💬 The Portfolio Concierge

Hook GDEX Skill into a Telegram/Discord bot. Users ask "how's my portfolio?" and the agent responds with cross-chain balances, recent trades, open positions, and unrealized P&L. It can execute trades on command. "Buy 0.1 ETH" → done.

**Stack:** GDEX Skill + Telegram Bot API + MCP Server
**Difficulty:** Easy
**Killer feature:** Your friends will think you hired an accountant.

---

## The Tech Under the Hood

For the engineers who want to know how the sausage is made:

- **TypeScript 5.7** — strict mode, full type safety, declaration maps
- **AES-256-CBC encryption** — every managed trade is encrypted client-side
- **secp256k1 session keys** — raw signature recovery, no ethers dependency for signing
- **Dynamic ESM import** — works on Node 18, 20, and 22 without the ESM/CJS hell that plagues every other crypto SDK
- **CI/CD on GitHub Actions** — build matrix across 3 Node versions, lint, test, skill validation, MCP server build
- **Automated releases** — one click in GitHub: pick patch/minor/major, version bumps everywhere, git tag, GitHub Release with artifacts
- **91 unit tests** — every action function, crypto helper, and wallet generator is tested
- **39/42 live E2E** — tested against production endpoints with real transactions

---

## Getting Started Takes 30 Seconds

```bash
npm install @gdexsdk/gdex-skill
```

```typescript
import { GdexSkill } from '@gdexsdk/gdex-skill';

const sdk = new GdexSkill();
sdk.loginWithApiKey('your-api-key');

// Check portfolio across all chains
const portfolio = await sdk.getPortfolio({ chainId: '1' });

// Buy a token
await sdk.buyToken({
  chainId: '622112261',
  tokenAddress: 'TOKEN_MINT_ADDRESS',
  amount: '50',
  slippage: 5
});

// Open a leveraged perp position
await sdk.hlCreateOrder({
  walletAddress: '0x...',
  coin: 'ETH',
  side: 'long',
  size: '0.1',
  price: '3500',
  leverage: 10,
  orderType: 'limit'
});
```

For MCP-compatible agents (Claude, Cursor, VS Code):

```bash
npx @gdexsdk/mcp-server init --client claude
```

That's it. Your agent now has access to 8 trading tools.

---

## The Bottom Line

DeFi tooling for AI agents has been either nonexistent or so janky you'd rather ape in manually. GDEX Skill changes that.

We built the SDK. We tested it live. We documented every quirk, bug, and workaround. We gave your agent an autonomous trading playbook. We set up CI/CD. We automated releases.

Your agent can now trade across 17 chains, manage a perpetual futures book on HyperLiquid, copy whale wallets, set limit orders with take-profit and stop-loss, bridge tokens cross-chain, and monitor its entire portfolio — all without you touching a keyboard.

**The future of trading isn't human. It's the agent you build with GDEX Skill.**

---

*GDEX Skill is open source and available at [github.com/GemachDAO/gdex-skill](https://github.com/GemachDAO/gdex-skill)*

*Built with ☕ and questionable judgment by GemachDAO*

---

**Disclaimer:** This SDK gives your AI agent the power to trade with real money. If your agent goes full degen, that's between you and your risk management. We built the gun. You're the cowboy.
