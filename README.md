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

**AI Agent Skill for [GDEX Pro](https://gdex.pro)** — the self-custody trading terminal by [Gemach](https://gemach.io)  
Cross-chain spot · HyperLiquid perps · Copy trading · Portfolio · Token discovery · Managed custody

[![npm version](https://img.shields.io/npm/v/@gdexsdk/gdex-skill.svg?style=for-the-badge)](https://www.npmjs.com/package/@gdexsdk/gdex-skill)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-F7DF1E.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![skills.sh](https://img.shields.io/badge/skills.sh-compatible-8B5CF6.svg?style=for-the-badge)](https://skills.sh)
[![Tests](https://img.shields.io/badge/tests-103%20passing-22C55E.svg?style=for-the-badge)](#testing)

</div>


---

## Why agents use GDEX

GDEX is the trading surface. This skill is how AI agents (Claude, Cursor, Codex, and 40+ others) install and trade on it — spot, perps, copy-trade, and bridge — without building their own exchange stack.

**Fastest path for an agent:**

```bash
npx skills add GemachDAO/gdex-skill --all --agent '*' -g
```

Then open [gdex.pro](https://gdex.pro) for the human terminal, or run the [MCP server](#-mcp-server) so the agent can execute trades itself.

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

## Testing

All 103 tests run with **mocked HTTP** — no real API key or network connection required:

```bash
npm test              # run all 103 tests
npm run test:coverage # with coverage report
npm run verify        # offline SDK smoke-test (20 checks)
npm run verify:managed # managed-custody payload validation (dry-run)
```

## License

MIT © [GemachDAO](https://github.com/GemachDAO)
