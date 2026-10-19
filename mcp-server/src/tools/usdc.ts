import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSdk, handleToolCall } from '../sdk.js';

const usdcCredentials = {
  apiKey: z.string().describe('GDEX API key for AES encryption'),
  walletAddress: z.string().describe('Control wallet address'),
  sessionPrivateKey: z.string().describe('Session private key from sign-in'),
};

const usdcRaw = (what: string) => z.string().regex(/^[0-9]+$/).describe(`${what}, raw integer units`);
const usdcChainId = z.number().describe('Chain ID: 1, 10, 56, 146, 8453, 42161 or 622112261 (Solana). No USDC on Robinhood 4663 or Fraxtal 252');
const usdcAutoBridge = z.boolean().optional()
  .describe('Automatic funding (default true, as on gdex.pro): bridge USDC and top up native gas from the user\'s other chains, within maxSourceSpendRaw');
const usdcMaxSourceSpend = usdcRaw('Signed cap on total source spend for auto-funding (default ceil(amount x 1.2))').optional();

export function registerUsdcTools(server: McpServer): void {

  // --- Reads ---

  server.tool(
    'usdc_get_balances',
    'Unified USDC wallet: the user\'s USDC and native gas balance on every supported chain, plus the cross-chain USDC total.',
    { ...usdcCredentials },
    async (params) => handleToolCall(async () => getSdk().getUsdcBalances(params as any)),
  );

  server.tool(
    'usdc_get_trade_quote',
    'Executable quote for a USDC- or native-paid buy, or a sell to USDC. Returns amountOutRaw; apply slippage to get the minimum out for usdc_buy / usdc_sell.',
    {
      ...usdcCredentials,
      chainId: usdcChainId,
      tokenAddress: z.string().describe('Token to buy or sell'),
      payAsset: z.enum(['usdc', 'native']).describe('What the buy is paid with'),
      amountInRaw: usdcRaw('Amount in: USDC/native on a buy, token on a sell'),
      side: z.enum(['buy', 'sell']).optional().describe('Default buy'),
    },
    async (params) => handleToolCall(async () => getSdk().getUsdcTradeQuote(params as any)),
  );

  server.tool(
    'usdc_get_funding_status',
    'Status of a USDC trade or its auto-funding (bridge legs, confirmation, failure reason). Poll with the requestId a trade returned. If it returns a retry capability for a stuck sell, use usdc_retry_sell.',
    { ...usdcCredentials, requestId: z.string().describe('requestId returned by a USDC trade') },
    async (params) => handleToolCall(async () => getSdk().getUsdcFundingStatus(params as any)),
  );

  server.tool(
    'usdc_get_deferred_trade',
    'Status and funding steps of a deferred (auto-bridged) USDC trade, by tradeId.',
    { ...usdcCredentials, tradeId: z.string().describe('Deferred trade id') },
    async (params) => handleToolCall(async () => getSdk().getUsdcDeferredTrade(params as any)),
  );

  server.tool(
    'usdc_get_pending_trades',
    'Pending USDC trades on a chain. Check before resubmitting any trade whose outcome is unknown; never resubmit while one is pending.',
    { ...usdcCredentials, chainId: usdcChainId },
    async (params) => handleToolCall(async () => getSdk().getUsdcPendingTrades(params as any)),
  );

  server.tool(
    'usdc_get_convert_quote',
    'Quote converting the chain\'s native gas token to USDC, keeping a gas reserve. amount is raw native or "max".',
    { ...usdcCredentials, chainId: usdcChainId, amount: z.string().describe('Raw native amount, or "max"') },
    async (params) => handleToolCall(async () => getSdk().getUsdcConvertQuote(params as any)),
  );

  server.tool(
    'usdc_get_bridge_status',
    'Status of a USDC bridge by id. refresh=true polls the bridge provider once.',
    { ...usdcCredentials, bridgeId: z.string().describe('Bridge id from usdc_execute_bridge'), refresh: z.boolean().optional() },
    async (params) => handleToolCall(async () => getSdk().getUsdcBridgeStatus(params as any)),
  );

  server.tool(
    'usdc_get_bridge_orders',
    'The user\'s USDC bridge history.',
    { ...usdcCredentials },
    async (params) => handleToolCall(async () => getSdk().getUsdcBridgeOrders(params as any)),
  );

  // --- Writes (signed, managed custody) ---

  server.tool(
    'usdc_buy',
    'Buy a token paying with USDC. Automatic funding is on by default: GDEX bridges USDC and tops up gas from the user\'s other chains when this chain is short, capped by the signed maxSourceSpendRaw. A pending result returns a requestId for usdc_get_funding_status.',
    {
      ...usdcCredentials,
      chainId: usdcChainId,
      tokenAddress: z.string().describe('Token to buy'),
      usdcAmountRaw: usdcRaw('USDC to spend (6 decimals; 18 on BSC)'),
      minTokenOutRaw: usdcRaw('Minimum token out (from usdc_get_trade_quote minus slippage)'),
      autoBridge: usdcAutoBridge,
      maxSourceSpendRaw: usdcMaxSourceSpend,
    },
    async (params) => handleToolCall(async () => getSdk().buyWithUsdc(params as any)),
  );

  server.tool(
    'usdc_sell',
    'Sell a token and receive USDC into the unified USDC wallet.',
    {
      ...usdcCredentials,
      chainId: usdcChainId,
      tokenAddress: z.string().describe('Token to sell'),
      tokenAmountRaw: usdcRaw('Token amount to sell'),
      minUsdcOutRaw: usdcRaw('Minimum USDC out (from usdc_get_trade_quote minus slippage)'),
      autoBridge: usdcAutoBridge,
      maxSourceSpendRaw: usdcMaxSourceSpend,
    },
    async (params) => handleToolCall(async () => getSdk().sellToUsdc(params as any)),
  );

  server.tool(
    'usdc_buy_with_native',
    'Buy a token paying with the chain\'s native token (ETH, BNB, SOL...). Auto-bridge from other chains is on by default, as on gdex.pro.',
    {
      ...usdcCredentials,
      chainId: usdcChainId,
      tokenAddress: z.string().describe('Token to buy'),
      nativeAmountRaw: usdcRaw('Native amount to spend (18 decimals EVM, 9 Solana)'),
      minTokenOutRaw: usdcRaw('Minimum token out'),
      autoBridge: usdcAutoBridge,
      maxSourceSpendRaw: usdcMaxSourceSpend,
    },
    async (params) => handleToolCall(async () => getSdk().buyWithNative(params as any)),
  );

  server.tool(
    'usdc_retry_sell',
    'Retry a stuck USDC sell in place, reusing its transaction nonce so it cannot execute twice. Only when usdc_get_funding_status returned a retry capability; take retryId and transactionNonce from it.',
    {
      ...usdcCredentials,
      chainId: usdcChainId,
      requestId: z.string().describe('Original sell requestId'),
      retryId: z.string().describe('retry.retryId from funding status'),
      tokenAddress: z.string(),
      tokenAmountRaw: usdcRaw('Token amount'),
      minUsdcOutRaw: usdcRaw('Minimum USDC out'),
      transactionNonce: z.number().describe('retry.transactionNonce from funding status'),
    },
    async (params) => handleToolCall(async () => getSdk().retryUsdcSell(params as any)),
  );

  server.tool(
    'usdc_convert_native',
    'Convert the chain\'s native gas token to USDC, keeping a per-chain gas reserve. Get amounts from usdc_get_convert_quote.',
    {
      ...usdcCredentials,
      chainId: usdcChainId,
      nativeAmountRaw: usdcRaw('Native amount to convert'),
      minUsdcOutRaw: usdcRaw('Minimum USDC out'),
    },
    async (params) => handleToolCall(async () => getSdk().convertNativeToUsdc(params as any)),
  );

  server.tool(
    'usdc_estimate_bridge',
    'Quote moving USDC between chains (Relay). amountRaw is what arrives on the destination. The response fromAmountRaw is the source spend to cap usdc_execute_bridge with.',
    {
      ...usdcCredentials,
      fromChainId: usdcChainId.describe('Source chain ID'),
      toChainId: usdcChainId.describe('Destination chain ID'),
      amountRaw: usdcRaw('USDC to deliver on the destination'),
      gasTopUp: z.boolean().optional().describe('Destination gas top-up; default on for EVM destinations, off for Solana. Its cost is in the estimate'),
      gasTopUpAmountUsd: z.number().optional().describe('Gas top-up in USD, up to 50 (default 1)'),
    },
    async (params) => handleToolCall(async () => getSdk().estimateUsdcBridge(params as any)),
  );

  server.tool(
    'usdc_execute_bridge',
    'Move USDC between chains. maxFromAmountRaw is the signed maximum source spend: use the estimate\'s fromAmountRaw plus a small headroom. Poll usdc_get_bridge_status with the returned id.',
    {
      ...usdcCredentials,
      fromChainId: usdcChainId.describe('Source chain ID'),
      toChainId: usdcChainId.describe('Destination chain ID'),
      amountRaw: usdcRaw('USDC to deliver on the destination'),
      maxFromAmountRaw: usdcRaw('Signed maximum source spend'),
      gasTopUp: z.boolean().optional().describe('Destination gas top-up; default on for EVM destinations, off for Solana. Its cost is in the estimate'),
      gasTopUpAmountUsd: z.number().optional().describe('Gas top-up in USD, up to 50 (default 1)'),
    },
    async (params) => handleToolCall(async () => getSdk().executeUsdcBridge(params as any)),
  );
}
