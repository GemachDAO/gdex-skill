import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSdk, handleToolCall } from '../sdk.js';

const hlCredentials = {
  apiKey: z.string().describe('GDEX API key for AES encryption'),
  walletAddress: z.string().describe('Control wallet address'),
  sessionPrivateKey: z.string().describe('Session private key from sign-in'),
};

export function registerPerpTradeTools(server: McpServer): void {

  // --- Write Operations (Managed Custody) ---

  server.tool(
    'open_perp_position',
    'Open a perpetual futures position on HyperLiquid (market or limit) with leverage and optional TP/SL. ' +
      'Always pass leverage: it is set with the order and, when omitted, the back-end applies the market\'s ' +
      'MAXIMUM. Margin mode is chosen by the back-end (builder-DEX `dex:ASSET` and isolated-only markets are ' +
      'isolated, the rest cross). A limit (isMarket=false) at or through the mark price is refused unless ' +
      'reduceOnly; reduceOnly + isMarket=false rests as a limit close. TP and SL attach only as a pair; edit ' +
      'them later with modify_perp_order, add a missing one with add_position_tpsl. Min order value $11.',
    {
      ...hlCredentials,
      coin: z.string().describe("Asset symbol, e.g. 'BTC', 'ETH', 'SOL'"),
      isLong: z.boolean().describe('True for long, false for short'),
      price: z.string().describe("Market: mark-price reference ('0' fetches the mark). Limit: the resting price in USD"),
      size: z.string().describe('Position size in contracts'),
      reduceOnly: z.boolean().optional().default(false).describe('Reduce-only order (with isMarket=false: a resting limit close)'),
      tpPrice: z.string().optional().default('').describe("Take-profit price in USD, '' to skip"),
      slPrice: z.string().optional().default('').describe("Stop-loss price in USD, '' to skip"),
      isMarket: z.boolean().optional().default(true).describe('True for market order, false for limit'),
      leverage: z.number().optional().describe(
        "Leverage, 1 up to the market's own maximum (higher is clamped). Set with this order; omitted = the market's MAXIMUM. " +
          "For a reduce-only order pass the position's current leverage.",
      ),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.hlCreateOrder(params as any);
    }),
  );

  server.tool(
    'place_perp_order',
    'Place a perp order on HyperLiquid without TP/SL, via /hl/create_order: isMarket=true (default) is a ' +
      'market order, isMarket=false a limit order resting at `price` (with reduceOnly=true, a limit close). ' +
      'A non-reduce-only limit at or through the mark price is refused. Pass leverage (omitted = the ' +
      "market's maximum). To close at market use close_perp_position.",
    {
      ...hlCredentials,
      coin: z.string().describe('Asset symbol'),
      isLong: z.boolean().describe('True for long, false for short'),
      price: z.string().describe("Limit price in USD; for a market order the mark reference ('0' fetches the mark)"),
      size: z.string().describe('Position size in contracts'),
      reduceOnly: z.boolean().optional().default(false),
      isMarket: z.boolean().optional().default(true).describe('True for market, false for limit'),
      leverage: z.number().optional().describe(
        "Leverage, 1 up to the market's maximum; omitted = the market's MAXIMUM. For reduceOnly pass the position's current leverage.",
      ),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      const { isMarket, ...rest } = params as any;
      // Never /hl/place_order here: that route only closes positions at market
      // (it ignores price and side), so a limit sent through it would not rest.
      return sdk.hlCreateOrder({ ...rest, isMarket: isMarket !== false, tpPrice: '', slPrice: '' });
    }),
  );

  server.tool(
    'modify_perp_order',
    'Change an open perp order on HyperLiquid: move a TP/SL trigger (triggerPrice), re-price a resting limit ' +
      '(price) or change its remaining size. Omitted fields keep their value; give at least one. The order is ' +
      'replaced, so the result carries a new orderId (retData.orderId) and the old one (previousOrderId). ' +
      'To remove a TP/SL use cancel_perp_order; to add a missing one use add_position_tpsl.',
    {
      ...hlCredentials,
      coin: z.string().describe("Asset symbol of the order; builder-DEX assets as 'dex:ASSET'"),
      orderId: z.string().describe('Order id (oid) of the open order'),
      price: z.string().optional().describe('New limit price. Leave out for a TP/SL so a market trigger keeps its execution buffer'),
      size: z.string().optional().describe("New remaining size in contracts ('0' only for a position-level TP/SL = whole position)"),
      triggerPrice: z.string().optional().describe('New trigger price; TP/SL (trigger) orders only'),
      szDecimals: z.number().optional().describe('Market size decimals (HL meta szDecimals); checks precision instead of letting the back-end round'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.hlModifyOrder(params as any);
    }),
  );

  server.tool(
    'add_position_tpsl',
    'Add a missing take-profit and/or stop-loss to an OPEN perp position on HyperLiquid (one side or both). ' +
      'Triggers are market triggers covering the whole position unless size / tpIsMarket / slIsMarket say ' +
      'otherwise. The TP trigger must be on the profit side of the mark price and the SL on the loss side. ' +
      'Refused when that side already has a trigger (use modify_perp_order) or when there is no open position.',
    {
      ...hlCredentials,
      coin: z.string().describe("Asset symbol of the open position; builder-DEX assets as 'dex:ASSET'"),
      size: z.string().optional().describe('Size the triggers cover, in contracts; omit for the whole position'),
      tpTriggerPrice: z.string().optional().describe('Take-profit trigger price; omit to add no take-profit'),
      tpPrice: z.string().optional().describe('Take-profit execution price; omit to let the back-end set it'),
      tpIsMarket: z.boolean().optional().describe('True (default) for a market trigger, false for a limit trigger'),
      slTriggerPrice: z.string().optional().describe('Stop-loss trigger price; omit to add no stop-loss'),
      slPrice: z.string().optional().describe('Stop-loss execution price; omit to let the back-end set it'),
      slIsMarket: z.boolean().optional().describe('True (default) for a market trigger, false for a limit trigger'),
      szDecimals: z.number().optional().describe('Market size decimals (HL meta szDecimals); checks precision instead of letting the back-end round'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.hlAddPositionTpsl(params as any);
    }),
  );

  server.tool(
    'close_perp_position',
    'Close (fully or partially) one perp position at MARKET, the way the gdex.pro Close button does ' +
      '(/hl/place_order). The side is read from the live HL position: a long is closed with a sell, a short ' +
      'with a buy; leverage and margin mode are left unchanged. Rejects when the position is flat/missing, ' +
      'when size exceeds it, or when a bare coin is open on several builder DEXes. A partial close must leave ' +
      'at least $11 of position. For a resting limit close use place_perp_order with reduceOnly=true, isMarket=false.',
    {
      ...hlCredentials,
      coin: z.string().describe("Asset symbol to close; builder-DEX assets as 'dex:ASSET', e.g. 'xyz:TSLA'"),
      dex: z.string().optional().describe("Builder DEX for a bare coin, e.g. 'xyz' (omit for the default dex)"),
      size: z.string().optional().describe('Size to close as a decimal string; omit to close the whole position'),
      price: z.string().optional().describe('Ignored by the back-end (it closes at its own mark price ±5%); omit it'),
      positionAddress: z.string().optional().describe(
        'Address whose HL account holds the position — normally the MANAGED wallet from sign-in. Defaults to walletAddress.',
      ),
      szDecimals: z.number().optional().describe('Market size decimals (HL meta szDecimals); rejects a size with more decimals'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.closePerpPosition(params as any);
    }),
  );

  server.tool(
    'close_all_positions',
    'Close all open perpetual positions on HyperLiquid. Known unreliable: the backend endpoint frequently ' +
      'returns TIMEOUT or 400 / JSON parse errors. Prefer close_perp_position per coin.',
    {
      ...hlCredentials,
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.hlCloseAll(params as any);
    }),
  );

  server.tool(
    'cancel_perp_order',
    'Cancel a specific open perp order on HyperLiquid.',
    {
      ...hlCredentials,
      coin: z.string().describe('Asset symbol'),
      orderId: z.string().describe('Order ID to cancel'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.hlCancelOrder(params as any);
    }),
  );

  server.tool(
    'cancel_all_perp_orders',
    'Cancel all open perp orders on HyperLiquid.',
    {
      ...hlCredentials,
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.hlCancelAllOrders(params as any);
    }),
  );

  server.tool(
    'set_leverage',
    'Deprecated, always returns an error: GDEX has no standalone leverage route (/hl/update_leverage 404). ' +
      'Leverage is set with the `leverage` field of open_perp_position / place_perp_order, applied just before that order.',
    {
      ...hlCredentials,
      coin: z.string().describe('Asset symbol'),
      leverage: z.number().describe('Unused: this tool always errors'),
      isCross: z.boolean().optional().default(true).describe('True for cross margin, false for isolated'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.hlUpdateLeverage(params as any);
    }),
  );

  server.tool(
    'perp_deposit',
    'Deposit USDC into the HyperLiquid perpetual account from Arbitrum.',
    {
      ...hlCredentials,
      tokenAddress: z.string().describe('USDC token address on Arbitrum'),
      amount: z.string().describe("USDC amount to deposit, e.g. '100'. Min 10 USDC."),
      chainId: z.number().optional().default(42161).describe('Chain ID (must be 42161 = Arbitrum)'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.perpDeposit(params as any);
    }),
  );

  server.tool(
    'perp_withdraw',
    'Withdraw USDC from the HyperLiquid perpetual account.',
    {
      ...hlCredentials,
      amount: z.string().describe('USDC amount to withdraw'),
    },
    async (params) => handleToolCall(async () => {
      const sdk = getSdk();
      return sdk.perpWithdraw(params as any);
    }),
  );
}
