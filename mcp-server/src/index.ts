import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { loadSkills, searchSkills, getSkillContent, getSkillFile, listSkills } from './knowledge.js';
import { WORKFLOW_GUIDES, WORKFLOW_SKILLS } from './workflowGuides.js';
import { handleInit } from './init.js';

// Execution tool registrations
import { registerAuthTools } from './tools/auth.js';
import { registerSpotTradeTools } from './tools/spotTrade.js';
import { registerPerpTradeTools } from './tools/perpTrade.js';
import { registerPerpReadTools } from './tools/perpRead.js';
import { registerDirectExecTools } from './tools/directExec.js';
import { registerLimitOrderTools } from './tools/limitOrders.js';
import { registerCopyTradeTools } from './tools/copyTrade.js';
import { registerHlCopyTradeTools } from './tools/hlCopyTrade.js';
import { registerPortfolioTools } from './tools/portfolio.js';
import { registerBridgeTools } from './tools/bridge.js';
import { registerManagedTools } from './tools/managed.js';
import { registerV110Tools } from './tools/v110.js';
import { registerUsdcTools } from './tools/usdc.js';
import { registerAccountTools } from './tools/account.js';
import { registerIntentTools } from './tools/intent.js';
import { enableAccountRefs } from './credentials.js';

// Handle init command before starting server.
// `npx -y github:GemachDAO/gdex-skill gdex-mcp-server init --client <c>` auto-selects
// the single bin and forwards the bin name as the first arg, so look past a leading
// `gdex-mcp-server` token before checking for the `init` subcommand.
const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === 'gdex-mcp-server' ? rawArgs.slice(1) : rawArgs;
if (args[0] === 'init') {
  process.exit(await handleInit(args));
}

// Report the version of the package actually installed. package.json sits one level above both
// src/index.ts and the bundled dist/index.js, and npm always ships it, so this never drifts
// from releases the way a hardcoded string did.
function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const server = new McpServer(
  { name: 'gdex-mcp-server', version: packageVersion() },
  { capabilities: { tools: {} } },
);
// Every tool taking sessionPrivateKey/privateKey/data also accepts accountRef (local secrets).
enableAccountRefs(server);

const skills = await loadSkills();

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
      const files = r.skill.files.size > 0
        ? `\n\nCompanion files (read with get_skill_file): ${[...r.skill.files.keys()].join(', ')}`
        : '';
      return `### ${r.skill.name}\n${r.skill.description}\n\nMatching sections: ${matchSections}\n\n${r.skill.content.slice(0, 1500)}${r.skill.content.length > 1500 ? '\n...(truncated)' : ''}${files}`;
    }).join('\n\n---\n\n');

    return { content: [{ type: 'text', text: output }] };
  },
);

// --- Tool: get_skill_file ---
server.tool(
  'get_skill_file',
  'Read a file that ships with a GDEX skill (e.g. gdex-token-risk scripts/token_risk.py). Omit path to list the skill\'s files.',
  {
    skill: z.string().describe('Skill name, e.g. "gdex-hl-anomaly"'),
    path: z.string().optional().describe('File path relative to the skill directory, e.g. "scripts/hl_anomaly.py"'),
  },
  async ({ skill, path }) => {
    const entry = skills.get(skill);
    if (!entry) {
      return { content: [{ type: 'text', text: `Unknown skill "${skill}". Available skills:\n${listSkills(skills).map(s => `- ${s.name}`).join('\n')}` }] };
    }
    const file = path ? getSkillFile(skills, skill, path) : null;
    if (file !== null) return { content: [{ type: 'text', text: file }] };
    const list = [...entry.files.keys()];
    const prefix = path ? `No file "${path}" in ${skill}. ` : '';
    return { content: [{ type: 'text', text: `${prefix}${list.length ? `Files in ${skill}:\n${list.map(f => `- ${f}`).join('\n')}` : `${skill} ships no companion files.`}` }] };
  },
);

// --- Tool: get_sdk_pattern ---
const SDK_OPERATIONS = [
  'spot-trade', 'perp-trade', 'copy-trade', 'perp-copy-trade',
  'bridge', 'auth', 'portfolio', 'token-discovery', 'limit-orders',
  'perp-funding', 'wallet-setup', 'usdc-wallet',
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
      'usdc-wallet': 'gdex-usdc-wallet',
    };

    const skillName = skillMap[operation];
    const content = getSkillContent(skills, skillName);
    if (!content) {
      return { content: [{ type: 'text', text: `No patterns found for operation "${operation}".` }] };
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
  'bridge', 'auth', 'limit-order', 'perp-funding', 'full-trading-app', 'usdc-wallet',
] as const;

server.tool(
  'explain_workflow',
  'Explain an end-to-end GDEX trading workflow with step-by-step instructions and code.',
  { workflow: z.enum(WORKFLOWS).describe('The workflow to explain') },
  async ({ workflow }) => {
    // Hand-written guides live in workflowGuides.ts (checked by tests/docs/docExamples.test.ts)
    if (WORKFLOW_GUIDES[workflow]) {
      return { content: [{ type: 'text', text: WORKFLOW_GUIDES[workflow] }] };
    }

    const skillName = WORKFLOW_SKILLS[workflow];
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

| Chain | ChainId | Spot DEXes | Perps | Bridge |
|-------|---------|------------|-------|--------|
| Ethereum | 1 | Uniswap v2/v3, SushiSwap v3, Odos | — | Yes |
| Optimism | 10 | Uniswap v3, Velodrome, VelodromeCL, Odos | — | Yes |
| BSC | 56 | PancakeSwap v2/v3, DyorSwap, Odos | — | Yes |
| Sonic | 146 | Shadow Exchange, Wagmi, Metropolis | — | Yes |
| Fraxtal | 252 | FraxSwap, Uniswap v3 | — | No |
| Sei | 1329 | DragonSwap v1/v2 | — | No |
| Avalanche | 43114 | TraderJoe (config present) | — | No |
| Nibiru | 6900 | DexV3 | — | No |
| Base | 8453 | Uniswap v3, BaseSwap, SushiSwap v3, Aerodrome, Odos, Arcadia Swap | — | Yes |
| Arbitrum | 42161 | Uniswap v3, Camelot v2/v3, SushiSwap v3, Odos | — | Yes |
| Berachain | 80094 | Kodiak | — | Yes |
| Solana | 622112261 | Raydium CPM/CLMM, Raydium v2, Orca, Pharaoh, SpookySwap | — | Yes |
| Sui | 1313131213 | Cetus, Bluefin, Mobius | — | Yes |
| HyperLiquid | — (Arbitrum 42161 for deposit) | — | Native perp engine + HIP-3 perp dexes | — |

Aggregators: Raydium CPM/CLMM, Uniswap V2/V3, PancakeSwap V2/V3, SushiSwap V3, Camelot V2/V3, BaseSwap, FraxSwap, Velodrome / VelodromeCL, DragonSwap V1/V2, Kodiak, TraderJoe, Pharaoh, SpookySwap, Metropolis, Shadow Exchange, Wagmi, Mobius, DyorSwap, Cetus, Bluefin, Odos, Arcadia Swap, OmniSwap (cross-chain), DexV3 (Nibiru).

**Critical notes:**
- Solana chainId is \`622112261\`, NOT \`900\` (legacy synthetic id)
- Sui chainId is \`1313131213\` (internal synthetic id)
- Managed-custody sign-in chainId: \`1\` for EVM / HyperLiquid, \`622112261\` for Solana (MCP: \`gdex_connect\` does this for you)
- \`/v1/user\` returns different managed wallets per chainId
- Solana copy trades require sign-in with \`chainId: 622112261\`
- HL perp copy trades require sign-in with \`chainId: 1\`
- HL operations (deposit, orders) use \`chainId: 42161\` (Arbitrum) for the deposit route
- HIP-3 perp DEXes: query \`/v1/hl/perp_dexes\` and pass \`dex\` parameter on read endpoints; use \`_all\` variants (clearinghouse_state_all, open_orders_all) for combined views`;

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
  'Get a complete trading guide for spot, perp, or limit order trading.',
  { type: z.enum(['spot', 'perp', 'limit']).describe('Trading type: spot, perp, or limit') },
  async ({ type }) => {
    const skillMap: Record<string, string> = {
      'spot': 'gdex-spot-trading',
      'perp': 'gdex-perp-trading',
      'limit': 'gdex-limit-orders',
    };

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

// --- Register all execution tools ---
registerAuthTools(server);
registerSpotTradeTools(server);
registerPerpTradeTools(server);
registerPerpReadTools(server);
registerDirectExecTools(server);
registerLimitOrderTools(server);
registerCopyTradeTools(server);
registerHlCopyTradeTools(server);
registerPortfolioTools(server);
registerBridgeTools(server);
registerManagedTools(server);
registerV110Tools(server);
registerUsdcTools(server);
registerAccountTools(server);
registerIntentTools(server);

// --- Start server ---
const transport = new StdioServerTransport();
await server.connect(transport);
