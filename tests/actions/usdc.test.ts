/**
 * Tests for the unified USDC wallet actions.
 *
 * The signed payloads are decrypted and ABI-decoded with the backend's layouts
 * (gbotTradingDashboardBackend src/shared/parser/evm/decoder.ts), and the
 * signature is checked against the session public key the way the backend's
 * `beginSignedAction` does.
 */
import { GdexApiClient } from '../../src/client';
import {
  buyWithUsdc,
  sellToUsdc,
  buyWithNative,
  convertNativeToUsdc,
  estimateUsdcBridge,
  executeUsdcBridge,
  retryUsdcSell,
  getUsdcBalances,
  getUsdcTradeQuote,
  getUsdcFundingStatus,
  getUsdcConvertQuote,
  deriveMaxSourceSpendRaw,
  watchUsdcTrade,
  describeUsdcFundingStep,
} from '../../src/actions/usdc';
import {
  decryptGdexComputedData,
  generateGdexSessionKeyPair,
  buildGdexUserSessionData,
} from '../../src/utils/gdexManagedCrypto';
import { AbiCoder, SigningKey, keccak256, toUtf8Bytes } from 'ethers';

jest.mock('../../src/client');
const MockedClient = GdexApiClient as jest.MockedClass<typeof GdexApiClient>;

const apiKey = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';
const pair = generateGdexSessionKeyPair();
const creds = {
  apiKey,
  walletAddress: '0xAbCdEf0000000000000000000000000000001234',
  sessionPrivateKey: pair.sessionPrivateKey,
};
const TOKEN = '0x1111111111111111111111111111111111111111';

function decodeSigned(action: string, body: { computedData: string }, types: string[]): unknown[] {
  const payload = JSON.parse(decryptGdexComputedData(body.computedData, apiKey));
  expect(payload.userId).toBe(creds.walletAddress.toLowerCase());
  const msg = `${action}-${payload.userId}-${payload.data}`;
  const sig = payload.signature as string;
  const recovered = SigningKey.recoverPublicKey(keccak256(toUtf8Bytes(msg)), {
    r: '0x' + sig.slice(0, 64),
    s: '0x' + sig.slice(64, 128),
    v: parseInt(sig.slice(128, 130), 16) + 27,
  });
  expect(SigningKey.computePublicKey(recovered, true)).toBe(pair.sessionKey);
  return AbiCoder.defaultAbiCoder().decode(types, '0x' + payload.data).toArray().map((v) => String(v));
}

describe('unified USDC actions', () => {
  let client: jest.Mocked<GdexApiClient>;

  beforeEach(() => {
    client = new MockedClient() as jest.Mocked<GdexApiClient>;
    client.post = jest.fn().mockResolvedValue({ status: 'pending', requestId: 'r1' });
    client.get = jest.fn().mockResolvedValue({ ok: true });
  });

  it('derives the signed source budget like gdex.pro: ceil((amount + headroom) * 1.2)', () => {
    expect(deriveMaxSourceSpendRaw('1000000')).toBe('1200000');
    expect(deriveMaxSourceSpendRaw('5000000', '3000000')).toBe('9600000');
    expect(deriveMaxSourceSpendRaw('1')).toBe('2');
    expect(deriveMaxSourceSpendRaw('5')).toBe('6');
  });

  it('buyWithUsdc signs purchase_usdc_v2 with chain and budget, posts chainId', async () => {
    await buyWithUsdc(client, { ...creds, chainId: 8453, tokenAddress: TOKEN, usdcAmountRaw: '5000000', minTokenOutRaw: '42' });
    const [path, body] = (client.post as jest.Mock).mock.calls[0];
    expect(path).toBe('/v1/usdc/trade/purchase_v2');
    expect(body.chainId).toBe(8453);
    const d = decodeSigned('purchase_usdc_v2', body, ['uint64', 'string', 'uint256', 'uint256', 'bool', 'uint256', 'string']);
    expect(d.slice(0, 6)).toEqual(['8453', TOKEN, '5000000', '42', 'true', '9600000']); // + $3 EVM gas headroom
  });

  it('signs a zero budget when auto-bridge is off', async () => {
    await buyWithUsdc(client, { ...creds, chainId: 1, tokenAddress: TOKEN, usdcAmountRaw: '5000000', minTokenOutRaw: '1', autoBridge: false });
    const d = decodeSigned('purchase_usdc_v2', (client.post as jest.Mock).mock.calls[0][1], ['uint64', 'string', 'uint256', 'uint256', 'bool', 'uint256', 'string']);
    expect(d[4]).toBe('false');
    expect(d[5]).toBe('0');
  });

  it('sellToUsdc signs sell_usdc_v2 (token amount is an ABI string)', async () => {
    await sellToUsdc(client, { ...creds, chainId: 42161, tokenAddress: TOKEN, tokenAmountRaw: '1000', minUsdcOutRaw: '990000' });
    const [path, body] = (client.post as jest.Mock).mock.calls[0];
    expect(path).toBe('/v1/usdc/trade/sell_v2');
    const d = decodeSigned('sell_usdc_v2', body, ['uint64', 'string', 'string', 'uint256', 'bool', 'uint256', 'string']);
    expect(d.slice(0, 6)).toEqual(['42161', TOKEN, '1000', '990000', 'false', '0']); // sells never auto-fund
  });

  it('buyWithNative signs purchase_native_v2', async () => {
    await buyWithNative(client, { ...creds, chainId: 622112261, tokenAddress: 'So1Mint', nativeAmountRaw: '100000000', minTokenOutRaw: '7' });
    const [path, body] = (client.post as jest.Mock).mock.calls[0];
    expect(path).toBe('/v1/usdc/trade/purchase-native_v2');
    const d = decodeSigned('purchase_native_v2', body, ['uint64', 'string', 'uint256', 'uint256', 'bool', 'uint256', 'string']);
    expect(d.slice(0, 6)).toEqual(['622112261', 'So1Mint', '100000000', '7', 'true', '120000000']);
  });

  it('convertNativeToUsdc signs convert_native_usdc_v2', async () => {
    await convertNativeToUsdc(client, { ...creds, chainId: 8453, nativeAmountRaw: '1000000000000000', minUsdcOutRaw: '3000000' });
    const [path, body] = (client.post as jest.Mock).mock.calls[0];
    expect(path).toBe('/v1/usdc/convert_v2');
    const d = decodeSigned('convert_native_usdc_v2', body, ['uint64', 'uint256', 'uint256', 'string']);
    expect(d.slice(0, 3)).toEqual(['8453', '1000000000000000', '3000000']);
  });

  it('estimateUsdcBridge signs the 5-field estimate and sends the USD top-up unsigned', async () => {
    await estimateUsdcBridge(client, { ...creds, fromChainId: 8453, toChainId: 42161, amountRaw: '10000000', gasTopUp: true, gasTopUpAmountUsd: 2 });
    const [path, body] = (client.post as jest.Mock).mock.calls[0];
    expect(path).toBe('/v1/usdc/bridge/estimate');
    expect(body.chainId).toBe(8453);
    expect(body.gasTopUpAmountUsd).toBe(2);
    const d = decodeSigned('usdc_bridge_estimate', body, ['uint64', 'uint64', 'uint256', 'bool', 'string']);
    expect(d.slice(0, 4)).toEqual(['8453', '42161', '10000000', 'true']);
  });

  it('executeUsdcBridge signs the top-up in micro-USD and the max source spend', async () => {
    await executeUsdcBridge(client, { ...creds, fromChainId: 8453, toChainId: 42161, amountRaw: '10000000', gasTopUp: true, gasTopUpAmountUsd: 2, maxFromAmountRaw: '10200000' });
    const [path, body] = (client.post as jest.Mock).mock.calls[0];
    expect(path).toBe('/v1/usdc/bridge/execute-v2');
    expect(Object.keys(body)).toEqual(['computedData']);
    const d = decodeSigned('usdc_bridge_execute_v2', body, ['uint64', 'uint64', 'uint256', 'bool', 'uint256', 'uint256', 'string']);
    expect(d.slice(0, 6)).toEqual(['8453', '42161', '10000000', 'true', '2000000', '10200000']);
  });

  it('bridges to EVM add a $1 gas top-up by default; Solana destinations do not', async () => {
    await executeUsdcBridge(client, { ...creds, fromChainId: 8453, toChainId: 42161, amountRaw: '1000000', maxFromAmountRaw: '1100000' });
    let d = decodeSigned('usdc_bridge_execute_v2', (client.post as jest.Mock).mock.calls[0][1], ['uint64', 'uint64', 'uint256', 'bool', 'uint256', 'uint256', 'string']);
    expect(d.slice(3, 5)).toEqual(['true', '1000000']);
    await estimateUsdcBridge(client, { ...creds, fromChainId: 8453, toChainId: 42161, amountRaw: '1000000' });
    expect((client.post as jest.Mock).mock.calls[1][1].gasTopUpAmountUsd).toBe(1);
    await executeUsdcBridge(client, { ...creds, fromChainId: 8453, toChainId: 622112261, amountRaw: '1000000', maxFromAmountRaw: '1100000' });
    d = decodeSigned('usdc_bridge_execute_v2', (client.post as jest.Mock).mock.calls[2][1], ['uint64', 'uint64', 'uint256', 'bool', 'uint256', 'uint256', 'string']);
    expect(d.slice(3, 5)).toEqual(['false', '0']);
  });

  it('gasTopUp: false opts out', async () => {
    await estimateUsdcBridge(client, { ...creds, fromChainId: 8453, toChainId: 42161, amountRaw: '1000000', gasTopUp: false });
    const body = (client.post as jest.Mock).mock.calls[0][1];
    expect(body.gasTopUpAmountUsd).toBeUndefined();
    expect(decodeSigned('usdc_bridge_estimate', body, ['uint64', 'uint64', 'uint256', 'bool', 'string'])[3]).toBe('false');
  });

  it('executeUsdcBridge refuses a missing or zero spend cap', async () => {
    await expect(
      executeUsdcBridge(client, { ...creds, fromChainId: 8453, toChainId: 42161, amountRaw: '10000000', maxFromAmountRaw: '0' }),
    ).rejects.toThrow(/maxFromAmountRaw/);
    expect(client.post).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range gas top-up', async () => {
    await expect(
      estimateUsdcBridge(client, { ...creds, fromChainId: 8453, toChainId: 42161, amountRaw: '1', gasTopUp: true, gasTopUpAmountUsd: 51 }),
    ).rejects.toThrow(/gasTopUpAmountUsd/);
  });

  it('retryUsdcSell fills token, amount, chain and nonce from the retry capability and makes a UUID retry id', async () => {
    client.get = jest.fn().mockResolvedValue({ status: 'processing', retry: { available: true, reason: 'SAME_NONCE_RETRY_AVAILABLE', chainId: 56, tokenAddress: TOKEN, tokenAmountRaw: '4565', transactionNonce: 3, originalHash: '0x' + '1'.repeat(64) } });
    await retryUsdcSell(client, { ...creds, requestId: 'req', minUsdcOutRaw: '900' });
    const body = (client.post as jest.Mock).mock.calls[0][1];
    expect(body.chainId).toBe(56);
    const d = decodeSigned('retry_sell_usdc', body, ['uint64', 'string', 'string', 'string', 'string', 'uint256', 'uint64', 'string']);
    expect(d[0]).toBe('56');
    expect(d[2]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect([d[3], d[4], d[5], d[6]]).toEqual([TOKEN, '4565', '900', '3']);
  });

  it('retryUsdcSell refuses when no retry is available', async () => {
    client.get = jest.fn().mockResolvedValue({ status: 'processing', retry: { available: false, reason: 'RETRY_LIMIT_REACHED' } });
    await expect(retryUsdcSell(client, { ...creds, requestId: 'req', minUsdcOutRaw: '900' })).rejects.toThrow(/RETRY_LIMIT_REACHED/);
    expect(client.post).not.toHaveBeenCalled();
  });

  it('retryUsdcSell signs the 8-field retry tuple', async () => {
    await retryUsdcSell(client, { ...creds, chainId: 8453, requestId: 'req', retryId: 'rt', tokenAddress: TOKEN, tokenAmountRaw: '1000', minUsdcOutRaw: '900', transactionNonce: 17 });
    const [path, body] = (client.post as jest.Mock).mock.calls[0];
    expect(path).toBe('/v1/usdc/trade/retry_sell');
    expect(body.chainId).toBe(8453);
    const d = decodeSigned('retry_sell_usdc', body, ['uint64', 'string', 'string', 'string', 'string', 'uint256', 'uint64', 'string']);
    expect(d.slice(0, 7)).toEqual(['8453', 'req', 'rt', TOKEN, '1000', '900', '17']);
  });

  it('rejects decimal amounts instead of signing them', async () => {
    await expect(
      buyWithUsdc(client, { ...creds, chainId: 8453, tokenAddress: TOKEN, usdcAmountRaw: '5.5', minTokenOutRaw: '1' }),
    ).rejects.toThrow(/usdcAmountRaw/);
  });

  it('reads send userId + encrypted session public key', async () => {
    await getUsdcBalances(client, creds);
    expect(client.get).toHaveBeenCalledWith('/v1/usdc/balances', {
      userId: creds.walletAddress,
      data: buildGdexUserSessionData(pair.sessionKey, apiKey),
    });
  });

  it('getUsdcTradeQuote passes quote params as strings', async () => {
    await getUsdcTradeQuote(client, { ...creds, chainId: 8453, tokenAddress: TOKEN, payAsset: 'usdc', amountInRaw: '1000000', side: 'buy' });
    const [path, query] = (client.get as jest.Mock).mock.calls[0];
    expect(path).toBe('/v1/usdc/trade/quote');
    expect(query).toMatchObject({ chainId: '8453', tokenAddress: TOKEN, payAsset: 'usdc', amountInRaw: '1000000', side: 'buy' });
  });

  it('getUsdcFundingStatus and getUsdcConvertQuote map ids and amounts', async () => {
    await getUsdcFundingStatus(client, { ...creds, requestId: 'r1' });
    expect((client.get as jest.Mock).mock.calls[0]).toEqual(['/v1/usdc/funding/status', expect.objectContaining({ id: 'r1' })]);
    await getUsdcConvertQuote(client, { ...creds, chainId: 8453, amount: 'max' });
    expect((client.get as jest.Mock).mock.calls[1]).toEqual(['/v1/usdc/convert/quote', expect.objectContaining({ chainId: '8453', amount: 'max' })]);
  });

  it('watchUsdcTrade reports step changes and reads the trade result on success', async () => {
    const statuses = [
      { status: 'planning', steps: [] },
      { status: 'bridging', steps: [{ key: 'bridge', status: 'active', fromChainId: 42161, toChainId: 8453, asset: 'usdc' }] },
      { status: 'done', steps: [{ key: 'bridge', status: 'done', fromChainId: 42161, toChainId: 8453, asset: 'usdc' }, { key: 'swap', status: 'done' }] },
    ];
    client.get = jest.fn().mockImplementation(async (path: string) =>
      path.startsWith('/v1/trade-status/') ? { isSuccess: true, hash: '0xabc' } : statuses.shift());
    const updates: string[] = [];
    const r = await watchUsdcTrade(client, { ...creds, requestId: 'r1', intervalMs: 1, onUpdate: (f) => updates.push(String(f.status)) });
    expect(updates).toEqual(['planning', 'bridging', 'done']);
    expect(r.outcome).toBe('success');
    expect(r.hash).toBe('0xabc');
    expect((client.get as jest.Mock).mock.calls.at(-1)[0]).toBe('/v1/trade-status/r1');
    expect(r.steps.map(describeUsdcFundingStep)).toEqual(['bridge USDC Arbitrum -> Base: done', 'swap: done']);
  });

  it('watchUsdcTrade waits for the swap when funding reports done first', async () => {
    const trades = [{ status: 'pending' }, { status: 'success', isSuccess: true, hash: '0xswap' }];
    client.get = jest.fn().mockImplementation(async (path: string) =>
      path.startsWith('/v1/trade-status/') ? trades.shift() : { status: 'done', steps: [{ key: 'swap', status: 'active' }] });
    const r = await watchUsdcTrade(client, { ...creds, requestId: 'r1', intervalMs: 1 });
    expect(r.outcome).toBe('success');
    expect(r.hash).toBe('0xswap');
  });

  it('watchUsdcTrade returns needs_retry with the capability for a dropped sell', async () => {
    const retry = { available: true, reason: 'SAME_NONCE_RETRY_AVAILABLE', chainId: 56, tokenAddress: TOKEN, tokenAmountRaw: '1', transactionNonce: 3, originalHash: '0x' };
    client.get = jest.fn().mockResolvedValue({ requestType: 'direct', status: 'processing', finalized: false, retry });
    const r = await watchUsdcTrade(client, { ...creds, requestId: 'r1' });
    expect(r.outcome).toBe('needs_retry');
    expect(r.retry).toEqual(retry);
  });

  it('watchUsdcTrade returns failed with the error code, and pending on timeout', async () => {
    client.get = jest.fn().mockResolvedValue({ status: 'failed', errorCode: 'INSUFFICIENT_FUNDS', steps: [] });
    expect((await watchUsdcTrade(client, { ...creds, requestId: 'r1' })).outcome).toBe('failed');
    client.get = jest.fn().mockResolvedValue({ status: 'bridging', steps: [] });
    const r = await watchUsdcTrade(client, { ...creds, requestId: 'r1', intervalMs: 5, timeoutMs: 20 });
    expect(r.outcome).toBe('pending');
  });
});
