import { buildChainAliases } from '../../src/utils/apiAliases';
import { ChainId } from '../../src/types/common';

describe('buildChainAliases', () => {
  it('returns empty object when chain is undefined', () => {
    expect(buildChainAliases(undefined)).toEqual({});
  });

  it('sends both chain and chainId for numeric EVM chains', () => {
    expect(buildChainAliases(ChainId.BASE)).toEqual({
      chain: ChainId.BASE,
      chainId: ChainId.BASE,
    });
  });

  it('maps the "solana" string alias to its numeric chainId', () => {
    expect(buildChainAliases('solana')).toEqual({
      chain: 'solana',
      chainId: ChainId.SOLANA,
    });
  });

  it('maps the "sui" string alias to its numeric chainId', () => {
    expect(buildChainAliases('sui')).toEqual({
      chain: 'sui',
      chainId: ChainId.SUI,
    });
  });

  it('always includes a numeric chainId the backend can filter on', () => {
    for (const chain of ['solana', 'sui', ChainId.SOLANA, ChainId.ARBITRUM] as const) {
      const aliases = buildChainAliases(chain);
      expect(typeof aliases.chainId).toBe('number');
    }
  });
});
