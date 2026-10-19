/**
 * MCP tool annotations for every tool, so clients can tell reads from writes.
 * Annotations are hints for the client UI and policy, not enforcement.
 *
 * Default is the conservative one: a tool not classified here is treated as a
 * destructive, open-world write (it can move funds or change positions).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

/** Documentation tools answer from bundled skills: no network, no side effects. */
const LOCAL_DOCS = new Set([
  'search_gdex_docs', 'explain_workflow', 'get_sdk_pattern', 'get_api_info', 'get_chain_info',
  'get_trading_guide', 'get_skill_file', 'get_component_guide', 'get_copy_trade_guide',
]);

/** Local computation or local key store reads: no network side effects. */
const LOCAL_READS = new Set(['generate_evm_wallet', 'generate_session_keypair', 'build_sign_in_payload', 'build_trade_payload', 'gdex_accounts']);

/** Network reads that only look things up (quotes, status, watchers, previews). */
const READ_PATTERN = /^(get_|usdc_get_|hl_outcomes$|hl_outcome_account$|hl_outcome_check_collateral$|hl_ref_info$|hl_builder_referral$|hl_tx_list$|hl_list_user_copy_pnl$|trending_list$|trending_options$|trending_booking_status$|managed_trade_status$|wait_for_trade$|usdc_wait_for_trade$|estimate_bridge$|usdc_estimate_bridge$|gdex_status$|gdex_positions$|gdex_preview_trade$|gdex_operation$|gdex_manage_position$|generate_pnl$)/;

/** Writes that change account settings or social data but never move funds. */
const NON_FINANCIAL_WRITES = new Set([
  'auth_login', 'oauth_login', 'managed_sign_in', 'gdex_connect', 'associate_email', 'hl_enable_trading',
  'add_comment', 'vote_sentiment', 'change_watchlist', 'import_token',
]);

export function annotationsFor(name: string): ToolAnnotations {
  if (LOCAL_DOCS.has(name) || LOCAL_READS.has(name)) return { readOnlyHint: true, openWorldHint: false };
  if (READ_PATTERN.test(name)) return { readOnlyHint: true, openWorldHint: true };
  if (NON_FINANCIAL_WRITES.has(name)) return { readOnlyHint: false, destructiveHint: false, openWorldHint: name !== 'auth_login' };
  if (name === 'gdex_disconnect') return { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
  return { readOnlyHint: false, destructiveHint: true, openWorldHint: true };
}

/** Wrap `server.tool` so registrations without annotations get them from `annotationsFor`. */
export function enableAnnotations(server: McpServer): void {
  const original = server.tool.bind(server) as (...args: unknown[]) => unknown;
  (server as unknown as { tool: (...args: unknown[]) => unknown }).tool = (...args: unknown[]) => {
    const name = args[0] as string;
    // Forms: (name, desc, shape, cb) gets annotations inserted; (name, desc, shape, annotations, cb) is kept.
    if (args.length === 4 && typeof args[1] === 'string' && typeof args[3] === 'function') {
      return original(args[0], args[1], args[2], annotationsFor(name), args[3]);
    }
    return original(...args);
  };
}
