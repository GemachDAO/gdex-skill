import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'net';
import {
  fetchHlOutcomeVolumes,
  attachOutcomeVolume,
  outcomeSideCoin,
  outcomeSideCoins,
  computeOutcomeVolume,
  fetchHlOutcomeVolumeReadings,
} from '../../src/actions/hlOutcomeVolume';

describe('hlOutcomeVolume', () => {
  let server: WebSocketServer;
  let url: string;
  const VOL: Record<string, number> = { '#1010': 19722.38, '#1011': 11201.62 };

  beforeAll((done) => {
    server = new WebSocketServer({ port: 0 }, () => {
      url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
      done();
    });
    server.on('connection', (sock) => {
      sock.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.method === 'subscribe' && m.subscription?.type === 'activeAssetCtx') {
          const coin = m.subscription.coin as string;
          sock.send(
            JSON.stringify({
              channel: 'activeSpotAssetCtx',
              data: { coin, ctx: { dayNtlVlm: String(VOL[coin] ?? 0), midPx: '0.5' } },
            }),
          );
        }
      });
    });
  });

  afterAll((done) => server.close(() => done()));

  it('collects per-coin 24h volume from the WS feed', async () => {
    const v = await fetchHlOutcomeVolumes(['#1010', '#1011'], { wsUrl: url, timeoutMs: 3000 });
    expect(v['#1010']).toBeCloseTo(19722.38);
    expect(v['#1011']).toBeCloseTo(11201.62);
  });

  it('ignores non-# coins and short-circuits when none are requested', async () => {
    expect(await fetchHlOutcomeVolumes(['BTC', 'ETH'], { wsUrl: url, timeoutMs: 1000 })).toEqual({});
  });

  it('returns partial results on timeout (no matching ctx)', async () => {
    const v = await fetchHlOutcomeVolumes(['#9990'], { wsUrl: url, timeoutMs: 800 });
    expect(v['#9990']).toBe(0); // server replies with 0 for unknown coins
  });

  it('builds #<outcomeId><sideIndex> coin names', () => {
    expect(outcomeSideCoin(101, 0)).toBe('#1010');
    expect(outcomeSideCoin(101, 1)).toBe('#1011');
    expect(outcomeSideCoins([{ outcome: 101, sideSpecs: [{}, {}] }])).toEqual(['#1010', '#1011']);
  });

  it('attachOutcomeVolume reports coverage and keeps a verified zero as zero', () => {
    const [full] = attachOutcomeVolume([{ outcome: 101, sideSpecs: [{}, {}] }], { '#1010': 100, '#1011': 50 });
    expect(full.volume24hUsd).toBe(150);
    expect(full.volume24h).toMatchObject({ volume: 150, coverage: 'complete', source: 'hyperliquid_ws_activeAssetCtx.dayNtlVlm', missingCoins: [] });

    const [zero] = attachOutcomeVolume([{ outcome: 101, sideSpecs: [{}, {}] }], { '#1010': 0, '#1011': 0 });
    expect(zero.volume24hUsd).toBe(0);
    expect(zero.volume24h).toMatchObject({ volume: 0, coverage: 'complete' });

    const [partial] = attachOutcomeVolume([{ outcome: 101, sideSpecs: [{}, {}] }], { '#1010': 7 }, { '#1010': 1792440000000 });
    expect(partial.volume24h).toMatchObject({ volume: 7, coverage: 'partial', missingCoins: ['#1011'], asOf: new Date(1792440000000).toISOString() });

    const [none] = attachOutcomeVolume([{ outcome: 102, sideSpecs: [{}, {}] }], {});
    expect(none.volume24hUsd).toBeNull();
    expect(none.volume24h).toMatchObject({ volume: null, asOf: null, coverage: 'unavailable', missingCoins: ['#1020', '#1021'] });
  });

  it('computeOutcomeVolume treats a market with no sides as unavailable', () => {
    expect(computeOutcomeVolume([], {}).coverage).toBe('unavailable');
  });

  it('fetchHlOutcomeVolumeReadings resolves (empty) when the socket cannot connect', async () => {
    const t0 = Date.now();
    const r = await fetchHlOutcomeVolumeReadings(['#1010'], { wsUrl: 'ws://127.0.0.1:1', timeoutMs: 5000 });
    expect(r.volumes).toEqual({});
    expect(Date.now() - t0).toBeLessThan(4000);
  });

  it('uses sideSpecs token ids for coin names', () => {
    expect(outcomeSideCoins([{ outcome: 5, sideSpecs: [{ token: 100000777 }, {}] }])).toEqual(['#777', '#51']);
  });

  it('fetchHlOutcomeVolumeReadings records arrival times', async () => {
    const r = await fetchHlOutcomeVolumeReadings(['#1010'], { wsUrl: url, timeoutMs: 3000 });
    expect(typeof r.receivedAt['#1010']).toBe('number');
  });
});
