/**
 * Hand-written explain_workflow guides. Workflows without an entry here are served
 * from the matching skill (see WORKFLOW_SKILLS in index.ts).
 *
 * Every `skill.<method>(` call in these strings must be a real public GdexSkill
 * method with valid params: tests/docs/docExamples.test.ts (root jest) type-checks
 * them against the built SDK, and checks every backticked MCP tool name.
 *
 * Credentials: MCP users pass `accountRef` from `gdex_connect`; SDK users pass
 * `apiKey` / `walletAddress` (control wallet) / `sessionPrivateKey` from the managed sign-in.
 */

const MCP_CREDENTIALS = `**Credentials (MCP):** run \`gdex_connect\` once (\`{ keyFile: "~/wallet.json" }\` or \`{ create: true }\`)
and pass the returned \`accountRef\` to every trading tool. It fills \`apiKey\`, \`walletAddress\`,
\`sessionPrivateKey\` and session \`data\` locally, so no secret enters the chat.`;

const SDK_SIGN_IN = `\`\`\`typescript
import { ethers } from 'ethers';
import {
  GdexSkill, GDEX_API_KEY_PRIMARY,
  generateGdexSessionKeyPair, buildGdexSignInMessage, buildGdexSignInComputedData,
} from '@gemachdao/gdex-skill';

const skill = new GdexSkill();
const apiKey = GDEX_API_KEY_PRIMARY;
skill.loginWithApiKey(apiKey);

// Managed-custody sign-in: the control wallet signs once, the session key signs every trade.
const control = new ethers.Wallet(process.env.CONTROL_PRIVATE_KEY!);
const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();
const nonce = String(Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000));
const signature = await control.signMessage(buildGdexSignInMessage(control.address, nonce, sessionKey));
const signIn = buildGdexSignInComputedData({ apiKey, userId: control.address, sessionKey, nonce, signature });
await skill.signInWithComputedData({ computedData: signIn.computedData, chainId: 1 }); // 1 = EVM/HL, 622112261 = Solana

// walletAddress is ALWAYS the control wallet, never the managed wallet (code 103 otherwise)
const creds = { apiKey, walletAddress: control.address, sessionPrivateKey };
\`\`\``;

export const WORKFLOW_GUIDES: Record<string, string> = {
  'spot-trade': `# Spot Trading Workflow

${MCP_CREDENTIALS}

**MCP:** \`buy_token\` \`{ accountRef, chain: 8453, tokenAddress, amount: "0.01" }\`, then
\`sell_token\` \`{ chain: 8453, tokenAddress, amount: "50%" }\`. To pay with or sell into USDC on any
chain use \`usdc_buy\` / \`usdc_sell\` (see explain_workflow 'usdc-wallet').

**SDK:**

1. **Install:** \`npm install @gemachdao/gdex-skill\`
2. **Initialize and sign in:**
${SDK_SIGN_IN}
3. **Buy a token** (EVM buys with \`sessionPrivateKey\` + \`apiKey\` go through the managed purchase_v2 flow):
\`\`\`typescript
const buy = await skill.buyToken({
  chain: 8453,                 // Base; 'solana', 'sui' or any ChainId number
  tokenAddress: 'TOKEN_ADDRESS',
  amount: '0.01',              // native token to spend (0.01 ETH)
  slippage: 1,
  ...creds,
});
\`\`\`
4. **Sell a token:**
\`\`\`typescript
const sell = await skill.sellToken({
  chain: 8453,
  tokenAddress: 'TOKEN_ADDRESS',
  amount: '50%',               // or an absolute token amount like '100'
  slippage: 1,
  walletAddress: creds.walletAddress,
});
\`\`\`

**Key notes:**
- Solana chainId is \`622112261\`, not \`900\`
- Meteora-routed Solana tokens fail; Raydium-routed tokens work
- The first Solana trade on a token needs ~0.01 SOL for ATA rent and fees
- Full reference: get_trading_guide { type: 'spot' }`,

  'perp-trade': `# Perpetual Futures Workflow (HyperLiquid)

${MCP_CREDENTIALS}

**MCP:** \`perp_deposit\` \`{ accountRef, tokenAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", amount: "100" }\` →
\`open_perp_position\` \`{ accountRef, coin: "BTC", isLong: true, price: "0", size: "0.001", isMarket: true, leverage: 5 }\` →
\`get_perp_positions\` → \`close_perp_position\` \`{ accountRef, coin: "BTC" }\`.

**SDK:**

1. **Install and sign in** (sign-in chainId \`1\`):
${SDK_SIGN_IN}
2. **Deposit USDC from Arbitrum** (min 10 USDC, lands in ~10 min; the managed wallet needs amount × 1.01):
\`\`\`typescript
await skill.perpDeposit({
  tokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC on Arbitrum
  amount: '100',
  chainId: 42161,
  ...creds,
});
\`\`\`
3. **Open a position** with \`hlCreateOrder\` (there is no \`openPerpPosition\` method):
\`\`\`typescript
const mark = await skill.getHlMarkPrice('BTC');
await skill.hlCreateOrder({
  coin: 'BTC',
  isLong: true,
  price: String(mark),   // market orders: mark price (the slippage bound); '0' also resolves to mark
  size: '0.001',         // size in contracts (coin units), not USD; min order value $11
  isMarket: true,
  tpPrice: '110000',     // '' to skip
  slPrice: '95000',      // '' to skip
  leverage: 5,           // sent as a top-level field with the order
  ...creds,
});
\`\`\`
4. **Read positions** (positions live on the managed EVM wallet from sign-in):
\`\`\`typescript
const positions = await skill.getPerpPositions({ walletAddress: managedEvmAddress });
\`\`\`
5. **Close a position** (side and size are read from the live position; omit \`size\` for a full close):
\`\`\`typescript
await skill.closePerpPosition({ coin: 'BTC', positionAddress: managedEvmAddress, ...creds });
\`\`\`

**Key notes:**
- Leverage is set per order via \`leverage\` on \`hlCreateOrder\` / \`open_perp_position\`; omitted, HL uses its 20x default.
  The standalone \`hlUpdateLeverage\` / \`set_leverage\` endpoint has returned 404 in live tests.
- \`hlCloseAll\` / \`close_all_positions\` is unreliable — close per coin with \`closePerpPosition\` / \`close_perp_position\`
- Writes take \`walletAddress\` = control wallet; position reads take the managed wallet
- Builder markets (stocks, commodities) use \`dex:ASSET\`, e.g. \`xyz:NVDA\`
- Full reference: get_trading_guide { type: 'perp' }`,

  'auth': `# Authentication Workflow

**Option A — MCP (recommended for agents):** call \`gdex_connect\` with a local key file
(\`{ keyFile: "~/wallet.json" }\`) or \`{ create: true }\` for a new wallet. The server signs in, keeps the
keys under \`~/.gdex/accounts\` and returns an \`accountRef\`. Pass \`accountRef\` to every trading tool.
\`gdex_accounts\` lists connected accounts, \`gdex_disconnect\` forgets one. Never paste a private key
or seed phrase into the chat.

**Option B — SDK managed-custody sign-in:**
${SDK_SIGN_IN}

\`loginWithApiKey\` alone is enough for read-only calls (token details, trending, OHLCV, top traders).
Every trade also needs the session key from the sign-in above.

**Resolve the managed wallets** (they receive funds and hold positions):
\`\`\`typescript
import { buildGdexUserSessionData } from '@gemachdao/gdex-skill';
const data = buildGdexUserSessionData(sessionKey, apiKey);
const evm = await skill.getManagedUser({ userId: control.address, data, chainId: 1 });
const sol = await skill.getManagedUser({ userId: control.address, data, chainId: 622112261 });
\`\`\`

**Key concepts:**
- Control wallet: signs in once; it is the \`userId\` / \`walletAddress\` in every call
- Managed wallet: server-side wallet per chain family that executes trades on-chain
- Session key: secp256k1 keypair registered at sign-in; signs every trade payload
- Payloads are AES-256-CBC encrypted \`computedData\` (key/IV derived from the API key)
- Full reference: get_sdk_pattern { operation: 'auth' }`,

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

/** Workflows served from a skill's content instead of a hand-written guide. */
export const WORKFLOW_SKILLS: Record<string, string> = {
  'copy-trade': 'gdex-copy-trading',
  'perp-copy-trade': 'gdex-perp-copy-trading',
  'bridge': 'gdex-bridge',
  'limit-order': 'gdex-limit-orders',
  'perp-funding': 'gdex-perp-funding',
  'usdc-wallet': 'gdex-usdc-wallet',
};
