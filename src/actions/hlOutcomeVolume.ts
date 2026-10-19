/**
 * 24h volume for Hyperliquid HIP-4 outcome markets.
 *
 * Outcome coins (`#<assetId>`, normally `#<outcomeId*10 + sideIndex>`) are not present in any REST meta/ctx
 * endpoint (`metaAndAssetCtxs`, `spotMetaAndAssetCtxs`, `candleSnapshot` all omit or
 * reject them). Their `dayNtlVlm` is only published over the HyperLiquid WebSocket
 * `activeAssetCtx` subscription (delivered on the `activeSpotAssetCtx` channel). This
 * module subscribes per coin, collects the latest reading, and resolves a
 * `{ coin: volumeUsd }` map — the same source the GDEX web app uses.
 */
import { WebSocket } from 'ws';
import type { OutcomeVolume } from './hlOutcomeMarkets';
import { outcomeSideAssetId } from './hlOutcomeMarkets';

const HL_WS_URL = 'wss://api.hyperliquid.xyz/ws';

export interface OutcomeVolumeOptions {
  /** Override the HyperLiquid WS URL (mainly for tests). */
  wsUrl?: string;
  /** Max time to wait for ctx messages, in ms. Default 6000. */
  timeoutMs?: number;
}

/**
 * Side-coin name for an outcome market: `#<token>` when the side spec carries a
 * token, else `#<outcomeId*10 + sideIndex>` (backend hyperLiquidOutcomes.ts:128-141).
 */
export function outcomeSideCoin(outcomeId: string | number, sideIndex: number, token?: number): string {
  return `#${outcomeSideAssetId(Number(outcomeId), sideIndex, token)}`;
}

/** Per-coin readings plus when each arrived (epoch ms). */
export interface OutcomeVolumeReadings {
  volumes: Record<string, number>;
  receivedAt: Record<string, number>;
}

/**
 * Fetch 24h notional volume per outcome coin from the Hyperliquid WS, with the
 * arrival time of each reading. Always resolves (on completion, timeout or socket
 * error); coins that never reported are simply absent.
 */
export function fetchHlOutcomeVolumeReadings(
  coins: string[],
  options: OutcomeVolumeOptions = {},
): Promise<OutcomeVolumeReadings> {
  const wanted = new Set(coins.filter((c) => typeof c === 'string' && c.startsWith('#')));
  const out: OutcomeVolumeReadings = { volumes: {}, receivedAt: {} };
  if (wanted.size === 0) return Promise.resolve(out);

  const wsUrl = options.wsUrl ?? HL_WS_URL;
  const timeoutMs = options.timeoutMs ?? 6000;

  return new Promise((resolve) => {
    let ws: WebSocket;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* ignore close errors */
      }
      resolve(out);
    };
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      finish();
      return;
    }
    timer = setTimeout(finish, timeoutMs);

    ws.on('open', () => {
      for (const coin of wanted) {
        ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'activeAssetCtx', coin } }));
      }
    });
    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      let msg: { channel?: string; data?: { coin?: string; ctx?: { dayNtlVlm?: string | number } } };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.channel !== 'activeAssetCtx' && msg.channel !== 'activeSpotAssetCtx') return;
      const coin = msg.data?.coin;
      const rawVol = msg.data?.ctx?.dayNtlVlm;
      const vol = rawVol === undefined || rawVol === null || rawVol === '' ? NaN : Number(rawVol);
      if (typeof coin === 'string' && wanted.has(coin) && Number.isFinite(vol)) {
        out.volumes[coin] = vol;
        out.receivedAt[coin] = Date.now();
        if (Object.keys(out.volumes).length >= wanted.size) finish();
      }
    });
    ws.on('error', finish);
    ws.on('close', finish);
  });
}

/**
 * Fetch 24h notional volume (USD) per outcome-market coin from the HyperLiquid WS.
 *
 * @param coins - Outcome coin names (e.g. `["#1010", "#1011"]`); non-`#` names are ignored.
 * @param options - WS URL / timeout overrides.
 * @returns Map of `coin -> dayNtlVlm` for the coins that reported. A missing key
 *   means "no reading", never zero.
 */
export async function fetchHlOutcomeVolumes(
  coins: string[],
  options: OutcomeVolumeOptions = {},
): Promise<Record<string, number>> {
  return (await fetchHlOutcomeVolumeReadings(coins, options)).volumes;
}

/**
 * Volume for one market from per-coin readings: sums the sides that reported,
 * keeps a verified 0 as 0, and says how complete the sum is.
 */
export function computeOutcomeVolume(
  sideCoins: string[],
  coinVolumes: Record<string, number>,
  receivedAt: Record<string, number> = {},
  fallbackAsOf: number = Date.now(),
): OutcomeVolume {
  let total = 0;
  let seen = 0;
  let oldest: number | null = null;
  const missingCoins: string[] = [];
  for (const coin of sideCoins) {
    const v = coinVolumes[coin];
    if (typeof v === 'number' && Number.isFinite(v)) {
      total += v;
      seen += 1;
      const t = receivedAt[coin] ?? fallbackAsOf;
      oldest = oldest === null ? t : Math.min(oldest, t);
    } else {
      missingCoins.push(coin);
    }
  }
  const coverage: OutcomeVolume['coverage'] =
    sideCoins.length > 0 && seen === sideCoins.length ? 'complete' : seen > 0 ? 'partial' : 'unavailable';
  return {
    volume: seen > 0 ? total : null,
    asOf: oldest === null ? null : new Date(oldest).toISOString(),
    source: 'hyperliquid_ws_activeAssetCtx.dayNtlVlm',
    coverage,
    missingCoins,
  };
}

function rawSideCoins(o: Record<string, unknown>): string[] {
  const sides = (o.sideSpecs as Array<{ token?: number }> | undefined) ?? [];
  return sides.map((s, i) => outcomeSideCoin(o.outcome as string | number, i, s?.token));
}

/**
 * Attach per-market 24h volume to raw `meta.outcomes` entries.
 *
 * @param outcomes - `meta.outcomes` from `getHlOutcomes` (each has `outcome` + `sideSpecs`).
 * @param coinVolumes - Map from {@link fetchHlOutcomeVolumes}; a missing coin means "no reading".
 * @param receivedAt - Optional per-coin arrival times (from {@link fetchHlOutcomeVolumeReadings}).
 * @returns The same outcomes with `volume24h` ({ volume, asOf, source, coverage }) and the
 *   legacy `volume24hUsd` (= `volume24h.volume`: a verified 0 is 0, null only when no side reported).
 */
export function attachOutcomeVolume(
  outcomes: Array<Record<string, unknown>>,
  coinVolumes: Record<string, number>,
  receivedAt: Record<string, number> = {},
): Array<Record<string, unknown>> {
  const now = Date.now();
  return outcomes.map((o) => {
    const volume24h = computeOutcomeVolume(rawSideCoins(o), coinVolumes, receivedAt, now);
    return { ...o, volume24h, volume24hUsd: volume24h.volume };
  });
}

/** Collect every side coin across a set of outcomes. */
export function outcomeSideCoins(outcomes: Array<Record<string, unknown>>): string[] {
  const coins: string[] = [];
  for (const o of outcomes) coins.push(...rawSideCoins(o));
  return coins;
}
