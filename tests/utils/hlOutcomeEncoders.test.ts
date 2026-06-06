import { AbiCoder } from 'ethers';
import { encodeHlActionData } from '../../src/utils/gdexManagedCrypto';

const abi = AbiCoder.defaultAbiCoder();
const hex = (s: string) => (s.startsWith('0x') ? s : `0x${s}`);

describe('encodeHlActionData — outcome / HIP-3 actions', () => {
  it('encodes hl_enable_trading as [nonce]', () => {
    const enc = encodeHlActionData('hl_enable_trading', { nonce: '123' });
    expect(abi.decode(['string'], hex(enc))[0]).toBe('123');
  });

  it('encodes hl_swap_token as [fromToken, toToken, amount, nonce]', () => {
    const enc = encodeHlActionData('hl_swap_token', {
      fromToken: 'USDC', toToken: 'USDC:xyz', amount: '10', nonce: '7',
    });
    const d = abi.decode(['string', 'string', 'string', 'string'], hex(enc));
    expect([d[0], d[1], d[2], d[3]]).toEqual(['USDC', 'USDC:xyz', '10', '7']);
  });

  it('encodes hl_outcome_create_order with the 8-field schema', () => {
    const enc = encodeHlActionData('hl_outcome_create_order', {
      outcomeId: '101', coin: '#1010', isBuy: true, price: '0.1', size: '110',
      reduceOnly: false, isMarket: false, nonce: '9',
    });
    const d = abi.decode(
      ['string', 'string', 'bool', 'string', 'string', 'bool', 'bool', 'string'],
      hex(enc),
    );
    expect([d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7]]).toEqual(
      ['101', '#1010', true, '0.1', '110', false, false, '9'],
    );
  });

  it('encodes hl_outcome_cancel_order as [nonce, outcomeId, coin, orderId]', () => {
    const enc = encodeHlActionData('hl_outcome_cancel_order', {
      nonce: '5', outcomeId: '101', coin: '#1010', orderId: '460971761466',
    });
    const d = abi.decode(['string', 'string', 'string', 'string'], hex(enc));
    expect([d[0], d[1], d[2], d[3]]).toEqual(['5', '101', '#1010', '460971761466']);
  });

  it('encodes hl_outcome_close_order as [outcomeId, coin, price, size, isMarket, nonce]', () => {
    const enc = encodeHlActionData('hl_outcome_close_order', {
      outcomeId: '101', coin: '#1010', price: '0.5', size: '50', isMarket: true, nonce: '3',
    });
    const d = abi.decode(['string', 'string', 'string', 'string', 'bool', 'string'], hex(enc));
    expect([d[0], d[1], d[2], d[3], d[4], d[5]]).toEqual(['101', '#1010', '0.5', '50', true, '3']);
  });
});
