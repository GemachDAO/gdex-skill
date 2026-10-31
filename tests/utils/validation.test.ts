/**
 * Tests for input validation: chain identity (GDX-07) and exact amounts (GDX-08).
 */
import {
  validateAddress,
  validateTokenAddress,
  validateAmount,
  validateChain,
  parseAmountUnits,
} from '../../src/utils/validation';
import { normalizeChain } from '../../src/config/chains';
import { buildChainAliases, toWireChain } from '../../src/utils/apiAliases';
import { GdexValidationError } from '../../src/utils/errors';
import { ChainId, SupportedChain } from '../../src/types/common';

const WSOL = 'So11111111111111111111111111111111111111112';
const USDC_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SUI_ADDR = '0x' + 'ab'.repeat(32);
const EVM_ADDR = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

describe('normalizeChain', () => {
  it('maps string and numeric Solana to the same record', () => {
    const expected = { id: ChainId.SOLANA, family: 'solana', nativeDecimals: 9 };
    expect(normalizeChain('solana')).toEqual(expected);
    expect(normalizeChain(622112261)).toEqual(expected);
    expect(normalizeChain('622112261')).toEqual(expected);
    expect(normalizeChain('Solana')).toEqual(expected);
  });

  it('maps string and numeric Sui to the same record', () => {
    const expected = { id: ChainId.SUI, family: 'sui', nativeDecimals: 9 };
    expect(normalizeChain('sui')).toEqual(expected);
    expect(normalizeChain(1313131213)).toEqual(expected);
  });

  it('maps ChainId names to EVM records', () => {
    expect(normalizeChain('base')).toEqual({ id: 8453, family: 'evm', nativeDecimals: 18 });
    expect(normalizeChain('arbitrum')).toEqual({ id: 42161, family: 'evm', nativeDecimals: 18 });
    expect(normalizeChain(ChainId.BSC)).toEqual({ id: 56, family: 'evm', nativeDecimals: 18 });
  });

  it.each(['basechain', 'mainnet', 'toString', '', '999', 'eth'])('rejects unknown chain %p', (chain) => {
    expect(() => normalizeChain(chain)).toThrow(GdexValidationError);
    expect(() => normalizeChain(chain)).toThrow(/Unsupported chain/);
  });

  it('rejects unknown numeric ids', () => {
    expect(() => normalizeChain(999)).toThrow(GdexValidationError);
    expect(() => validateChain(31337 as ChainId)).toThrow(GdexValidationError);
  });
});

describe('validateAddress / validateTokenAddress chain equivalence', () => {
  const solanaForms: SupportedChain[] = ['solana', ChainId.SOLANA];
  const suiForms: SupportedChain[] = ['sui', ChainId.SUI];

  it.each(solanaForms)('accepts wSOL under %p', (chain) => {
    expect(() => validateTokenAddress(WSOL, chain)).not.toThrow();
  });

  it.each(solanaForms)('accepts a Solana mint and wallet under %p', (chain) => {
    expect(() => validateTokenAddress(USDC_SOL, chain)).not.toThrow();
    expect(() => validateAddress(USDC_SOL, chain)).not.toThrow();
  });

  it.each(solanaForms)('rejects non-32-byte or non-base58 Solana addresses under %p', (chain) => {
    // valid alphabet and length, but decodes to 33 bytes
    expect(() => validateAddress('z'.repeat(44), chain)).toThrow(/Invalid Solana address/);
    // 32 chars of '1' decodes to 32 zero bytes is valid; 31 is too short
    expect(() => validateAddress('1'.repeat(31), chain)).toThrow(/Invalid Solana address/);
    // '0', 'O', 'I', 'l' are not base58
    expect(() => validateAddress('0' + USDC_SOL.slice(1), chain)).toThrow(/Invalid Solana address/);
    expect(() => validateAddress(EVM_ADDR, chain)).toThrow(/Invalid Solana address/);
  });

  it.each(suiForms)('treats Sui the same under %p', (chain) => {
    expect(() => validateAddress(SUI_ADDR, chain)).not.toThrow();
    expect(() => validateTokenAddress('0x2::sui::SUI', chain)).not.toThrow();
    expect(() => validateTokenAddress(SUI_ADDR, chain)).not.toThrow();
    expect(() => validateAddress(EVM_ADDR, chain)).toThrow(/Invalid Sui address/);
    expect(() => validateTokenAddress('0x2::sui', chain)).toThrow(/Invalid Sui token address/);
  });

  it('validates EVM addresses for numeric and named EVM chains', () => {
    expect(() => validateTokenAddress(EVM_ADDR, ChainId.BASE)).not.toThrow();
    expect(() => validateTokenAddress(EVM_ADDR, 'base' as SupportedChain)).not.toThrow();
    expect(() => validateTokenAddress(WSOL, ChainId.BASE)).toThrow(/Invalid EVM address/);
  });

  it('fails on an unknown chain name before checking the address', () => {
    expect(() => validateTokenAddress(EVM_ADDR, 'basechain' as SupportedChain)).toThrow(/Unsupported chain/);
  });
});

describe('toWireChain / buildChainAliases', () => {
  it('keeps legacy non-EVM strings and numeric ids, converts EVM names to ids', () => {
    expect(toWireChain('solana')).toBe('solana');
    expect(toWireChain(ChainId.SOLANA)).toBe(ChainId.SOLANA);
    expect(toWireChain('base' as SupportedChain)).toBe(8453);
    expect(buildChainAliases('arbitrum' as SupportedChain)).toEqual({ chain: 42161, chainId: 42161 });
    expect(buildChainAliases('sui')).toEqual({ chain: 'sui', chainId: ChainId.SUI });
  });
});

describe('validateAmount', () => {
  it.each(['1', '1.5', '0.5', '0.001', '100', '007', '1.0'])('accepts %p', (amount) => {
    expect(() => validateAmount(amount)).not.toThrow();
  });

  it.each(['1abc', 'Infinity', '1e3', '', '-1', '0', '0.000', '+1', '.5', '5.', ' 1', '1,000', 'NaN', '0x10', '1'.repeat(400)])(
    'rejects %p',
    (amount) => {
      expect(() => validateAmount(amount)).toThrow(GdexValidationError);
    }
  );

  it.each(['50%', '100%', '0.5%', '100.00%', '1%'])('accepts percentage %p in percent mode', (amount) => {
    expect(() => validateAmount(amount, 'amount', true)).not.toThrow();
  });

  it.each(['50oops%', '0%', '100.01%', '101%', '%', '-5%', '1e1%', '50%%', 'Infinity%'])(
    'rejects percentage %p',
    (amount) => {
      expect(() => validateAmount(amount, 'amount', true)).toThrow(GdexValidationError);
    }
  );

  it('rejects percentages when percent mode is off', () => {
    expect(() => validateAmount('50%')).toThrow(GdexValidationError);
  });
});

describe('parseAmountUnits', () => {
  it('converts 6-decimal USDC exactly', () => {
    expect(parseAmountUnits('100', 6)).toBe(100_000_000n);
    expect(parseAmountUnits('0.1', 6)).toBe(100_000n);
    expect(parseAmountUnits('1.000001', 6)).toBe(1_000_001n);
    // float math gives 4.35 * 1e6 = 4349999.999...; must be exact
    expect(parseAmountUnits('4.35', 6)).toBe(4_350_000n);
  });

  it('converts 9-decimal SOL exactly', () => {
    expect(parseAmountUnits('1', 9)).toBe(1_000_000_000n);
    expect(parseAmountUnits('0.123456789', 9)).toBe(123_456_789n);
  });

  it('converts 18-decimal amounts (ETH, BSC USDC) exactly', () => {
    expect(parseAmountUnits('1', 18)).toBe(10n ** 18n);
    expect(parseAmountUnits('0.000000000000000001', 18)).toBe(1n);
    // BSC USDC is 18 decimals; a value beyond 2^53 wei must stay exact
    expect(parseAmountUnits('12345.678901234567890123', 18)).toBe(12_345_678_901_234_567_890_123n);
  });

  it('rejects more decimal places than the token supports instead of rounding', () => {
    expect(() => parseAmountUnits('1.0000001', 6)).toThrow(/more than 6 decimal places/);
    expect(() => parseAmountUnits('0.1234567891', 9)).toThrow(GdexValidationError);
    expect(() => parseAmountUnits('1.0000000000000000001', 18)).toThrow(GdexValidationError);
  });

  it('allows trailing zeros beyond the precision', () => {
    expect(parseAmountUnits('1.50000000', 6)).toBe(1_500_000n);
  });

  it('rejects malformed amounts', () => {
    for (const bad of ['1abc', 'Infinity', '1e3', '', '-1', '0', '50%']) {
      expect(() => parseAmountUnits(bad, 6)).toThrow(GdexValidationError);
    }
  });
});
