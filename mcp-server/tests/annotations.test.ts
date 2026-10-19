import { describe, it, expect } from '@jest/globals';
import { annotationsFor, enableAnnotations } from '../src/annotations.js';

describe('tool annotations', () => {
  it('classifies reads, local docs, non-financial writes and financial writes', () => {
    expect(annotationsFor('get_portfolio')).toEqual({ readOnlyHint: true, openWorldHint: true });
    expect(annotationsFor('usdc_get_trade_quote').readOnlyHint).toBe(true);
    expect(annotationsFor('search_gdex_docs')).toEqual({ readOnlyHint: true, openWorldHint: false });
    expect(annotationsFor('vote_sentiment')).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    for (const w of ['buy_token', 'sell_token', 'close_perp_position', 'usdc_execute_bridge', 'transfer_native', 'pause_copy_trade', 'delete_hl_copy_trade', 'gdex_execute_trade', 'perp_withdraw', 'hl_ref_claim']) {
      expect(annotationsFor(w)).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    }
  });

  it('unknown tools default to destructive', () => {
    expect(annotationsFor('some_future_tool')).toMatchObject({ destructiveHint: true });
  });

  it('inserts annotations only when a registration has none', () => {
    const calls: unknown[][] = [];
    const server: any = { tool: (...a: unknown[]) => calls.push(a) };
    enableAnnotations(server);
    server.tool('get_x', 'd', {}, async () => ({}));
    server.tool('buy_token', 'd', {}, { readOnlyHint: true }, async () => ({}));
    expect(calls[0][3]).toEqual({ readOnlyHint: true, openWorldHint: true });
    expect(calls[1][3]).toEqual({ readOnlyHint: true });
  });
});
