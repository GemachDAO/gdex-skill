import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSdk, handleToolCall } from '../sdk.js';
import { listAccounts, gdexHome } from '../credentials.js';
import {
  executeTrade,
  listOperations,
  loadPolicy,
  positions,
  previewTrade,
  reconcileOperation,
  type IntentDeps,
  type TradeIntent,
} from '../intent.js';

const decimal = (what: string) => z.string().regex(/^\d+(\.\d+)?$/).describe(what);

export function defaultIntentDeps(): IntentDeps {
  return {
    sdk: getSdk,
    hlInfo: async (body) => {
      const res = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Hyperliquid info ${res.status}`);
      return res.json();
    },
    now: Date.now,
  };
}

const READ = { readOnlyHint: true, openWorldHint: true } as const;

export function registerIntentTools(server: McpServer, deps: IntentDeps = defaultIntentDeps()): void {
  server.tool(
    'gdex_status',
    'Start here. Reports version, connected accounts (no secrets), API reachability, delegated trading policy per account, pending operations, supported trade kinds, and the next setup step.',
    {},
    READ,
    async () => handleToolCall(async () => {
      const accounts = await listAccounts();
      const reach = await getSdk().client.get('/v1/status').then(() => 'ok', (e: Error) => `unreachable: ${e.message}`);
      const withPolicy = await Promise.all(accounts.map(async (a) => {
        const p = await loadPolicy(a.accountRef);
        return { ...a, policy: p ? { ...p, active: Date.parse(p.expiresAt) > Date.now() } : null };
      }));
      const pending = (await listOperations()).filter((o) => !['filled', 'failed'].includes(o.state));
      const next = !accounts.length
        ? 'Connect an account: gdex_connect { keyFile } (or { create: true }). Research tools work without one.'
        : 'Ready: gdex_preview_trade, then gdex_execute_trade. Fund the managed wallets to trade.';
      return {
        api: reach,
        accounts: withPolicy,
        pendingOperations: pending.map((o) => ({ opId: o.opId, accountRef: o.accountRef, kind: o.kind, state: o.state })),
        capabilities: {
          spot: 'Unified-USDC wallet: buy with USDC / sell to USDC on Ethereum, Optimism, BSC, Sonic, Base, Arbitrum, Solana',
          perp: 'Hyperliquid perps incl. builder DEXes (dex:COIN): open market/limit with leverage (cross margin on core perps, isolated on builder-DEX / isolated-only markets), close/reduce',
          outcomes: 'Use the hl_outcome_* tools (not yet in the preview/execute flow)',
        },
        policyFile: `${gdexHome()}/policies/<accountRef>.json (edited by the user, never by the agent)`,
        next,
      };
    }),
  );

  server.tool(
    'gdex_preview_trade',
    'Turn an explicit trade intent into exact executable terms without trading: market, side, human and raw amounts, quote source and time, minimum received or limit price, funding plan, expiry (60s). Returns a previewId for gdex_execute_trade. kind=spot (USDC wallet), perp_open, perp_close. For perps give notionalUsd (position size) or marginUsd (collateral), never guess which.',
    {
      accountRef: z.string().describe('From gdex_connect'),
      kind: z.enum(['spot', 'perp_open', 'perp_close']),
      chain: z.union([z.string(), z.number()]).optional().describe('spot: chain name or id'),
      tokenAddress: z.string().optional().describe('spot: token contract / mint'),
      side: z.enum(['buy', 'sell', 'long', 'short']).optional().describe('spot: buy|sell; perp_open: long|short'),
      amount: decimal('spot: USDC to spend (buy) or token amount (sell)').optional(),
      slippagePct: z.number().optional().describe('spot: max slippage %, default 1, max 5'),
      autoFunding: z.boolean().optional().describe('spot buy: bridge USDC/gas from other chains (default true)'),
      coin: z.string().optional().describe('perp: e.g. BTC, or xyz:TSLA for builder DEXes'),
      notionalUsd: decimal('perp_open: position size in USD').optional(),
      marginUsd: decimal('perp_open: collateral in USD').optional(),
      leverage: z.number().int().optional().describe('perp_open: leverage (backend: cross on core perps, isolated on builder-DEX markets)'),
      orderType: z.enum(['market', 'limit']).optional(),
      limitPrice: decimal('perp_open limit price').optional(),
      tpPrice: decimal('perp_open take-profit').optional(),
      slPrice: decimal('perp_open stop-loss').optional(),
      size: decimal('perp_close: contracts to close (omit = full)').optional(),
      dex: z.string().optional().describe('perp_close: builder DEX for a bare coin'),
    },
    READ,
    async (p) => handleToolCall(async () => {
      const need = (k: keyof typeof p) => { if (p[k] === undefined) throw new Error(`${String(k)} is required for kind ${p.kind}`); return p[k]; };
      let intent: TradeIntent;
      if (p.kind === 'spot') {
        const side = need('side');
        if (side !== 'buy' && side !== 'sell') throw new Error('spot side must be buy or sell');
        intent = { kind: 'spot', chain: need('chain') as string | number, tokenAddress: need('tokenAddress') as string, side, amount: need('amount') as string, slippagePct: p.slippagePct, autoFunding: p.autoFunding };
      } else if (p.kind === 'perp_open') {
        const side = need('side');
        if (side !== 'long' && side !== 'short') throw new Error('perp_open side must be long or short');
        intent = { kind: 'perp_open', coin: need('coin') as string, side, notionalUsd: p.notionalUsd, marginUsd: p.marginUsd, leverage: need('leverage') as number, orderType: p.orderType, limitPrice: p.limitPrice, tpPrice: p.tpPrice, slPrice: p.slPrice };
      } else {
        intent = { kind: 'perp_close', coin: need('coin') as string, size: p.size, dex: p.dex };
      }
      return previewTrade(deps, p.accountRef, intent);
    }),
  );

  server.tool(
    'gdex_execute_trade',
    'Execute a preview within the user\'s authority: userApproved=true only after the user approved THIS preview\'s terms; otherwise the account\'s delegated policy must allow it (else status denied). Re-quotes first: moved or expired terms return status revised with a new preview instead of trading. Returns an operation; follow it with gdex_operation. Never call again for the same intent after submission_unknown.',
    {
      previewId: z.string(),
      userApproved: z.boolean().optional().describe('True only if the user explicitly approved this exact preview'),
    },
    { destructiveHint: true, openWorldHint: true },
    async ({ previewId, userApproved }) => handleToolCall(async () => executeTrade(deps, previewId, userApproved === true)),
  );

  server.tool(
    'gdex_operation',
    'Follow or recover an operation by opId: waits for funding/fill (spot streams funding steps; perps check the live position), resolves submission_unknown by looking for the trade instead of resending, and reports needs_retry when the backend offers an in-place sell retry (usdc_retry_sell). Without opId, lists recent operations.',
    {
      opId: z.string().optional(),
      accountRef: z.string().optional().describe('List filter when no opId'),
      waitSec: z.number().optional().describe('Max seconds to wait, default 60'),
    },
    READ,
    async ({ opId, accountRef, waitSec }) => handleToolCall(async () =>
      opId ? reconcileOperation(deps, opId, (waitSec ?? 60) * 1000) : { operations: (await listOperations(accountRef)).slice(0, 20) }),
  );

  server.tool(
    'gdex_positions',
    'What the account owns and has pending: unified USDC + gas balances per chain, Hyperliquid positions on every DEX, open orders, and unfinished operations. Each section says ok or unavailable; unavailable means unknown, not empty.',
    { accountRef: z.string() },
    READ,
    async ({ accountRef }) => handleToolCall(async () => positions(deps, accountRef)),
  );

  server.tool(
    'gdex_manage_position',
    'Preview an exit for an existing position, against its live state: close/reduce a perp (reduce-only, correct side for longs and shorts) or sell a spot token back to USDC. Returns a preview; execute it with gdex_execute_trade.',
    {
      accountRef: z.string(),
      action: z.enum(['close', 'reduce', 'sell']),
      coin: z.string().optional().describe('perp coin for close/reduce'),
      size: decimal('reduce: contracts to close').optional(),
      dex: z.string().optional(),
      chain: z.union([z.string(), z.number()]).optional().describe('sell: chain'),
      tokenAddress: z.string().optional().describe('sell: token'),
      amount: decimal('sell: token amount').optional(),
      slippagePct: z.number().optional(),
    },
    READ,
    async (p) => handleToolCall(async () => {
      if (p.action === 'sell') {
        if (p.chain === undefined || !p.tokenAddress || !p.amount) throw new Error('sell needs chain, tokenAddress and amount');
        return previewTrade(deps, p.accountRef, { kind: 'spot', chain: p.chain, tokenAddress: p.tokenAddress, side: 'sell', amount: p.amount, slippagePct: p.slippagePct });
      }
      if (!p.coin) throw new Error(`${p.action} needs coin`);
      if (p.action === 'reduce' && !p.size) throw new Error('reduce needs size (use close for a full exit)');
      return previewTrade(deps, p.accountRef, { kind: 'perp_close', coin: p.coin, size: p.action === 'reduce' ? p.size : undefined, dex: p.dex });
    }),
  );
}
