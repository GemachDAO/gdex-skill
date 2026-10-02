# GDEX plugin for Claude Code

This plugin packages the GDEX agent skills and the GDEX MCP server from
[GemachDAO/gdex-skill](https://github.com/GemachDAO/gdex-skill) so Claude Code can trade and
read account state on [GDEX](https://gdex.pro), Gemach DAO's multi-chain trading terminal.

## What it installs

- **Skills**: every skill under `skills/` in the repository (onboarding, authentication, spot
  trading, HyperLiquid perps and funding, limit orders, copy trading, bridge, portfolio, token
  discovery and risk, transfers, React UI building blocks, SDK debugging and more).
- **MCP server**: `@gemachdao/gdex-mcp-server`, started with `npx` over stdio. It exposes tools that
  execute trades and read account state, plus documentation tools.

## What it runs and sends

- `npx -y @gemachdao/gdex-mcp-server@<version>` downloads the server from the npm registry and
  runs it locally.
- The server calls the GDEX trading API at `https://trade-api.gemach.io/v1`. Trading tools place
  real orders with real funds; review every trade before approving the tool call.
- If you set the optional **GDEX API key** when enabling the plugin, Claude Code stores it in your
  system credential store and passes it to the server as `GDEX_API_KEY`.

## Install

```
/plugin marketplace add GemachDAO/gdex-skill
/plugin install gdex@gemachdao
```

## License

MIT
