# GDEX MCP Server

The official [Model Context Protocol](https://modelcontextprotocol.io) server for [GDEX](https://gdex.pro), Gemach DAO's multi-chain trading terminal. It gives AI agents **117 tools**: 109 that execute trades and read account state, plus 8 documentation tools.

- Spot swaps on Solana, Sui and 10+ EVM chains (`buy_token`, `sell_token`, `limit_buy`, `limit_sell`)
- Hyperliquid perpetuals, including tokenized equities, FX and commodities (`open_perp_position`, `place_perp_order`, `close_perp_position`, `get_perp_positions`)
- Copy trading, cross-chain bridging, portfolio and token discovery

**The server is implemented in this directory.** The npm package [`@gemachdao/gdex-mcp-server`](https://www.npmjs.com/package/@gemachdao/gdex-mcp-server) is built from it, and it is listed in the official MCP Registry as `io.github.GemachDAO/gdex-mcp-server`.

## Source layout

| Path | What it is |
|---|---|
| [`src/index.ts`](src/index.ts) | Entry point: creates the `McpServer`, registers every tool, serves over stdio |
| [`src/tools/`](src/tools) | Tool handlers by area: `spotTrade`, `perpTrade`, `perpRead`, `limitOrders`, `copyTrade`, `hlCopyTrade`, `bridge`, `portfolio`, `managed`, `directExec`, `auth`, `v110` |
| [`src/knowledge.ts`](src/knowledge.ts) | Documentation tools: search and read the bundled GDEX skills |
| [`src/init.ts`](src/init.ts) | `init --client <name>`: writes MCP config for Claude, Cursor, VS Code, Codex, OpenCode |
| [`src/sdk.ts`](src/sdk.ts) | Shared GDEX SDK client (the SDK lives in [`../src`](../src)) |
| [`tests/`](tests) | Jest tests |
| `dist/index.js` | Prebuilt single-file bundle (`npm run build:mcp` from the repo root) |

## Run

From npm:

```bash
npx -y @gemachdao/gdex-mcp-server
```

From source (repo root):

```bash
npm ci
npm run build:mcp
node mcp-server/dist/index.js
```

With Docker, from source (repo root):

```bash
docker build -t gdex-mcp-server .
docker run -i --rm gdex-mcp-server
```

Write a client config automatically:

```bash
npx @gemachdao/gdex-mcp-server init --client claude   # or cursor, vscode, codex, opencode
```

## Configuration

| Variable | Description | Required |
|---|---|---|
| `GDEX_API_KEY` | GDEX API key; the server authenticates with it on startup | Optional |
| `GDEX_API_URL` | Override the API base URL (default `https://trade-api.gemach.io/v1`) | Optional |

## Develop

```bash
cd mcp-server
npm ci
npx tsc --noEmit
npm test
```

## License

MIT © GemachDAO. See [LICENSE](../LICENSE).
