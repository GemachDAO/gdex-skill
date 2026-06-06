/**
 * Slippage unit conversion for the managed v2 trade endpoints.
 *
 * The SDK's public API takes slippage as a percent (e.g. `5` = 5%). The backend
 * `purchase_v2` / `sell_v2` trade worker reads the wire `slippage` as the numerator
 * of `[slippage, 10000]` (i.e. basis points), so a 5% tolerance must be sent as 500.
 * Sending the raw percent makes the effective tolerance ~100x too small, which causes
 * Raydium swaps to revert with "exceeds desired slippage limit" (custom error 0x1e).
 */
export function toBackendSlippage(percent: number): number {
  return Math.round(percent * 100);
}
