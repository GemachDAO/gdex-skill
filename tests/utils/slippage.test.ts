import { toBackendSlippage } from '../../src/utils/slippage';

describe('toBackendSlippage', () => {
  it('converts whole-percent slippage to basis points', () => {
    expect(toBackendSlippage(1)).toBe(100);
    expect(toBackendSlippage(5)).toBe(500);
    expect(toBackendSlippage(20)).toBe(2000);
  });

  it('converts fractional-percent slippage to basis points', () => {
    expect(toBackendSlippage(0.5)).toBe(50);
    expect(toBackendSlippage(2.5)).toBe(250);
  });

  it('rounds to an integer basis-point value', () => {
    expect(toBackendSlippage(0.333)).toBe(33);
    expect(Number.isInteger(toBackendSlippage(1.005))).toBe(true);
  });

  it('handles the boundary values 0 and 100', () => {
    expect(toBackendSlippage(0)).toBe(0);
    expect(toBackendSlippage(100)).toBe(10000);
  });
});
