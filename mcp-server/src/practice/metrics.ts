/**
 * Privacy-safe feature metrics: aggregate counters on this machine only.
 *
 * Recorded: event names and counts per UTC day, and coarse labels (close state, exit reason,
 * attribution state). Never recorded: accounts, addresses, coins, sizes, prices, P&L, order
 * ids, capsules, invite codes, prompts or timestamps finer than a day. Nothing is sent
 * anywhere. Turn off with GDEX_METRICS=off. A metrics failure never affects a tool result.
 *
 * Replay/practice and referral are reported as two separate funnels.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { gdexHome } from '../credentials.js';
import { readEnv } from '../sdk.js';

export const METRIC_EVENTS = {
  replay: ['replay_requested', 'replay_completed', 'replay_needs_choice', 'replay_failed'],
  practice: ['challenge_previewed', 'challenge_exported', 'challenge_started', 'challenge_completed', 'challenge_rejected'],
  referral: ['invite_shown', 'invite_included', 'connect_with_invite', 'invite_attributed', 'invite_already_attributed', 'invite_not_attributed'],
} as const;

type Funnel = keyof typeof METRIC_EVENTS;
export type MetricEvent = (typeof METRIC_EVENTS)[Funnel][number];

/** Only these short labels may accompany an event (e.g. close state or exit reason). */
const LABEL_RE = /^[a-z_]{1,40}$/;

interface Store {
  version: 1;
  days: Record<string, Record<string, number>>;
  firsts: Partial<Record<MetricEvent, string>>;
}

const file = () => path.join(gdexHome(), 'metrics', 'feature-metrics.json');
const enabled = () => !/^(0|off|false|no|disabled)$/i.test(readEnv('GDEX_METRICS') ?? '');

async function load(): Promise<Store> {
  try {
    const s = JSON.parse(await fs.readFile(file(), 'utf8')) as Store;
    if (s.version === 1 && s.days && s.firsts) return s;
  } catch { /* fresh store */ }
  return { version: 1, days: {}, firsts: {} };
}

let queue: Promise<unknown> = Promise.resolve();

/** Wait for queued metric writes (tests, shutdown). */
export const flush = (): Promise<unknown> => queue;

/** Count one event. Never throws, never blocks the caller's result on failure. */
export function track(event: MetricEvent, label?: string, now = Date.now()): Promise<void> {
  if (!enabled()) return Promise.resolve();
  const day = new Date(now).toISOString().slice(0, 10);
  const key = label && LABEL_RE.test(label) ? `${event}:${label}` : event;
  const run = queue.then(async () => {
    const s = await load();
    const d = (s.days[day] ??= {});
    d[key] = (d[key] ?? 0) + 1;
    if (key !== event) d[event] = (d[event] ?? 0) + 1;
    s.firsts[event] ??= day;
    await fs.mkdir(path.dirname(file()), { recursive: true, mode: 0o700 });
    const tmp = `${file()}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
    await fs.rename(tmp, file());
  }).catch(() => undefined);
  queue = run;
  return run as Promise<void>;
}

/** Totals per funnel, with separate replay-completion and referral-conversion rates. */
export async function report(sinceDays = 30, now = Date.now()): Promise<Record<string, unknown>> {
  await queue; // include events still being written
  const s = await load();
  const cutoff = new Date(now - sinceDays * 86_400_000).toISOString().slice(0, 10);
  const totals: Record<string, number> = {};
  for (const [day, counts] of Object.entries(s.days)) {
    if (day < cutoff) continue;
    for (const [k, v] of Object.entries(counts)) totals[k] = (totals[k] ?? 0) + v;
  }
  const pick = (f: Funnel) => Object.fromEntries(Object.entries(totals).filter(([k]) => (METRIC_EVENTS[f] as readonly string[]).includes(k.split(':')[0])).sort());
  const rate = (a: number, b: number) => (b > 0 ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
  const t = (k: MetricEvent) => totals[k] ?? 0;
  return {
    enabled: enabled(),
    windowDays: sinceDays,
    scope: 'This machine only. Aggregate counts; no accounts, trades, coins, amounts or codes are stored, and nothing is sent anywhere.',
    replay: { counts: pick('replay'), firstSuccessfulReplayDay: s.firsts.replay_completed ?? null, completionRate: rate(t('replay_completed'), t('replay_requested')) },
    practice: { counts: pick('practice'), completionRate: rate(t('challenge_completed'), t('challenge_started')), exportRate: rate(t('challenge_exported'), t('challenge_previewed')) },
    referral: {
      counts: pick('referral'),
      inviteInclusionRate: rate(t('invite_included'), t('challenge_exported')),
      backendConfirmedAttributionRate: rate(t('invite_attributed'), t('connect_with_invite')),
      note: 'Attribution counts come only from GDEX\'s own sign-in response. Accrued or paid referral rewards are not tracked here.',
    },
  };
}
