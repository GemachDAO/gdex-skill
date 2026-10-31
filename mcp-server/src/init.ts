import { mkdir, readFile, writeFile, rename, copyFile, stat, realpath, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { ConfigParseError, parseJsonConfig, setJsonMember } from './jsonc.js';
import { parseToml, renderTomlTable, type TomlDocument, type TomlTable } from './tomlLite.js';

export type Client = 'claude' | 'cursor' | 'vscode' | 'codex' | 'opencode';

export const SUPPORTED_CLIENTS: Client[] = ['claude', 'cursor', 'vscode', 'codex', 'opencode'];

// Launch the MCP server straight from GitHub (no npm account/publish required).
// The package builds on install (prepare script) and exposes the gdex-mcp-server bin.
const GH_SOURCE = 'github:GemachDAO/gdex-skill';
const SHARED_API_KEY = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';

/** Name of the GDEX entry inside every client's server map. */
export const SERVER_NAME = 'gdex-mcp-server';

type JsonTarget = {
  format: 'json';
  path: string;
  containerKey: string; // the client's server map
  comments: boolean; // client accepts JSONC (comments, trailing commas)
  entry: Record<string, unknown>;
  freshTopLevel?: Record<string, unknown>; // extra top-level keys for a newly created file
};
type TomlTarget = {
  format: 'toml';
  path: string;
  tablePath: string[]; // [mcp_servers.<name>]
  entry: Record<string, unknown>;
};
type Target = JsonTarget | TomlTarget;

function mcpEntry(): Record<string, unknown> {
  return {
    command: 'npx',
    args: ['-y', GH_SOURCE, 'gdex-mcp-server'],
    env: { GDEX_API_KEY: SHARED_API_KEY },
  };
}

/**
 * OpenCode reads `opencode.json` / `opencode.jsonc` in the project root, with servers under
 * `mcp` as `{ type: 'local', command: [...], environment, enabled }` (https://opencode.ai/docs/mcp-servers/).
 * An existing `opencode.jsonc` is preferred so we merge into it instead of adding a second file.
 */
function openCodeTarget(cwd?: string): JsonTarget {
  const path = cwd && existsSync(join(cwd, 'opencode.jsonc')) && !existsSync(join(cwd, 'opencode.json'))
    ? 'opencode.jsonc'
    : 'opencode.json';
  const { command, args, env } = mcpEntry() as { command: string; args: string[]; env: Record<string, string> };
  return {
    format: 'json',
    path,
    containerKey: 'mcp',
    comments: true, // OpenCode parses its config as JSONC
    entry: { type: 'local', command: [command, ...args], environment: env, enabled: true },
    freshTopLevel: { $schema: 'https://opencode.ai/config.json' },
  };
}

/** Config written by earlier versions of init for OpenCode; OpenCode never read it. */
export const LEGACY_OPENCODE_PATH = '.opencode/mcp.json';

export function getTarget(client: Client, cwd?: string): Target {
  switch (client) {
    case 'claude':
      return { format: 'json', path: '.mcp.json', containerKey: 'mcpServers', comments: false, entry: mcpEntry() };
    case 'cursor':
      return { format: 'json', path: '.cursor/mcp.json', containerKey: 'mcpServers', comments: false, entry: mcpEntry() };
    case 'vscode':
      return {
        format: 'json',
        path: '.vscode/mcp.json',
        containerKey: 'servers',
        comments: true,
        entry: { type: 'stdio', ...mcpEntry() },
      };
    case 'codex':
      return { format: 'toml', path: '.codex/config.toml', tablePath: ['mcp_servers', SERVER_NAME], entry: mcpEntry() };
    case 'opencode':
      return openCodeTarget(cwd);
  }
}

export type InitStatus =
  | 'created' // no config file existed; wrote a new one
  | 'merged' // added the GDEX entry to an existing file
  | 'updated' // replaced a differing GDEX entry (--force)
  | 'unchanged' // identical GDEX entry already present
  | 'conflict' // a differing GDEX entry exists and --force was not given
  | 'invalid'; // existing file could not be parsed or edited safely; left untouched

export interface InitResult {
  status: InitStatus;
  path: string; // relative to cwd
  fullPath: string;
  backupPath?: string;
  message: string;
  existingEntry?: string; // for conflict / updated
  newEntry?: string;
}

export interface InitOptions {
  client: Client;
  cwd?: string;
  force?: boolean;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

function withoutEntry(doc: Record<string, unknown>, containerKey: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...doc };
  if (isPlainObject(copy[containerKey])) {
    const servers = { ...(copy[containerKey] as Record<string, unknown>) };
    delete servers[SERVER_NAME];
    if (Object.keys(servers).length === 0) delete copy[containerKey];
    else copy[containerKey] = servers;
  }
  return copy;
}

/** Atomically replace `fullPath` with `content`, keeping a `.bak` of the previous file. */
async function atomicWrite(fullPath: string, content: string, backup: boolean): Promise<string | undefined> {
  const target = existsSync(fullPath) ? await realpath(fullPath) : fullPath;
  await mkdir(dirname(target), { recursive: true });
  let mode: number | undefined;
  let backupPath: string | undefined;
  if (backup && existsSync(target)) {
    mode = (await stat(target)).mode & 0o777;
    backupPath = `${fullPath}.bak`;
    await copyFile(target, backupPath);
  }
  const tmp = join(dirname(target), `.${SERVER_NAME}-init-${process.pid}-${randomBytes(4).toString('hex')}.tmp`);
  try {
    await writeFile(tmp, content, { encoding: 'utf-8', mode: mode ?? 0o644, flag: 'wx' });
    await rename(tmp, target);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
  return backupPath;
}

const eolOf = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');

interface Plan {
  existing?: unknown; // current GDEX entry, if any
  existingText?: string;
  build: () => string; // full new file text
  verify: (newText: string) => boolean;
}

function planJson(target: JsonTarget, original: string | undefined): Plan {
  const fresh = () =>
    JSON.stringify({ ...target.freshTopLevel, [target.containerKey]: { [SERVER_NAME]: target.entry } }, null, 2) + '\n';
  if (original === undefined || original.trim() === '') {
    return { build: fresh, verify: () => true };
  }
  const bom = original.startsWith('﻿') ? '﻿' : '';
  const text = original.slice(bom.length);
  const doc = parseJsonConfig(text, target.comments);
  if (!isPlainObject(doc)) throw new ConfigParseError('top level is not a JSON object');
  const servers = doc[target.containerKey];
  if (servers !== undefined && !isPlainObject(servers)) {
    throw new ConfigParseError(`"${target.containerKey}" is not an object`);
  }
  const existing = servers && Object.prototype.hasOwnProperty.call(servers, SERVER_NAME) ? servers[SERVER_NAME] : undefined;
  return {
    existing,
    existingText: existing === undefined ? undefined : JSON.stringify(existing, null, 2),
    build: () => {
      // A single-line (minified) strict-JSON file has no formatting worth keeping: pretty-print it.
      if (!target.comments && !text.trim().includes('\n')) {
        const merged = { ...doc, [target.containerKey]: { ...(servers ?? {}), [SERVER_NAME]: target.entry } };
        return bom + JSON.stringify(merged, null, 2) + '\n';
      }
      return bom + setJsonMember(text, target.containerKey, SERVER_NAME, target.entry, target.comments, eolOf(text));
    },
    verify: (newText) => {
      const after = parseJsonConfig(newText.slice(bom.length), target.comments) as Record<string, unknown>;
      const afterServers = after[target.containerKey] as Record<string, unknown> | undefined;
      return (
        isPlainObject(afterServers) &&
        deepEqual(afterServers[SERVER_NAME], target.entry) &&
        deepEqual(withoutEntry(after, target.containerKey), withoutEntry(doc, target.containerKey))
      );
    },
  };
}

function tomlEntry(doc: TomlDocument, path: string[]): unknown {
  let cur: unknown = doc.data;
  for (const part of path) {
    if (!isPlainObject(cur) || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function tomlWithout(data: TomlTable, path: string[]): TomlTable {
  const copy = structuredClone(data);
  const parent = copy[path[0]];
  if (isPlainObject(parent)) {
    delete parent[path[1]];
    if (Object.keys(parent).length === 0) delete copy[path[0]];
  }
  return copy;
}

const startsWithPath = (p: string[], prefix: string[]) => prefix.every((part, i) => p[i] === part);

function planToml(target: TomlTarget, original: string | undefined): Plan {
  const eol = original ? eolOf(original) : '\n';
  const block = renderTomlTable(target.tablePath, target.entry, eol);
  if (original === undefined || original.trim() === '') {
    return { build: () => block, verify: () => true };
  }
  const doc = parseToml(original);
  const existing = tomlEntry(doc, target.tablePath);
  if (existing !== undefined && !isPlainObject(existing)) {
    throw new ConfigParseError(`[${target.tablePath.join('.')}] is not a table`);
  }

  // Sections to replace: [mcp_servers.gdex-mcp-server] and its subtables, each from its
  // header to the end of its last statement (trailing comments stay with whatever follows).
  const spans: Array<[number, number]> = [];
  doc.headers.forEach((h, idx) => {
    if (!startsWithPath(h.path, target.tablePath)) return;
    if (h.array) throw new ConfigParseError(`[[${h.path.join('.')}]] is an array of tables`);
    const headerLineEnd = original.indexOf('\n', h.start);
    let end = headerLineEnd === -1 ? original.length : headerLineEnd + 1;
    for (const s of doc.statements) if (s.headerIndex === idx) end = Math.max(end, s.end);
    spans.push([h.start, end]);
  });
  // The entry may also be defined without its own header (dotted keys or an inline table
  // under [mcp_servers] or the root). Those can't be replaced by section, so refuse to edit.
  const elsewhere = doc.statements.some(
    (s) => !startsWithPath(s.table, target.tablePath) && startsWithPath([...s.table, ...s.key], target.tablePath),
  );

  const existingText =
    existing === undefined
      ? undefined
      : spans.length > 0 && !elsewhere
        ? spans.map(([a, b]) => original.slice(a, b)).join('').trimEnd()
        : JSON.stringify(existing, null, 2);

  return {
    existing,
    existingText,
    build: () => {
      if (elsewhere) {
        throw new ConfigParseError(
          `${target.tablePath.join('.')} is defined with dotted keys or an inline table; ` +
            `convert it to a [${target.tablePath.join('.')}] table (or remove it) and rerun`,
        );
      }
      if (spans.length === 0) {
        const base = original.endsWith('\n') ? original : original + eol;
        return base + eol + block;
      }
      let out = '';
      let pos = 0;
      spans.forEach(([a, b], n) => {
        out += original.slice(pos, a) + (n === 0 ? block : '');
        pos = b;
      });
      return out + original.slice(pos);
    },
    verify: (newText) => {
      const after = parseToml(newText);
      return (
        deepEqual(tomlEntry(after, target.tablePath), target.entry) &&
        deepEqual(tomlWithout(after.data, target.tablePath), tomlWithout(doc.data, target.tablePath))
      );
    },
  };
}

/**
 * Add the GDEX MCP server to a client's project config, merging into whatever is already
 * there. Never rewrites a file it can't parse, never silently replaces a differing GDEX
 * entry (needs `force`), and is a no-op when the entry is already identical.
 */
export async function initClientConfig(opts: InitOptions): Promise<InitResult> {
  const cwd = opts.cwd ?? process.cwd();
  const target = getTarget(opts.client, cwd);
  const fullPath = join(cwd, target.path);
  const base = { path: target.path, fullPath };
  const original = existsSync(fullPath) ? await readFile(fullPath, 'utf-8') : undefined;
  const newEntry =
    target.format === 'json' ? JSON.stringify(target.entry, null, 2) : renderTomlTable(target.tablePath, target.entry, '\n').trimEnd();

  const invalid = (reason: string): InitResult => ({
    ...base,
    status: 'invalid',
    message:
      `${target.path} could not be updated safely: ${reason}\n` +
      `The file was left untouched. Fix it (or move it aside) and rerun init, or add this entry by hand:\n${newEntry}`,
  });

  let plan: Plan;
  try {
    plan = target.format === 'json' ? planJson(target, original) : planToml(target, original);
  } catch (err) {
    if (err instanceof ConfigParseError) return invalid(`it is not valid ${target.format === 'json' ? (target.comments ? 'JSON/JSONC' : 'JSON') : 'TOML'} (${err.message})`);
    throw err;
  }

  if (plan.existing !== undefined) {
    if (deepEqual(plan.existing, target.entry)) {
      return { ...base, status: 'unchanged', message: `${target.path} already has an identical ${SERVER_NAME} entry; nothing to do.` };
    }
    if (!opts.force) {
      return {
        ...base,
        status: 'conflict',
        existingEntry: plan.existingText,
        newEntry,
        message: `${target.path} already has a different ${SERVER_NAME} entry. Rerun with --force to replace it (a .bak backup is kept).`,
      };
    }
  }

  let content: string;
  try {
    content = plan.build();
    if (!plan.verify(content)) return invalid('the merged result did not round-trip (please report this)');
  } catch (err) {
    if (err instanceof ConfigParseError) return invalid(err.message);
    throw err;
  }

  const backupPath = await atomicWrite(fullPath, content, original !== undefined);
  if (original === undefined) {
    const legacy = opts.client === 'opencode' && existsSync(join(cwd, LEGACY_OPENCODE_PATH))
      ? `\nNote: ${LEGACY_OPENCODE_PATH} (written by older versions of init) is not read by OpenCode; you can delete it.`
      : '';
    return { ...base, status: 'created', message: `Created ${target.path} for ${opts.client}${legacy}` };
  }
  if (plan.existing !== undefined) {
    return {
      ...base,
      status: 'updated',
      backupPath,
      existingEntry: plan.existingText,
      newEntry,
      message: `Replaced the ${SERVER_NAME} entry in ${target.path} (backup: ${target.path}.bak)`,
    };
  }
  return { ...base, status: 'merged', backupPath, message: `Added ${SERVER_NAME} to ${target.path} (backup: ${target.path}.bak)` };
}

function printUsage(log: (msg: string) => void): void {
  log(`Usage: gdex-mcp-server init --client <${SUPPORTED_CLIENTS.join('|')}> [--force]`);
  log('\nAdds the GDEX server to the client\'s project config. An existing config is merged,');
  log('not replaced: other servers and settings are kept and the previous file is saved as');
  log('<file>.bak. Rerunning is safe; an identical GDEX entry is left as is.');
  log('\nSupported clients:');
  log('  claude    - Claude Code (.mcp.json)');
  log('  cursor    - Cursor (.cursor/mcp.json)');
  log('  vscode    - VS Code (.vscode/mcp.json)');
  log('  codex     - Codex (.codex/config.toml)');
  log('  opencode  - OpenCode (opencode.json, or an existing opencode.jsonc)');
  log('\nOptions:');
  log(`  --force   Replace an existing ${SERVER_NAME} entry that differs from the default`);
}

/** CLI entry for `gdex-mcp-server init`. Returns the process exit code. */
export async function handleInit(args: string[], cwd: string = process.cwd()): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    printUsage(console.log);
    return 0;
  }
  const clientIdx = args.indexOf('--client');
  if (clientIdx === -1 || !args[clientIdx + 1] || args[clientIdx + 1].startsWith('--')) {
    printUsage(console.log);
    return 1;
  }

  const client = args[clientIdx + 1] as Client;
  if (!SUPPORTED_CLIENTS.includes(client)) {
    console.error(`Unknown client "${client}". Supported: ${SUPPORTED_CLIENTS.join(', ')}`);
    return 1;
  }

  const result = await initClientConfig({ client, cwd, force: args.includes('--force') });
  switch (result.status) {
    case 'invalid':
      console.error(`❌ ${result.message}`);
      return 1;
    case 'conflict':
      console.error(`⚠️  ${result.message}`);
      console.error(`\nCurrent entry:\n${result.existingEntry}\n\nNew entry:\n${result.newEntry}`);
      return 1;
    case 'unchanged':
      console.log(`✅ ${result.message}`);
      return 0;
    case 'updated':
      console.log(`✅ ${result.message}`);
      console.log(`\nPrevious entry:\n${result.existingEntry}\n\nNew entry:\n${result.newEntry}`);
      break;
    default:
      console.log(`✅ ${result.message}`);
  }

  console.log(`\nGDEX MCP server configured! Available tools:`);
  console.log('  - search_gdex_docs      Search documentation by keyword');
  console.log('  - get_sdk_pattern        Get TypeScript code patterns');
  console.log('  - get_api_info           Get API endpoint details');
  console.log('  - explain_workflow       Step-by-step trading workflows');
  console.log('  - get_chain_info         Supported chains and capabilities');
  console.log('  - get_trading_guide      Spot, perp, or limit trading guides');
  console.log('  - get_copy_trade_guide   Copy trading guides');
  console.log('  - get_component_guide    React UI component patterns');
  console.log('  - get_skill_file         Files shipped with a skill (scripts, data)');
  console.log('  ...plus 128 trading and account tools. Connect an account with gdex_connect.');
  return 0;
}
