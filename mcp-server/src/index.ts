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
  'perp-funding', 'wallet-setup',
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
  'bridge', 'auth', 'limit-order', 'perp-funding', 'full-trading-app',
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
3. **Open a position:**
\`\`\`typescript
await skill.openPerpPosition({
  coin: 'BTC', side: 'long', sizeUsd: '1000',
  leverage: 10, takeProfitPrice: '110000', stopLossPrice: '95000',
});
\`\`\`
4. **Close a position:**
\`\`\`typescript
await skill.closePerpPosition({ coin: 'BTC' }); // close 100%
\`\`\`

**Key notes:**
- \`hlCloseAll\` is unreliable — use \`closePerpPosition\` per-coin instead
- Leverage is set automatically by the backend, not via API
- All operations use \`walletAddress\` = control wallet (NOT managed)`,

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

// --- Start server ---
const transport = new StdioServerTransport();
await server.connect(transport);
