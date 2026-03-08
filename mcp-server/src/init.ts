import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

type Client = 'claude' | 'cursor' | 'vscode' | 'codex' | 'opencode';

const SUPPORTED_CLIENTS: Client[] = ['claude', 'cursor', 'vscode', 'codex', 'opencode'];

function getConfig(client: Client): { path: string; content: string } {
  const mcpEntry = {
    command: 'npx',
    args: ['@gdexsdk/mcp-server'],
  };

  switch (client) {
    case 'claude':
      return {
        path: '.mcp.json',
        content: JSON.stringify({
          mcpServers: { 'gdex-mcp-server': mcpEntry },
        }, null, 2),
      };

    case 'cursor':
      return {
        path: '.cursor/mcp.json',
        content: JSON.stringify({
          mcpServers: { 'gdex-mcp-server': mcpEntry },
        }, null, 2),
      };

    case 'vscode':
      return {
        path: '.vscode/mcp.json',
        content: JSON.stringify({
          servers: {
            'gdex-mcp-server': {
              type: 'stdio',
              command: 'npx',
              args: ['@gdexsdk/mcp-server'],
            },
          },
        }, null, 2),
      };

    case 'codex':
      return {
        path: '.codex/config.toml',
        content: `[mcp_servers.gdex-mcp-server]\ncommand = "npx"\nargs = ["@gdexsdk/mcp-server"]\n`,
      };

    case 'opencode':
      return {
        path: '.opencode/mcp.json',
        content: JSON.stringify({
          mcpServers: { 'gdex-mcp-server': mcpEntry },
        }, null, 2),
      };
  }
}

export async function handleInit(args: string[]): Promise<void> {
  const clientIdx = args.indexOf('--client');
  if (clientIdx === -1 || !args[clientIdx + 1]) {
    console.log(`Usage: gdex-mcp-server init --client <${SUPPORTED_CLIENTS.join('|')}>`);
    console.log('\nSupported clients:');
    console.log('  claude    - Claude Code (.mcp.json)');
    console.log('  cursor    - Cursor (.cursor/mcp.json)');
    console.log('  vscode    - VS Code (.vscode/mcp.json)');
    console.log('  codex     - Codex (.codex/config.toml)');
    console.log('  opencode  - OpenCode (.opencode/mcp.json)');
    process.exit(1);
  }

  const client = args[clientIdx + 1] as Client;
  if (!SUPPORTED_CLIENTS.includes(client)) {
    console.error(`Unknown client "${client}". Supported: ${SUPPORTED_CLIENTS.join(', ')}`);
    process.exit(1);
  }

  const config = getConfig(client);
  const fullPath = join(process.cwd(), config.path);
  const dir = join(process.cwd(), config.path.split('/').slice(0, -1).join('/'));

  if (dir && dir !== process.cwd()) {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  await writeFile(fullPath, config.content + '\n', 'utf-8');
  console.log(`✅ Created ${config.path} for ${client}`);
  console.log(`\nGDEX MCP server configured! Available tools:`);
  console.log('  - search_gdex_docs      Search documentation by keyword');
  console.log('  - get_sdk_pattern        Get TypeScript code patterns');
  console.log('  - get_api_info           Get API endpoint details');
  console.log('  - explain_workflow       Step-by-step trading workflows');
  console.log('  - get_chain_info         Supported chains and capabilities');
  console.log('  - get_trading_guide      Spot, perp, or limit trading guides');
  console.log('  - get_copy_trade_guide   Copy trading guides');
  console.log('  - get_component_guide    React UI component patterns');
}
