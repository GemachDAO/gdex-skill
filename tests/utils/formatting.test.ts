import { truncateDecimals } from '../../src/utils/formatting';

describe('truncateDecimals', () => {
  it('cuts extra decimals without rounding up', () => {
    expect(truncateDecimals(1.239, 2)).toBe('1.23');
    expect(truncateDecimals(0.99999, 3)).toBe('0.999');
    expect(truncateDecimals(5, 2)).toBe('5.00');
    expect(truncateDecimals(12.9, 0)).toBe('12');
  });

  it('keeps a value that already has the requested decimals', () => {
    // 1.15 * 100 is 114.99999999999999 in binary floating point.
    expect(truncateDecimals(1.15, 2)).toBe('1.15');
    expect(truncateDecimals(0.29, 2)).toBe('0.29');
    expect(truncateDecimals(4.35, 2)).toBe('4.35');
    expect(truncateDecimals(15 / 100000, 5)).toBe('0.00015');
  });

  it('handles values printed in exponent form', () => {
    expect(truncateDecimals(1e-7, 6)).toBe('0.000000');
    expect(truncateDecimals(1.5e-7, 8)).toBe('0.00000015');
    expect(truncateDecimals(1e21, 2)).toBe('1000000000000000000000.00');
    expect(truncateDecimals(1.2345e22, 1)).toBe('12345000000000000000000.0');
  });

  it('still rounds negative values down', () => {
    expect(truncateDecimals(-1.234, 2)).toBe('-1.24');
  });
});
