/**
 * Exact decimal arithmetic on bigint, for replay and practice scoring.
 *
 * Values are fixed-point with 18 fractional digits. Add/sub/mul are exact for every
 * input Hyperliquid or a fixture can produce; division truncates toward zero at 18
 * digits. Rounding for display is half away from zero, applied only at output, so the
 * same inputs give the same strings on every host.
 */
export const SCALE = 18;
const ONE = 10n ** BigInt(SCALE);

export type Dec = bigint;

const DEC_RE = /^(-)?(\d+)(?:\.(\d+))?$/;

/** Parse a plain decimal string ("-12.5", "0.000148"). Throws on anything else. */
export function dec(s: string | number | bigint): Dec {
  if (typeof s === 'bigint') return s * ONE;
  if (typeof s === 'number') {
    if (!Number.isInteger(s)) throw new Error(`dec(): pass non-integers as strings, got ${s}`);
    return BigInt(s) * ONE;
  }
  const m = DEC_RE.exec(s.trim());
  if (!m) throw new Error(`Not a decimal: ${JSON.stringify(s)}`);
  const frac = (m[3] ?? '').slice(0, SCALE).padEnd(SCALE, '0');
  const v = BigInt(m[2]) * ONE + BigInt(frac || '0');
  return m[1] ? -v : v;
}

export const ZERO: Dec = 0n;
export const add = (a: Dec, b: Dec): Dec => a + b;
export const sub = (a: Dec, b: Dec): Dec => a - b;
export const mul = (a: Dec, b: Dec): Dec => (a * b) / ONE;
export const div = (a: Dec, b: Dec): Dec => {
  if (b === 0n) throw new Error('division by zero');
  return (a * ONE) / b;
};
export const neg = (a: Dec): Dec => -a;
export const abs = (a: Dec): Dec => (a < 0n ? -a : a);
export const min = (a: Dec, b: Dec): Dec => (a < b ? a : b);
export const max = (a: Dec, b: Dec): Dec => (a > b ? a : b);
export const isZero = (a: Dec): boolean => a === 0n;
/** basis points → fraction, e.g. bps(9.5) is not allowed; use bpsOf("9.5"). */
export const bpsOf = (s: string): Dec => div(dec(s), dec(10000));

/** Round half away from zero to `dp` places and print without exponent. */
export function fmt(a: Dec, dp = 2): string {
  const negative = a < 0n;
  let v = negative ? -a : a;
  const drop = 10n ** BigInt(SCALE - dp);
  const q = v / drop;
  const r = v % drop;
  v = r * 2n >= drop ? q + 1n : q;
  const s = v.toString().padStart(dp + 1, '0');
  const out = dp > 0 ? `${s.slice(0, -dp)}.${s.slice(-dp)}` : s;
  return negative && v !== 0n ? `-${out}` : out;
}

/** Exact representation with trailing zeros trimmed (for structured output). */
export function exact(a: Dec): string {
  const negative = a < 0n;
  const v = negative ? -a : a;
  const int = v / ONE;
  const frac = (v % ONE).toString().padStart(SCALE, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}
