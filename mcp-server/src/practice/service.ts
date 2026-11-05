/**
 * Glue between the pure replay/practice modules and the outside world: reads Hyperliquid
 * records and the local journal for replay, composes the share message, and resolves the
 * sender's existing GDEX invite. Nothing here places, cancels or changes an order, and
 * nothing here applies a referral.
 */
import { createHash } from 'crypto';
import { buildGdexUserSessionData, GdexValidationError } from '@gemachdao/gdex-skill';
import { applyAccountRef, listAccounts, loadAccount, type StoredAccount } from '../credentials.js';
import { listOperations, loadPreview, withSession, type IntentDeps } from '../intent.js';
import {
  buildReplay, replayHeadline, summarizeCloses, DEFAULT_LOOKBACK_DAYS, REPLAY_VENUE,
  type Fresh, type HlFill, type HlFunding, type HlHistoricalOrder, type HlOpenOrder, type JournalEntry, type Replay, type ReplayRecords,
} from './replay.js';
import { scenarioById, scenarioForFamily, SCENARIOS, RULES_VERSION, type Scenario } from './scenarios.js';
import { encodeCapsule, INVITE_CODE_RE, type Capsule } from './capsule.js';

export const INVITE_ORIGIN = 'https://gdex.pro';
export const INSTALL_FALLBACK = 'No GDEX skill yet? Install the GDEX MCP server: `npx @gemachdao/gdex-mcp-server init --client claude` (or cursor, codex, vscode). Details: https://github.com/GemachDAO/gdex-skill. Practice needs no account, wallet or funds.';

// ── Account selection ──────────────────────────────────────────────────────

/** Use the given account, or the only one connected; with several, ask which. */
export async function pickAccount(accountRef?: string): Promise<StoredAccount> {
  if (accountRef) return loadAccount(accountRef);
  const all = await listAccounts();
  if (all.length === 1) return loadAccount(all[0].accountRef);
  if (!all.length) throw new GdexValidationError('No GDEX account is connected on this machine. Connect one with gdex_connect, or run a standalone practice challenge (gdex_run_challenge with a scenarioId) which needs no account.', 'accountRef');
  throw new GdexValidationError(`Several accounts are connected; ask the user which one and pass accountRef: ${all.map((a) => `${a.accountRef} (${a.walletAddress})`).join(', ')}`, 'accountRef');
}

const hlAddressOf = (a: StoredAccount) => a.managed?.evm ?? a.walletAddress;

// ── Replay records ─────────────────────────────────────────────────────────

async function fresh<T>(deps: IntentDeps, fn: () => Promise<T>): Promise<Fresh<T>> {
  try { return { status: 'ok', asOf: deps.now(), data: await fn() }; } catch (e) { return { status: 'unavailable', error: (e as Error).message }; }
}

const dexOf = (coin: string) => (coin.includes(':') ? coin.split(':')[0] : '');
/** Per-dex reads may name a builder-DEX coin with or without its "dex:" prefix. */
export const sameCoin = (a: string, want: string) => a === want || a === want.replace(/^[^:]*:/, '');

export async function loadReplayRecords(deps: IntentDeps, account: StoredAccount, lookbackDays = DEFAULT_LOOKBACK_DAYS): Promise<ReplayRecords> {
  const user = hlAddressOf(account);
  const endTime = deps.now();
  const startTime = endTime - lookbackDays * 86_400_000;
  const fills = (await deps.hlInfo({ type: 'userFillsByTime', user, startTime, endTime, aggregateByTime: false })) as HlFill[];
  if (!Array.isArray(fills)) throw new Error('Hyperliquid returned no fill list');
  const [orders, funding] = await Promise.all([
    fresh(deps, async () => deps.hlInfo({ type: 'historicalOrders', user }) as Promise<HlHistoricalOrder[]>),
    fresh(deps, async () => deps.hlInfo({ type: 'userFunding', user, startTime, endTime }) as Promise<HlFunding[]>),
  ]);
  // Fresh per-dex reads, fetched once per dex the fills touch.
  const dexes = [...new Set(fills.map((f) => dexOf(f.coin)))];
  const states = new Map<string, Fresh<{ assetPositions?: Array<{ position: { coin: string; szi: string } }> }>>();
  const openOrders = new Map<string, Fresh<HlOpenOrder[]>>();
  await Promise.all(dexes.map(async (dex) => {
    states.set(dex, await fresh(deps, async () => deps.hlInfo({ type: 'clearinghouseState', user, ...(dex ? { dex } : {}) }) as Promise<{ assetPositions?: Array<{ position: { coin: string; szi: string } }> }>));
    openOrders.set(dex, await fresh(deps, async () => deps.hlInfo({ type: 'frontendOpenOrders', user, ...(dex ? { dex } : {}) }) as Promise<HlOpenOrder[]>));
  }));
  const ops = await listOperations(account.accountRef);
  const journal: JournalEntry[] = [];
  for (const o of ops.filter((x) => x.kind === 'perp_open' || x.kind === 'perp_close')) {
    const p = await loadPreview(o.previewId).catch(() => undefined);
    journal.push({ opId: o.opId, kind: o.kind, state: o.state, createdAt: o.createdAt, updatedAt: o.updatedAt, terms: p?.terms, summary: p?.summary });
  }
  return {
    account: { accountRef: account.accountRef, hlAddress: user },
    window: { startTime, endTime },
    fills,
    orders, funding,
    positionNow: (coin) => {
      const st = states.get(dexOf(coin));
      if (!st || st.status !== 'ok') return st ?? { status: 'unavailable', error: 'not read' };
      const p = st.data.assetPositions?.find((a) => sameCoin(a.position.coin, coin));
      return { status: 'ok', asOf: st.asOf, data: p?.position.szi ?? '0' };
    },
    openOrdersNow: (coin) => {
      const oo = openOrders.get(dexOf(coin));
      if (!oo || oo.status !== 'ok') return oo ?? { status: 'unavailable', error: 'not read' };
      return { status: 'ok', asOf: oo.asOf, data: oo.data.filter((o) => sameCoin(o.coin, coin)) };
    },
    journal,
  };
}

export interface ReplayRequest { accountRef?: string; closeId?: string; latest?: boolean; coin?: string; lookbackDays?: number }

/** Replay one trade, or list candidates when the choice is ambiguous. */
export async function replayTrade(deps: IntentDeps, req: ReplayRequest): Promise<Record<string, unknown>> {
  const account = await pickAccount(req.accountRef);
  const rec = await loadReplayRecords(deps, account, req.lookbackDays);
  let closes = summarizeCloses(rec);
  if (req.coin) closes = closes.filter((c) => c.coin.toUpperCase() === req.coin!.toUpperCase());
  if (!closes.length) {
    return { venue: REPLAY_VENUE, accountRef: account.accountRef, found: 0, text: `No Hyperliquid perp fills${req.coin ? ` for ${req.coin}` : ''} in the last ${req.lookbackDays ?? DEFAULT_LOOKBACK_DAYS} days for this account.` };
  }
  const chosen = req.closeId ?? (req.latest || closes.length === 1 ? closes[0].closeId : undefined);
  if (!chosen) {
    return {
      venue: REPLAY_VENUE, accountRef: account.accountRef, needsChoice: true,
      candidates: closes.slice(0, 10),
      text: 'More than one trade matches. Ask the user which one (or pass latest: true for the most recent), then call again with closeId.',
    };
  }
  const replay = buildReplay(rec, chosen);
  return { accountRef: account.accountRef, text: replayHeadline(replay), replay };
}

// ── Invite (existing GDEX referral program) ────────────────────────────────

export interface InviteInfo {
  code: string;
  link: string;
  invitedBy: string | null;
  hyperliquid: Record<string, unknown> | { status: 'unavailable'; error: string };
  states: string;
}

/** The sender's own existing code and program status. Reads only; never creates or applies anything. */
export async function getInvite(deps: IntentDeps, accountRef?: string): Promise<InviteInfo> {
  const account = await pickAccount(accountRef);
  // Refresh a stale session and point the shared SDK client at this account's cookie.
  await applyAccountRef({ accountRef: account.accountRef }, {});
  return withSession(deps, account.accountRef, async (a) => {
    const data = buildGdexUserSessionData(a.sessionKey, a.apiKey);
    const user = (await deps.sdk().getManagedUser({ userId: a.walletAddress, data, chainId: 42161 })) as Record<string, unknown>;
    const code = typeof user.refCode === 'string' ? user.refCode : '';
    if (!INVITE_CODE_RE.test(code)) throw new Error('GDEX did not return an invite code for this account');
    const hl = await deps.sdk().client.get<Record<string, unknown>>('/v1/hl_ref/info', { userId: a.walletAddress, data })
      .then((r) => ({
        status: 'ok',
        referredDirect: r.totalReferralCountTier1, referredSecondTier: r.totalReferralCountTier2,
        accruedUsd: r.refEarnable, claimedUsd: r.refEarned, withdrawableUsd: r.withdrawable,
        claimRequests: Array.isArray(r.claimHistorys) ? r.claimHistorys.length : 0,
        claimRequestsAwaitingPayout: Array.isArray(r.claimHistorys) ? (r.claimHistorys as Array<{ status?: unknown }>).filter((c) => c.status !== true).length : 0,
      }), (e: Error) => ({ status: 'unavailable' as const, error: e.message }));
    return {
      code,
      link: `${INVITE_ORIGIN}/?ref=${code}`,
      invitedBy: typeof user.referralSource === 'string' && user.referralSource ? user.referralSource : null,
      hyperliquid: hl,
      states: 'Accrued is credited by GDEX from builder fees on referred trades; claimed means a claim was requested; a claim awaiting payout is not paid. GDEX does not report a separate "eligible" state, and rates come from the program, not from this skill.',
    };
  });
}

// ── Making a challenge ─────────────────────────────────────────────────────

export interface MakeChallengeRequest {
  accountRef?: string;
  closeId?: string;
  scenarioId?: string;
  includeSenderPlan?: boolean;
  includeInvite?: boolean;
  confirmExport?: boolean;
  exportToken?: string;
}

export interface ChallengeOptions { invitesEnabled: boolean }

export function composeMessage(s: Scenario, capsule: string, opts: { inspired: boolean; senderPlan?: { targetPct: string; stopPct: string }; inviteLink?: string }): string {
  const lines = [
    'GDEX Agent Challenge · Practice only',
    `Your task: pick a stop and target for a ${s.side} on ${s.instrument.label.replace(/ \(practice\)$/, '')} while staying inside the scenario's ${s.rules.riskLimitPct}% risk limit.`,
    opts.inspired
      ? 'Source: practice fixture inspired by a real GDEX trade. The tape is synthetic; no trade details are included.'
      : 'Source: practice fixture (synthetic tape).',
  ];
  if (opts.senderPlan) lines.push(`Plan to compare against: target ${opts.senderPlan.targetPct}% / stop ${opts.senderPlan.stopPct}%.`);
  lines.push('Paste this capsule into your GDEX trading skill and say "Run this challenge":', capsule);
  if (opts.inviteLink) lines.push(`Optional: my GDEX invite ${opts.inviteLink}. I may earn a share of eligible fees if you sign up with it. Running the challenge does not use it.`);
  lines.push(INSTALL_FALLBACK);
  return lines.join('\n');
}

const tokenOf = (message: string) => createHash('sha256').update(message).digest('hex').slice(0, 16);

export async function makeChallenge(deps: IntentDeps, req: MakeChallengeRequest, opts: ChallengeOptions): Promise<Record<string, unknown>> {
  if (!!req.closeId === !!req.scenarioId) throw new GdexValidationError('Pass exactly one of closeId (from gdex_replay_trade) or scenarioId (standalone practice)', 'closeId');
  if (req.includeInvite && !opts.invitesEnabled) throw new GdexValidationError('Invites are turned off in this installation', 'includeInvite');
  let scenario: Scenario | undefined;
  let senderPlan: { targetPct: string; stopPct: string } | undefined;
  let inspired = false;
  if (req.closeId) {
    const account = await pickAccount(req.accountRef);
    const replay: Replay = buildReplay(await loadReplayRecords(deps, account), req.closeId);
    if (!replay.exportable || !replay.practiceFamily) {
      throw new GdexValidationError(`This trade is "${replay.state}", not a verified full close, so it stays private. Use a standalone scenario instead: ${SCENARIOS.map((x) => x.id).join(', ')}`, 'closeId');
    }
    scenario = scenarioForFamily(replay.practiceFamily);
    inspired = true;
    if (req.includeSenderPlan) {
      const rp = replay.relativePlan;
      if (!rp?.targetPct || !rp?.stopPct) throw new GdexValidationError('This trade had no linked take-profit and stop to compare against; leave includeSenderPlan off', 'includeSenderPlan');
      senderPlan = { targetPct: rp.targetPct, stopPct: rp.stopPct };
    }
  } else {
    scenario = scenarioById(req.scenarioId!);
    if (!scenario) throw new GdexValidationError(`Unknown scenario. Available: ${SCENARIOS.map((x) => x.id).join(', ')}`, 'scenarioId');
    if (req.includeSenderPlan) throw new GdexValidationError('includeSenderPlan needs a closeId', 'includeSenderPlan');
  }
  if (!scenario) throw new Error('No packaged scenario for this trade type');
  let inviteLink: string | undefined; let invite: string | undefined;
  if (req.includeInvite) {
    const info = await getInvite(deps, req.accountRef);
    invite = info.code; inviteLink = info.link;
  }
  const capsuleObj: Capsule = { v: 1, kind: 'gdex.practice.challenge', scenario: scenario.id, rules: RULES_VERSION, source: inspired ? 'practice_fixture_inspired_by_trade' : 'practice_fixture', ...(senderPlan ? { senderPlan } : {}), ...(invite ? { invite } : {}) };
  const capsule = encodeCapsule(capsuleObj);
  const message = composeMessage(scenario, capsule, { inspired, senderPlan, inviteLink });
  const exportToken = tokenOf(message);
  if (!req.confirmExport) {
    return {
      stage: 'preview',
      message,
      capsuleContents: capsuleObj,
      excluded: 'wallet and account ids, balances, size, fills, order ids, exact times, prompts, original P&L',
      exportToken,
      next: 'Show the user this exact message. Only if they confirm, call again with the same options plus confirmExport: true and this exportToken. Nothing is sent anywhere; the user chooses where to paste it.',
    };
  }
  if (req.exportToken !== exportToken) {
    throw new GdexValidationError('The message changed since the preview (or exportToken is missing). Show the new preview and ask again.', 'exportToken');
  }
  return { stage: 'export', message, next: 'Give the user this message to copy. It has not been sent anywhere.' };
}

// ── Running a challenge ────────────────────────────────────────────────────

export function inviteNotice(code: string): string {
  return `The sender included a GDEX invite (${INVITE_ORIGIN}/?ref=${code}). It has not been used and practice does not need it. It can only count for a brand-new GDEX account: either create one here with gdex_connect { create: true, inviteCode: "${code}" } after the user agrees, or sign up at that link with a wallet. Email or Google sign-up does not carry invites today.`;
}
