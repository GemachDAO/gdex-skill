/**
 * Tests for managed spot trading (purchase_v2 / sell_v2 / trade-status).
 *
 * Signed payloads are decrypted and decoded with the backend's layout:
 * decodeInputData('purchase' | 'sell') = ABI ['string','uint256','string'] =
 * [tokenAddress, amount, nonce] (gbotTradingDashboardBackend
 * src/shared/parser/evm/decoder.ts:35-47), signed as `${action}-${userId}-${data}`
 * and verified against the session key (ServiceMain.ts:2350-2373, 2585-2600).
 */
import { AbiCoder, SigningKey, keccak256, toUtf8Bytes } from 'ethers';
import { GdexApiClient } from '../../src/client';
import { buyToken, sellToken, waitForTrade } from '../../src/actions/spotTrade';
import { GdexApiError, GdexSubmissionUnknownError, GdexValidationError } from '../../src/utils/errors';
import { ChainId } from '../../src/types/common';
import { buildGdexReadSessionData, decryptGdexComputedData } from '../../src/utils/gdexManagedCrypto';

jest.mock('../../src/client');
const MockedClient = GdexApiClient as jest.MockedClass<typeof GdexApiClient>;

const SESSION_PK = '0x' + '11'.repeat(32);
const SESSION_PUB = SigningKey.computePublicKey(SESSION_PK, true);
const creds = {
  apiKey: 'test-api-key-00000000',
  walletAddress: '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01',
  sessionPrivateKey: SESSION_PK,
};
const BASE_TOKEN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const SOL_TOKEN = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const ACCEPTED = { requestId: 'req-1', status: 'pending', createdAt: 1700000000000 };

/** Decrypt and decode a posted computedData the way the backend does. */
function decodeSigned(body: Record<string, unknown>, action: 'purchase' | 'sell') {
  const plain = JSON.parse(decryptGdexComputedData(body.computedData as string, creds.apiKey)) as {
    userId: string; data: string; signature: string;
  };
  const [tokenAddress, amount, nonce] = AbiCoder.defaultAbiCoder().decode(['string', 'uint256', 'string'], '0x' + plain.data);
  const msg = `${action}-${plain.userId.toLowerCase()}-${plain.data}`;
  const sig = plain.signature;
  const recovered = SigningKey.recoverPublicKey(keccak256(toUtf8Bytes(msg)), {
    r: '0x' + sig.slice(0, 64),
    s: '0x' + sig.slice(64, 128),
    v: parseInt(sig.slice(128, 130), 16) + 27,
  });
  return {
    userId: plain.userId,
    tokenAddress: tokenAddress as string,
    amount: (amount as bigint).toString(),
    nonce: nonce as string,
    signer: SigningKey.computePublicKey(recovered, true),
  };
}

/** `/v1/portfolio` body shaped like getWalletHoldings (evmHelper.ts:967-1003, 1116-1158). */
function evmPortfolio(rawAmount: string, decimals = 6) {
  return {
    holding: [
      {
        amount: rawAmount,
        uiAmount: Number(rawAmount) / 10 ** decimals,
        tokenInfo: { address: BASE_TOKEN.toLowerCase(), symbol: 'USDC', name: 'USD Coin', decimals, priceUsd: 1, priceNative: 0.0003 },
        holding: 0.001,
        invested: 0.0011,
        pnlPercentage: -9.1,
      },
    ],
  };
}

describe('managed spot trading', () => {
  let client: jest.Mocked<GdexApiClient>;

  beforeEach(() => {
    client = new MockedClient() as jest.Mocked<GdexApiClient>;
    client.post = jest.fn().mockResolvedValue(ACCEPTED);
    client.get = jest.fn();
  });

  describe('buyToken', () => {
    it('signs purchase [token, native wei, nonce] and posts it to purchase_v2 with chainId', async () => {
      const result = await buyToken(client, { chain: ChainId.BASE, tokenAddress: BASE_TOKEN, amount: '0.05', ...creds });

      expect(client.post).toHaveBeenCalledTimes(1);
      const [endpoint, body] = (client.post as jest.Mock).mock.calls[0];
      expect(endpoint).toBe('/v1/purchase_v2');
      expect(Object.keys(body).sort()).toEqual(['chainId', 'computedData']);
      expect(body.chainId).toBe(8453);
      const signed = decodeSigned(body, 'purchase');
      expect(signed.tokenAddress).toBe(BASE_TOKEN);
      expect(signed.amount).toBe('50000000000000000'); // 0.05 ETH, 18 decimals, exact
      expect(signed.nonce).toMatch(/^\d+$/);
      expect(signed.userId).toBe(creds.walletAddress);
      expect(signed.signer).toBe(SESSION_PUB);
      expect(result).toEqual({
        requestId: 'req-1',
        status: 'pending',
        createdAt: 1700000000000,
        side: 'buy',
        chainId: 8453,
        tokenAddress: BASE_TOKEN,
        amountRaw: '50000000000000000',
        amountDecimals: 18,
      });
    });

    it('uses 9 native decimals on Solana and sends slippage (bps) and tip (SOL)', async () => {
      const result = await buyToken(client, {
        chain: 'solana', tokenAddress: SOL_TOKEN, amount: '0.1', slippage: 2.5, priorityFee: 1_000_000, ...creds,
      });
      const body = (client.post as jest.Mock).mock.calls[0][1];
      expect(body).toEqual(expect.objectContaining({ chainId: ChainId.SOLANA, slippage: 250, tip: 0.001 }));
      const signed = decodeSigned(body, 'purchase');
      expect(signed.amount).toBe('100000000');
      expect(signed.tokenAddress).toBe(SOL_TOKEN);
      expect(result.slippageBps).toBe(250);
      expect(result.tipSol).toBe(0.001);
    });

    it('accepts the native token as inputToken (no-op)', async () => {
      await buyToken(client, {
        chain: ChainId.BASE, tokenAddress: BASE_TOKEN, amount: '1', inputToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', ...creds,
      });
      expect(client.post).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['dex', { dex: 'uniswap-v3' }],
      ['referrer', { referrer: '0x1234567890123456789012345678901234567890' }],
      ['inputToken', { inputToken: BASE_TOKEN }],
      ['slippage', { slippage: 1 }], // EVM executor ignores request slippage
      ['priorityFee', { priorityFee: 1000 }], // Solana only
    ])('rejects %s on an EVM buy before signing', async (field, extra) => {
      await expect(buyToken(client, { chain: ChainId.BASE, tokenAddress: BASE_TOKEN, amount: '1', ...creds, ...extra } as never))
        .rejects.toMatchObject({ name: 'GdexValidationError', field });
      expect(client.post).not.toHaveBeenCalled();
    });

    it.each([
      [60, 'slippage'], [0, 'slippage'], [0.001, 'slippage'],
    ])('rejects Solana slippage %p the backend would clamp or drop', async (slippage, field) => {
      await expect(buyToken(client, { chain: 'solana', tokenAddress: SOL_TOKEN, amount: '1', slippage, ...creds }))
        .rejects.toMatchObject({ field });
      expect(client.post).not.toHaveBeenCalled();
    });

    it('rejects a tip above the backend 0.05 SOL cap and non-integer lamports', async () => {
      for (const priorityFee of [50_000_001, 1.5]) {
        await expect(buyToken(client, { chain: 'solana', tokenAddress: SOL_TOKEN, amount: '1', priorityFee, ...creds }))
          .rejects.toMatchObject({ field: 'priorityFee' });
      }
      expect(client.post).not.toHaveBeenCalled();
    });

    it.each([
      ['Sui (trading disabled)', ChainId.SUI, '0x2::sui::SUI'],
      ['Berachain (trading disabled)', ChainId.BERACHAIN, BASE_TOKEN],
      ['Polygon (not configured)', ChainId.POLYGON, BASE_TOKEN],
    ])('rejects a buy on %s before signing', async (_n, chain, token) => {
      await expect(buyToken(client, { chain, tokenAddress: token, amount: '1', ...creds }))
        .rejects.toThrow(/not supported by GDEX for managed buys/);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('requires managed credentials (purchase_v2 needs computedData)', async () => {
      await expect(buyToken(client, { chain: 'solana', tokenAddress: SOL_TOKEN, amount: '0.1' }))
        .rejects.toThrow(/Missing: walletAddress, sessionPrivateKey, apiKey/);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('rejects more than 18 decimals instead of rounding', async () => {
      await expect(buyToken(client, { chain: ChainId.BASE, tokenAddress: BASE_TOKEN, amount: '0.0000000000000000001', ...creds }))
        .rejects.toThrow(GdexValidationError);
      expect(client.post).not.toHaveBeenCalled();
    });

    it.each(['1abc', 'Infinity', '1e3', '-1', '0'])('rejects malformed buy amount %p', async (amount) => {
      await expect(buyToken(client, { chain: 'solana', tokenAddress: SOL_TOKEN, amount, ...creds })).rejects.toThrow(GdexValidationError);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('rejects an unknown chain name before posting', async () => {
      await expect(buyToken(client, { chain: 'basechain' as unknown as ChainId, tokenAddress: BASE_TOKEN, amount: '1', ...creds }))
        .rejects.toThrow(/Unsupported chain/);
    });

    it('treats a 200 without requestId as an unknown submission', async () => {
      client.post = jest.fn().mockResolvedValue({ ok: true });
      await expect(buyToken(client, { chain: ChainId.BASE, tokenAddress: BASE_TOKEN, amount: '1', ...creds }))
        .rejects.toThrow(GdexSubmissionUnknownError);
    });
  });

  describe('sellToken', () => {
    it('resolves a percentage from the managed holding with exact integer math', async () => {
      client.get = jest.fn().mockResolvedValue(evmPortfolio('123456789'));
      const result = await sellToken(client, { chain: ChainId.BASE, tokenAddress: BASE_TOKEN, amount: '33.333333%', ...creds });

      expect(client.get).toHaveBeenCalledWith('/v1/portfolio', {
        userId: creds.walletAddress,
        data: buildGdexReadSessionData(SESSION_PK, creds.apiKey),
        chainId: 8453,
      });
      const expected = ((123456789n * 33333333n) / 100000000n).toString();
      const [endpoint, body] = (client.post as jest.Mock).mock.calls[0];
      expect(endpoint).toBe('/v1/sell_v2');
      expect(body.chainId).toBe(8453);
      const signed = decodeSigned(body, 'sell');
      expect(signed.amount).toBe(expected);
      expect(signed.tokenAddress).toBe(BASE_TOKEN.toLowerCase());
      expect(signed.signer).toBe(SESSION_PUB);
      expect(result).toEqual(expect.objectContaining({ side: 'sell', requestId: 'req-1', amountRaw: expected, amountDecimals: 6, heldRaw: '123456789' }));
    });

    it('sells the exact raw balance on 100%, beyond float precision', async () => {
      const raw = '123456789012345678901234567'; // > 2^53, 18 decimals
      client.get = jest.fn().mockResolvedValue(evmPortfolio(raw, 18));
      await sellToken(client, { chain: ChainId.BASE, tokenAddress: BASE_TOKEN, amount: '100%', ...creds });
      expect(decodeSigned((client.post as jest.Mock).mock.calls[0][1], 'sell').amount).toBe(raw);
    });

    it('reads Solana holdings (numeric amount) and sells the full balance', async () => {
      // solanaBalances.ts:280-310: amount = uiAmount * 10^decimals as a JS number.
      client.get = jest.fn().mockResolvedValue({
        holding: [{ amount: 2500000, uiAmount: '2.5', tokenInfo: { address: SOL_TOKEN, symbol: 'USDC', name: 'USD Coin', decimals: 6 } }],
      });
      await sellToken(client, { chain: 'solana', tokenAddress: SOL_TOKEN, amount: '100%', slippage: 5, ...creds });
      const body = (client.post as jest.Mock).mock.calls[0][1];
      expect(body).toEqual(expect.objectContaining({ chainId: ChainId.SOLANA, slippage: 500 }));
      const signed = decodeSigned(body, 'sell');
      expect(signed.amount).toBe('2500000');
      expect(signed.tokenAddress).toBe(SOL_TOKEN);
    });

    it('converts an absolute amount with the token decimals and checks the balance', async () => {
      client.get = jest.fn().mockResolvedValue(evmPortfolio('5000000'));
      await sellToken(client, { chain: ChainId.BASE, tokenAddress: BASE_TOKEN, amount: '1.25', ...creds });
      expect(decodeSigned((client.post as jest.Mock).mock.calls[0][1], 'sell').amount).toBe('1250000');

      (client.post as jest.Mock).mockClear();
      await expect(sellToken(client, { chain: ChainId.BASE, tokenAddress: BASE_TOKEN, amount: '5.000001', ...creds }))
        .rejects.toThrow(/exceeds the held balance/);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('allows a sell on a retired chain (sell_v2 stays open there)', async () => {
      client.get = jest.fn().mockResolvedValue({ holding: [{ amount: '10', uiAmount: '0.00000001', tokenInfo: { address: '0x2::abc::ABC', decimals: 9 } }] });
      await sellToken(client, { chain: ChainId.SUI, tokenAddress: '0x2::abc::ABC', amount: '100%', ...creds });
      expect((client.post as jest.Mock).mock.calls[0][1].chainId).toBe(ChainId.SUI);
    });

    it('refuses a percentage of a token the managed wallet does not hold', async () => {
      client.get = jest.fn().mockResolvedValue({ holding: [] });
      await expect(sellToken(client, { chain: ChainId.BASE, tokenAddress: BASE_TOKEN, amount: '50%', ...creds }))
        .rejects.toThrow(/No .* balance/);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('needs tokenDecimals for an absolute amount of an unlisted token', async () => {
      client.get = jest.fn().mockResolvedValue({ holding: [] });
      await expect(sellToken(client, { chain: ChainId.BASE, tokenAddress: BASE_TOKEN, amount: '1', ...creds }))
        .rejects.toMatchObject({ field: 'tokenDecimals' });
      await sellToken(client, { chain: ChainId.BASE, tokenAddress: BASE_TOKEN, amount: '1', tokenDecimals: 6, ...creds });
      expect(decodeSigned((client.post as jest.Mock).mock.calls[0][1], 'sell').amount).toBe('1000000');
    });

    it('fails before signing when the holdings read is malformed', async () => {
      client.get = jest.fn().mockResolvedValue({ balances: [] });
      await expect(sellToken(client, { chain: ChainId.BASE, tokenAddress: BASE_TOKEN, amount: '50%', ...creds }))
        .rejects.toThrow(/Malformed \/v1\/portfolio response/);
      expect(client.post).not.toHaveBeenCalled();
    });

    it.each([
      ['outputToken', { outputToken: BASE_TOKEN }],
      ['dex', { dex: 'odos' }],
      ['slippage', { slippage: 1 }],
    ])('rejects %s on an EVM sell before reading or signing', async (field, extra) => {
      await expect(sellToken(client, { chain: ChainId.BASE, tokenAddress: BASE_TOKEN, amount: '50%', ...creds, ...extra } as never))
        .rejects.toMatchObject({ field });
      expect(client.get).not.toHaveBeenCalled();
      expect(client.post).not.toHaveBeenCalled();
    });

    it.each(['101%', '0%', '50oops%', '1.0000001%'])('rejects percentage %p', async (amount) => {
      client.get = jest.fn().mockResolvedValue(evmPortfolio('100'));
      await expect(sellToken(client, { chain: ChainId.BASE, tokenAddress: BASE_TOKEN, amount, ...creds }))
        .rejects.toThrow(GdexValidationError);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('requires managed credentials', async () => {
      await expect(sellToken(client, { chain: ChainId.BASE, tokenAddress: BASE_TOKEN, amount: '50%' }))
        .rejects.toThrow(/Missing/);
    });
  });

  describe('waitForTrade', () => {
    it('polls trade-status until success', async () => {
      client.get = jest.fn()
        .mockResolvedValueOnce({ requestId: 'req-1', status: 'pending' })
        .mockResolvedValueOnce({ requestId: 'req-1', status: 'processing' })
        .mockResolvedValueOnce({ requestId: 'req-1', status: 'success', isSuccess: true, hash: '0xh', tokenAmount: '42', ethAmount: '1000' });
      const updates: string[] = [];
      const r = await waitForTrade(client, { requestId: 'req-1', intervalMs: 1, onUpdate: (s) => updates.push(String(s.status)) });
      expect(client.get).toHaveBeenCalledWith('/v1/trade-status/req-1');
      expect(r).toEqual(expect.objectContaining({ outcome: 'filled', status: 'success', hash: '0xh', tokenAmount: '42', ethAmount: '1000' }));
      expect(updates).toEqual(['pending', 'processing', 'success']);
    });

    it('reports a failed trade', async () => {
      client.get = jest.fn().mockResolvedValue({ status: 'error', isSuccess: false, error: 'Insufficient token balance' });
      expect(await waitForTrade(client, { requestId: 'r', intervalMs: 1 })).toEqual(
        expect.objectContaining({ outcome: 'failed', error: 'Insufficient token balance' })
      );
    });

    it('returns not_found on 404 and pending on timeout', async () => {
      client.get = jest.fn().mockRejectedValue(new GdexApiError('Trade request not found or expired', 404));
      expect((await waitForTrade(client, { requestId: 'r', intervalMs: 1 })).outcome).toBe('not_found');

      client.get = jest.fn().mockResolvedValue({ status: 'processing' });
      const r = await waitForTrade(client, { requestId: 'r', intervalMs: 5, timeoutMs: 12 });
      expect(r.outcome).toBe('pending');
      expect(r.status).toBe('processing');
    });

    it('keeps polling through transient read errors', async () => {
      client.get = jest.fn()
        .mockRejectedValueOnce(new Error('socket hang up'))
        .mockResolvedValueOnce({ status: 'success', isSuccess: true });
      expect((await waitForTrade(client, { requestId: 'r', intervalMs: 1 })).outcome).toBe('filled');
    });
  });
});
