/**
 * Plain-HTTP reads from the public HyperLiquid info API.
 *
 * Reads go through here rather than `@gdexsdk/hyper-liquid-trader`: that
 * package is CommonJS and `require()`s an ESM-only dependency
 * (`@nktkas/hyperliquid` → `@noble/hashes` v2), which fails to load on Node
 * versions without `require(esm)`, and its constructor opens a WebSocket that
 * a one-off read does not need.
 */
import axios from 'axios';
import { GdexNetworkError } from './errors';

export const HL_INFO_URL = 'https://api.hyperliquid.xyz/info';

export type HlInfoBody = { type: string } & Record<string, unknown>;

/**
 * POST one request to the HyperLiquid info API and return the JSON body.
 *
 * @throws {GdexNetworkError} when HyperLiquid cannot be reached or answers with an error status
 */
export async function hlInfoRequest<T = unknown>(body: HlInfoBody): Promise<T> {
  try {
    const res = await axios.post(HL_INFO_URL, body, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
    });
    return res.data as T;
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    const reason = err instanceof Error ? err.message : String(err);
    throw new GdexNetworkError(
      `HyperLiquid info request "${body.type}" failed${status ? ` (HTTP ${status})` : ''}: ${reason}`,
    );
  }
}
