/**
 * Challenge capsule: the only thing that travels between agents.
 *
 * Wire form: `GDEX-CHALLENGE:` + base64url(JSON), at most MAX_CAPSULE_CHARS. The JSON is a
 * strict allow-list (see CAPSULE_FIELDS). It names a packaged scenario by id and never
 * carries price data, fills, sizes, timestamps, balances, wallet or account identifiers,
 * order ids, P&L, prompts or URLs. Unknown fields, oversize input, wrong types, unknown
 * scenarios and unsupported versions are rejected. Decoding a capsule only ever opens
 * practice mode: nothing in it is executed, and an invite in it is shown, never applied.
 */
import { scenarioById, RULES_VERSION } from './scenarios.js';
import { validateDecision, type Decision } from './runner.js';

export const CAPSULE_PREFIX = 'GDEX-CHALLENGE:';
export const CAPSULE_VERSION = 1;
export const MAX_CAPSULE_CHARS = 600;
const SUPPORTED = new Set([CAPSULE_VERSION]);

/** GDEX refCodes are 20-char base58; accept 8–32 base58 chars, nothing else. */
export const INVITE_CODE_RE = /^[1-9A-HJ-NP-Za-km-z]{8,32}$/;
const SCENARIO_ID_RE = /^[a-z0-9-]{3,64}$/;

export interface Capsule {
  v: number;
  kind: 'gdex.practice.challenge';
  scenario: string;
  rules: string;
  /** Fixed label; recipients see where the scenario came from. */
  source: 'practice_fixture' | 'practice_fixture_inspired_by_trade';
  /** Sender's rounded relative plan, only when the sender chose to include it. */
  senderPlan?: Decision;
  /** Sender's GDEX invite code, only when the sender chose to include it. */
  invite?: string;
}

export const CAPSULE_FIELDS = ['v', 'kind', 'scenario', 'rules', 'source', 'senderPlan', 'invite'] as const;

export class CapsuleError extends Error {
  constructor(message: string, readonly code: 'MALFORMED' | 'OVERSIZE' | 'UNSUPPORTED_VERSION' | 'UNKNOWN_SCENARIO' | 'INVALID_FIELD') {
    super(message);
    this.name = 'CapsuleError';
  }
}

export const UPGRADE_HINT = 'This challenge needs a newer GDEX skill. Update it (e.g. `npx skills add GemachDAO/gdex-skill --all`, or restart an npx-launched MCP server to pick up the latest version) and try again.';

export function encodeCapsule(c: Capsule): string {
  const clean = validateCapsule(c);
  const s = CAPSULE_PREFIX + Buffer.from(JSON.stringify(clean), 'utf8').toString('base64url');
  if (s.length > MAX_CAPSULE_CHARS) throw new CapsuleError('Capsule too large', 'OVERSIZE');
  return s;
}

/** Find and decode a capsule in pasted text. Only the capsule token is read; the rest is ignored. */
export function decodeCapsule(input: string): Capsule {
  if (typeof input !== 'string') throw new CapsuleError('Capsule must be text', 'MALFORMED');
  const at = input.indexOf(CAPSULE_PREFIX);
  if (at < 0) throw new CapsuleError(`No ${CAPSULE_PREFIX} capsule found in the text`, 'MALFORMED');
  const token = /^GDEX-CHALLENGE:([A-Za-z0-9_-]*)/.exec(input.slice(at))![0];
  if (token.length > MAX_CAPSULE_CHARS) throw new CapsuleError(`Capsule longer than ${MAX_CAPSULE_CHARS} characters`, 'OVERSIZE');
  let obj: unknown;
  try {
    obj = JSON.parse(Buffer.from(token.slice(CAPSULE_PREFIX.length), 'base64url').toString('utf8'));
  } catch {
    throw new CapsuleError('Capsule is not valid', 'MALFORMED');
  }
  return validateCapsule(obj);
}

export function validateCapsule(obj: unknown): Capsule {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new CapsuleError('Capsule must be an object', 'MALFORMED');
  const o = obj as Record<string, unknown>;
  if (typeof o.v !== 'number' || !Number.isInteger(o.v)) throw new CapsuleError('Capsule version missing', 'MALFORMED');
  if (!SUPPORTED.has(o.v)) throw new CapsuleError(`Capsule version ${o.v} is not supported here. ${UPGRADE_HINT}`, 'UNSUPPORTED_VERSION');
  for (const k of Object.keys(o)) {
    if (!(CAPSULE_FIELDS as readonly string[]).includes(k)) throw new CapsuleError(`Field "${k}" is not allowed in a capsule`, 'INVALID_FIELD');
  }
  if (o.kind !== 'gdex.practice.challenge') throw new CapsuleError('Not a GDEX practice challenge', 'INVALID_FIELD');
  if (typeof o.scenario !== 'string' || !SCENARIO_ID_RE.test(o.scenario)) throw new CapsuleError('Invalid scenario id', 'INVALID_FIELD');
  const scenario = scenarioById(o.scenario);
  if (!scenario) throw new CapsuleError(`Unknown scenario "${o.scenario}". ${UPGRADE_HINT}`, 'UNKNOWN_SCENARIO');
  if (o.rules !== RULES_VERSION) throw new CapsuleError(`Rules "${String(o.rules)}" are not supported here. ${UPGRADE_HINT}`, 'UNSUPPORTED_VERSION');
  if (o.source !== 'practice_fixture' && o.source !== 'practice_fixture_inspired_by_trade') throw new CapsuleError('Invalid source label', 'INVALID_FIELD');
  const out: Capsule = { v: o.v, kind: 'gdex.practice.challenge', scenario: o.scenario, rules: RULES_VERSION, source: o.source };
  if (o.senderPlan !== undefined) {
    try { out.senderPlan = validateDecision(scenario, o.senderPlan); } catch (e) { throw new CapsuleError(`Invalid senderPlan: ${(e as Error).message}`, 'INVALID_FIELD'); }
  }
  if (o.invite !== undefined) {
    if (typeof o.invite !== 'string' || !INVITE_CODE_RE.test(o.invite)) throw new CapsuleError('Invalid invite code', 'INVALID_FIELD');
    out.invite = o.invite;
  }
  return out;
}
