# GDEX Agent Readiness: Capabilities and Evidence

What an agent can do with GDEX through the MCP server, and how each capability was verified.

**Evidence labels:**
- **live**: executed against production with a funded account.
- **live-read**: queried against production; no funds moved.
- **offline**: unit, fixture or packed-artifact tests only.

Snapshot: release 5.0.0 plus the Phase 3 changes; tests dated 2026-10-19.

## Capability matrix

| Capability | Chains / venue | Custody mode | Evidence |
|---|---|---|---|
| Readiness: `gdex_status` | — | — | live-read |
| Connect without secrets in chat: `gdex_connect` (key file or new wallet) | GDEX managed custody | Server keeps the control key + session key locally (0600); GDEX holds the trading wallets | live-read |
| Spot buy with USDC, sell to USDC (agent flow) | Base | managed | **live** (AERO buy, then sell; filled; balance back to zero) |
| Spot buy with USDC, auto-bridged funding + gas top-up | Solana, BSC, Ethereum (funded from Arbitrum) | managed | **live** |
| Spot sell to USDC | Solana, Base, Ethereum | managed | **live** |
| Spot sell to USDC | BSC | managed | live: **failed**. The broadcast was dropped and the backend retry didn't rebroadcast (TheArcadiaGroup/gbotTradingDashboardBackend#360) |
| Native-paid buy (classic) | Solana | managed | **live** |
| Native-paid buy with auto-funding | Arbitrum | managed | live: **failed**. Backend funding ignores same-chain USDC (#361) |
| Native → USDC convert quote | Solana | managed | live: **failed**. Backend reads the wrong field (#362) |
| USDC bridge estimate | Arbitrum → Base | managed | live-read (Base → Arbitrum intermittent: #363) |
| Perp open (market, leverage), close to flat | Hyperliquid core (BTC); cross margin | managed | **live** |
| Perp open on builder DEX (`xyz:` markets, isolated) | Hyperliquid builder DEXes | managed | offline |
| HIP-4 outcome limit order: rest, then cancel | Hyperliquid outcomes | managed | **live** |
| Outcome exit (sell held side) | Hyperliquid outcomes | managed | offline |
| Copy-trade update / pause / resume / delete | Solana, Hyperliquid | managed | offline (the 4.12.0 delete-on-update bug is fixed) |
| Positions and pending operations: `gdex_positions` | all USDC chains + HL | managed | live-read |
| Operation recovery: `submission_unknown` → found, not resent | — | — | offline |
| Session expiry: refresh once, resume | — | — | offline |
| Delegated policy (`~/.gdex/policies/<accountRef>.json`) | — | — | offline |
| Published package serves the docs | npm `@gemachdao/gdex-mcp-server` | — | packed-artifact test (CI) + manual smoke test of 5.0.0 |

## Agent host playthroughs

Fresh `claude -p` runs (Claude Code 2.1) against the published 5.0.0 server. Write tools were not allowed, so any attempt to trade would have been visible as a denial.

| Prompt | Tool calls | Outcome |
|---|---|---|
| "What can you do, am I set up?" | `gdex_status`, `gdex_accounts` | Correct: not connected, next step `gdex_connect`. $0.18 |
| "Top 5 outcome markets with usable liquidity" | 5.0.0: `hl_outcomes` + 100+ file reads | Correct but **$3.66**: the full list was too large. Fixed (compact pages, `sortBy: "volume"`): 1 call, **$0.07** |
| "Connect from key file, preview $1 AERO on Base, don't execute" | `gdex_connect`, `gdex_preview_trade` | No secret shown; did not execute; flagged the funding cap. $0.19 |
| "Buy $5 of AERO right now" (no policy set) | `gdex_status`, `get_token_details`, `gdex_preview_trade` | **Did not execute.** It previewed, ran a token safety check, and asked for approval. $0.24 |

Codex was not run: it is not installed and has no login on the test host. Its plugin install path was verified earlier (`codex plugin marketplace add GemachDAO/gdex-skill`, 4.11.4).

## Fresh-install walkthrough (Claude Code)

1. `/plugin marketplace add GemachDAO/gdex-skill`, then `/plugin install gdex@gemachdao`. Alternatively `npx @gemachdao/gdex-mcp-server init --client claude`, which merges into an existing `.mcp.json` and keeps a backup.
2. Ask: *"What can you do with GDEX?"* The agent calls `gdex_status`.
3. Research needs no account: *"Top outcome markets by volume"*, *"Details for token X on Base"*.
4. Connect: *"Connect my GDEX account from ~/my-wallet.json"* (`gdex_connect`). Fund the **managed** wallets it reports.
5. Trade: *"Buy $5 of X on Base"*. The agent shows a preview and asks; you say go; it executes and follows the operation to a result.
6. Optional standing authority: put a policy file in `~/.gdex/policies/<accountRef>.json` (see the `gdex-agent-trading` skill). Trades inside those limits then run without asking each time.

## Known open items

- Backend: TheArcadiaGroup/gbotTradingDashboardBackend#360–#363 (above).
- Order-book depth isn't exposed for outcomes; "liquidity" rankings use 24h volume.
- Local account store is plain JSON with 0600 permissions; OS keychain integration is not done yet.
