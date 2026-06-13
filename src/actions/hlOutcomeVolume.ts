/**
 * 24h volume for HyperLiquid outcome (HIP-3 prediction) markets.
 *
 * Outcome coins (`#<outcomeId><sideIndex>`) are not present in any REST meta/ctx
 * endpoint (`metaAndAssetCtxs`, `spotMetaAndAssetCtxs`, `candleSnapshot` all omit or
 * reject them). Their `dayNtlVlm` is only published over the HyperLiquid WebSocket
 * `activeAssetCtx` subscription (delivered on the `activeSpotAssetCtx` channel). This
 * module subscribes per coin, collects the latest reading, and resolves a
 * `{ coin: volumeUsd }` map — the same source the GDEX web app uses.
 */
import { WebSocket } from 'ws';

const HL_WS_URL = 'wss://api.hyperliquid.xyz/ws';

export interface OutcomeVolumeOptions {
  /** Override the HyperLiquid WS URL (mainly for tests). */
  wsUrl?: string;
  /** Max time to wait for ctx messages, in ms. Default 6000. */
  timeoutMs?: number;
}

/** Side-coin name for an outcome market: `#<outcomeId><sideIndex>`. */
export function outcomeSideCoin(outcomeId: string | number, sideIndex: number): string {
  return `#${outcomeId}${sideIndex}`;
}

/**
 * Fetch 24h notional volume (USD) per outcome-market coin from the HyperLiquid WS.
 *
 * @param coins - Outcome coin names (e.g. `["#1010", "#1011"]`); non-`#` names are ignored.
 * @param options - WS URL / timeout overrides.
 * @returns Map of `coin -> dayNtlVlm`. Resolves as soon as every coin has reported or on timeout.
 */
export function fetchHlOutcomeVolumes(
  coins: string[],
  options: OutcomeVolumeOptions = {},
): Promise<Record<string, number>> {
  const wanted = new Set(coins.filter((c) => typeof c === 'string' && c.startsWith('#')));
  const out: Record<string, number> = {};
  if (wanted.size === 0) return Promise.resolve(out);

  const wsUrl = options.wsUrl ?? HL_WS_URL;
  const timeoutMs = options.timeoutMs ?? 6000;

  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* ignore close errors */
      }
      resolve(out);
    };
    const timer = setTimeout(finish, timeoutMs);

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
      const vol = Number(msg.data?.ctx?.dayNtlVlm);
      if (typeof coin === 'string' && wanted.has(coin) && Number.isFinite(vol)) {
        out[coin] = vol;
        if (Object.keys(out).length >= wanted.size) finish();
      }
    });
    ws.on('error', finish);
  });
}

/**
 * Compute per-market 24h volume from a `coin -> volume` map.
 *
 * @param outcomes - `meta.outcomes` from `getHlOutcomes` (each has `outcome` + `sideSpecs`).
 * @param coinVolumes - Map from {@link fetchHlOutcomeVolumes}.
 * @returns The same outcomes with `volume24hUsd` (sum of side-coin volumes, or null).
 */
export function attachOutcomeVolume(
  outcomes: Array<Record<string, unknown>>,
  coinVolumes: Record<string, number>,
): Array<Record<string, unknown>> {
  return outcomes.map((o) => {
    const sides = (o.sideSpecs as unknown[]) ?? [];
    let vol = 0;
    for (let i = 0; i < sides.length; i++) {
      vol += coinVolumes[outcomeSideCoin(o.outcome as string | number, i)] ?? 0;
    }
    return { ...o, volume24hUsd: vol > 0 ? vol : null };
  });
}

/** Collect every side coin across a set of outcomes. */
export function outcomeSideCoins(outcomes: Array<Record<string, unknown>>): string[] {
  const coins: string[] = [];
  for (const o of outcomes) {
    const sides = (o.sideSpecs as unknown[]) ?? [];
    for (let i = 0; i < sides.length; i++) coins.push(outcomeSideCoin(o.outcome as string | number, i));
  }
  return coins;
}
