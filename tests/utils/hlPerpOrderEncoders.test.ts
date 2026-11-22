/**
 * Pins the HyperLiquid perp order action ABIs to the GDEX back-end decoder
 * (gbotTradingDashboardBackend src/shared/parser/evm/decoder.ts) and to what
 * gdex.pro encodes (UI src/utils/crypto.ts), and the signed message / payload
 * the back-end verifies: `${action}-${userIdLowercased}-${dataHexNo0x}`.
 */
import { AbiCoder, SigningKey, keccak256, toUtf8Bytes, recoverAddress, computeAddress } from 'ethers';
import {
  buildHlComputedData,
  decryptGdexComputedData,
  encodeHlActionData,
  signHlActionMessage,
} from '../../src/utils/gdexManagedCrypto';
import { GDEX_API_KEY_PRIMARY } from '../../src/config/apiKeys';

const abi = AbiCoder.defaultAbiCoder();
const no0x = (s: string) => s.replace(/^0x/, '');

/** Type lists exactly as the back-end decoder declares them. */
const BACKEND_TYPES = {
  hl_place_order: ['string', 'bool', 'string', 'string', 'bool', 'string'],
  hl_create_order: ['string', 'bool', 'string', 'string', 'bool', 'string', 'string', 'string', 'bool'],
  hl_modify_order: ['string', 'string', 'string', 'string', 'string', 'string'],
  hl_add_position_tpsl: ['string', 'string', 'string', 'string', 'string', 'bool', 'string', 'string', 'bool'],
  hl_cancel_order: ['string', 'string', 'string'],
  hl_cancel_all_orders: ['string'],
};

describe('encodeHlActionData — perp order actions, byte-for-byte', () => {
  it('hl_modify_order = [nonce, coin, orderId, price, size, triggerPrice]', () => {
    const enc = encodeHlActionData('hl_modify_order', {
      nonce: '1763800000000', coin: 'BTC', orderId: '48123456789', price: '', size: '', triggerPrice: '95000',
    });
    expect(enc).toBe(no0x(abi.encode(
      BACKEND_TYPES.hl_modify_order,
      ['1763800000000', 'BTC', '48123456789', '', '', '95000'],
    )));
    const d = abi.decode(BACKEND_TYPES.hl_modify_order, `0x${enc}`);
    expect([...d]).toEqual(['1763800000000', 'BTC', '48123456789', '', '', '95000']);
  });

  it('hl_modify_order encodes omitted fields as "" and a numeric orderId as its digits', () => {
    const enc = encodeHlActionData('hl_modify_order', { nonce: '7', coin: 'xyz:NVDA', orderId: 12345, price: '180.5' });
    expect(enc).toBe(no0x(abi.encode(BACKEND_TYPES.hl_modify_order, ['7', 'xyz:NVDA', '12345', '180.5', '', ''])));
  });

  it('hl_add_position_tpsl = [nonce, coin, size, tpTriggerPrice, tpPrice, tpIsMarket, slTriggerPrice, slPrice, slIsMarket]', () => {
    const enc = encodeHlActionData('hl_add_position_tpsl', {
      nonce: '1763800000001', coin: 'ETH', size: '1.5',
      tpTriggerPrice: '4000', tpPrice: '', tpIsMarket: true,
      slTriggerPrice: '3000', slPrice: '2990', slIsMarket: false,
    });
    expect(enc).toBe(no0x(abi.encode(
      BACKEND_TYPES.hl_add_position_tpsl,
      ['1763800000001', 'ETH', '1.5', '4000', '', true, '3000', '2990', false],
    )));
    const d = abi.decode(BACKEND_TYPES.hl_add_position_tpsl, `0x${enc}`);
    expect([...d]).toEqual(['1763800000001', 'ETH', '1.5', '4000', '', true, '3000', '2990', false]);
  });

  it('hl_add_position_tpsl: one side only, as gdex.pro sends it (unused side "" / true)', () => {
    const enc = encodeHlActionData('hl_add_position_tpsl', {
      nonce: '9', coin: 'BTC', size: '',
      tpTriggerPrice: '', tpPrice: '', tpIsMarket: true,
      slTriggerPrice: '95000', slPrice: '', slIsMarket: true,
    });
    expect(enc).toBe(no0x(abi.encode(
      BACKEND_TYPES.hl_add_position_tpsl,
      ['9', 'BTC', '', '', '', true, '95000', '', true],
    )));
  });

  it('hl_add_position_tpsl refuses non-boolean order modes (a string would decode as true)', () => {
    expect(() => encodeHlActionData('hl_add_position_tpsl', {
      nonce: '9', coin: 'BTC', size: '', tpTriggerPrice: '1', tpPrice: '', tpIsMarket: 'false',
      slTriggerPrice: '', slPrice: '', slIsMarket: true,
    })).toThrow(/must be booleans/);
  });

  it('hl_place_order = [coin, isLong, price, size, reduceOnly, nonce]', () => {
    const enc = encodeHlActionData('hl_place_order', {
      coin: 'SOL', isLong: false, price: '150.25', size: '10', reduceOnly: true, nonce: '11',
    });
    expect(enc).toBe(no0x(abi.encode(BACKEND_TYPES.hl_place_order, ['SOL', false, '150.25', '10', true, '11'])));
  });

  it('hl_create_order = [coin, isLong, price, size, reduceOnly, nonce, tpPrice, slPrice, isMarket] (no leverage inside)', () => {
    const enc = encodeHlActionData('hl_create_order', {
      coin: 'BTC', isLong: true, price: '100000', size: '0.001', reduceOnly: false, nonce: '12',
      tpPrice: '', slPrice: '', isMarket: true, leverage: 5,
    });
    expect(enc).toBe(no0x(abi.encode(
      BACKEND_TYPES.hl_create_order,
      ['BTC', true, '100000', '0.001', false, '12', '', '', true],
    )));
  });

  it('hl_cancel_order = [nonce, coin, orderId]; hl_cancel_all_orders = [nonce]', () => {
    expect(encodeHlActionData('hl_cancel_order', { nonce: '13', coin: 'BTC', orderId: '777' }))
      .toBe(no0x(abi.encode(BACKEND_TYPES.hl_cancel_order, ['13', 'BTC', '777'])));
    expect(encodeHlActionData('hl_cancel_all_orders', { nonce: '14' }))
      .toBe(no0x(abi.encode(BACKEND_TYPES.hl_cancel_all_orders, ['14'])));
  });
});

describe('signed payload for the new perp actions', () => {
  const sessionPrivateKey = '0x' + '11'.repeat(32);
  const sessionAddress = computeAddress(new SigningKey(sessionPrivateKey).publicKey);
  const walletAddress = '0xABCDef1234567890abcdef1234567890ABCDEF12';
  const apiKey = GDEX_API_KEY_PRIMARY; // public shared key

  it.each(['hl_modify_order', 'hl_add_position_tpsl'] as const)(
    '%s signs `${action}-${userIdLowercased}-${data}` with the session key (r+s+v hex)',
    (action) => {
      const data = encodeHlActionData(action, {
        nonce: '1', coin: 'BTC', orderId: '5', price: '', size: '', triggerPrice: '95000',
        tpTriggerPrice: '110000', tpPrice: '', tpIsMarket: true, slTriggerPrice: '', slPrice: '', slIsMarket: true,
      });
      const sig = signHlActionMessage(action, walletAddress, data, sessionPrivateKey);
      expect(sig).toMatch(/^[0-9a-f]{130}$/);
      const digest = keccak256(toUtf8Bytes(`${action}-${walletAddress.toLowerCase()}-${data}`));
      const recovered = recoverAddress(digest, {
        r: `0x${sig.slice(0, 64)}`, s: `0x${sig.slice(64, 128)}`, yParity: parseInt(sig.slice(128), 16) as 0 | 1,
      });
      expect(recovered).toBe(sessionAddress);
    },
  );

  it('buildHlComputedData wraps {userId, data, signature} the back-end can decrypt and decode', () => {
    const computedData = buildHlComputedData({
      action: 'hl_modify_order',
      apiKey,
      walletAddress,
      sessionPrivateKey,
      actionParams: { coin: 'BTC', orderId: '48123456789', price: '', size: '', triggerPrice: '95000' },
    });
    const payload = JSON.parse(decryptGdexComputedData(computedData, apiKey));
    expect(Object.keys(payload).sort()).toEqual(expect.arrayContaining(['data', 'signature', 'userId']));
    const d = abi.decode(BACKEND_TYPES.hl_modify_order, `0x${payload.data}`);
    expect(d[0]).toMatch(/^\d+$/); // nonce
    expect([d[1], d[2], d[3], d[4], d[5]]).toEqual(['BTC', '48123456789', '', '', '95000']);
    expect(payload.signature).toBe(signHlActionMessage('hl_modify_order', walletAddress, payload.data, sessionPrivateKey));
  });
});
