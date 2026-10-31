import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { initClientConfig, handleInit, getTarget, SERVER_NAME, type Client } from '../src/init.js';
import { parseJsonConfig } from '../src/jsonc.js';
import { parseToml } from '../src/tomlLite.js';

const OTHER = { command: 'other-server', args: ['--port', '1'] };

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'gdex-init-test-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function put(rel: string, content: string): Promise<string> {
  const full = join(cwd, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, 'utf-8');
  return full;
}

const read = (rel: string) => readFile(join(cwd, rel), 'utf-8');

/** Parse a client's config into { servers, rest } regardless of format. */
function load(client: Client, text: string): { servers: Record<string, unknown>; doc: Record<string, unknown> } {
  const target = getTarget(client);
  if (target.format === 'toml') {
    const doc = parseToml(text).data;
    return { servers: (doc.mcp_servers ?? {}) as Record<string, unknown>, doc };
  }
  const doc = parseJsonConfig(text, target.comments) as Record<string, unknown>;
  return { servers: (doc[target.containerKey] ?? {}) as Record<string, unknown>, doc };
}

/** A config holding one unrelated server plus an unrelated top-level setting. */
function withOther(client: Client): string {
  const target = getTarget(client);
  if (target.format === 'toml') {
    return [
      '# my codex config',
      'model = "o4-mini"',
      '',
      '[mcp_servers.other]',
      'command = "other-server"',
      'args = ["--port", "1"]',
      '',
      '[profiles.fast]',
      'model = "gpt-5"',
      '',
    ].join('\n');
  }
  return JSON.stringify({ topLevelSetting: true, [target.containerKey]: { other: OTHER } }, null, 2) + '\n';
}

/** A config whose GDEX entry differs from what init writes. */
function withConflict(client: Client): string {
  const target = getTarget(client);
  if (target.format === 'toml') {
    return [
      '[mcp_servers.other]',
      'command = "other-server"',
      '',
      `[mcp_servers.${SERVER_NAME}]`,
      'command = "node"',
      'args = ["./local/dist/index.js"]',
      '',
      `[mcp_servers.${SERVER_NAME}.env]`,
      'GDEX_API_KEY = "my-own-key"',
      '',
      '# keep me',
      '[profiles.fast]',
      'model = "gpt-5"',
      '',
    ].join('\n');
  }
  return (
    JSON.stringify(
      { [target.containerKey]: { other: OTHER, [SERVER_NAME]: { command: 'node', args: ['./local/dist/index.js'] } } },
      null,
      2,
    ) + '\n'
  );
}

const INVALID: Record<'json' | 'toml', string> = {
  json: '{ "mcpServers": { "other": { "command": "x" ',
  toml: '[mcp_servers.other\ncommand = \n',
};

describe.each(['claude', 'cursor', 'vscode', 'codex', 'opencode'] as Client[])('init --client %s', (client) => {
  const target = getTarget(client);

  it('creates a new config when none exists', async () => {
    const res = await initClientConfig({ client, cwd });
    expect(res.status).toBe('created');
    expect(res.backupPath).toBeUndefined();
    const { servers } = load(client, await read(target.path));
    expect(servers[SERVER_NAME]).toEqual(target.entry);
    expect(existsSync(join(cwd, `${target.path}.bak`))).toBe(false);
  });

  it('merges into an existing config, preserving other servers and settings, and keeps a backup', async () => {
    const before = withOther(client);
    await put(target.path, before);
    const res = await initClientConfig({ client, cwd });
    expect(res.status).toBe('merged');

    const after = await read(target.path);
    const { servers, doc } = load(client, after);
    expect(servers[SERVER_NAME]).toEqual(target.entry);
    expect(servers.other).toEqual(OTHER);
    if (target.format === 'toml') {
      expect(doc.model).toBe('o4-mini');
      expect(doc.profiles).toEqual({ fast: { model: 'gpt-5' } });
      expect(after).toContain('# my codex config');
    } else {
      expect(doc.topLevelSetting).toBe(true);
    }
    expect(await read(`${target.path}.bak`)).toBe(before);
    // Atomic write leaves no temp files behind.
    const leftovers = (await readdir(dirname(join(cwd, target.path)))).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('is idempotent: a second run is a no-op', async () => {
    await put(target.path, withOther(client));
    await initClientConfig({ client, cwd });
    const once = await read(target.path);
    const backup = await read(`${target.path}.bak`);

    const res = await initClientConfig({ client, cwd });
    expect(res.status).toBe('unchanged');
    expect(await read(target.path)).toBe(once);
    expect(await read(`${target.path}.bak`)).toBe(backup);
  });

  it('refuses to replace a differing GDEX entry without --force', async () => {
    const before = withConflict(client);
    await put(target.path, before);
    const res = await initClientConfig({ client, cwd });
    expect(res.status).toBe('conflict');
    expect(res.existingEntry).toContain('./local/dist/index.js');
    expect(res.newEntry).toContain('github:GemachDAO/gdex-skill');
    expect(await read(target.path)).toBe(before);
    expect(existsSync(join(cwd, `${target.path}.bak`))).toBe(false);
  });

  it('replaces a differing GDEX entry with --force, keeping other servers and a backup', async () => {
    const before = withConflict(client);
    await put(target.path, before);
    const res = await initClientConfig({ client, cwd, force: true });
    expect(res.status).toBe('updated');

    const after = await read(target.path);
    const { servers, doc } = load(client, after);
    expect(servers[SERVER_NAME]).toEqual(target.entry);
    expect(servers.other).toBeDefined();
    if (target.format === 'toml') {
      expect(doc.profiles).toEqual({ fast: { model: 'gpt-5' } });
      expect(after).toContain('# keep me');
      expect(after).not.toContain('my-own-key');
      expect(after.match(/\[mcp_servers\.gdex-mcp-server/g)).toHaveLength(1);
    }
    expect(await read(`${target.path}.bak`)).toBe(before);
  });

  it('leaves an unparseable config untouched and reports it', async () => {
    const before = INVALID[target.format];
    await put(target.path, before);
    const res = await initClientConfig({ client, cwd, force: true });
    expect(res.status).toBe('invalid');
    expect(res.message).toMatch(/left untouched/);
    expect(await read(target.path)).toBe(before);
    expect(existsSync(join(cwd, `${target.path}.bak`))).toBe(false);
  });
});

describe('init edge cases', () => {
  it('vscode: keeps comments and trailing commas in JSONC', async () => {
    const before = [
      '{',
      '  // my servers',
      '  "servers": {',
      '    /* local tool */',
      '    "other": { "command": "other-server", },',
      '  },',
      '  "inputs": [],',
      '}',
      '',
    ].join('\n');
    await put('.vscode/mcp.json', before);
    const res = await initClientConfig({ client: 'vscode', cwd });
    expect(res.status).toBe('merged');
    const after = await read('.vscode/mcp.json');
    expect(after).toContain('// my servers');
    expect(after).toContain('/* local tool */');
    const doc = parseJsonConfig(after, true) as { servers: Record<string, unknown>; inputs: unknown[] };
    expect(doc.servers.other).toEqual({ command: 'other-server' });
    expect(doc.servers[SERVER_NAME]).toEqual(getTarget('vscode').entry);
    expect(doc.inputs).toEqual([]);
  });

  it('claude: rejects JSONC comments, which Claude Code does not accept', async () => {
    const before = '{\n  // comment\n  "mcpServers": {}\n}\n';
    await put('.mcp.json', before);
    expect((await initClientConfig({ client: 'claude', cwd })).status).toBe('invalid');
    expect(await read('.mcp.json')).toBe(before);
  });

  it('claude: rejects a server map that is not an object', async () => {
    await put('.mcp.json', '{ "mcpServers": [] }');
    expect((await initClientConfig({ client: 'claude', cwd })).status).toBe('invalid');
  });

  it('claude: adds mcpServers when the file has none, keeping the rest', async () => {
    await put('.mcp.json', '{\n    "foo": 1\n}\n');
    const res = await initClientConfig({ client: 'claude', cwd });
    expect(res.status).toBe('merged');
    const doc = JSON.parse(await read('.mcp.json'));
    expect(doc.foo).toBe(1);
    expect(doc.mcpServers[SERVER_NAME]).toEqual(getTarget('claude').entry);
  });

  it('codex: an equal entry written with a subtable is recognised as unchanged', async () => {
    const before = [
      `[mcp_servers.${SERVER_NAME}]`,
      "command = 'npx'",
      'args = [',
      '  "-y",',
      '  "github:GemachDAO/gdex-skill", # source',
      '  "gdex-mcp-server",',
      ']',
      '',
      `[mcp_servers.${SERVER_NAME}.env]`,
      'GDEX_API_KEY = "9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54"',
      '',
    ].join('\n');
    await put('.codex/config.toml', before);
    expect((await initClientConfig({ client: 'codex', cwd })).status).toBe('unchanged');
    expect(await read('.codex/config.toml')).toBe(before);
  });

  it('codex: refuses to edit an entry defined with dotted keys', async () => {
    const before = `[mcp_servers]\n${SERVER_NAME}.command = "node"\n`;
    await put('.codex/config.toml', before);
    const res = await initClientConfig({ client: 'codex', cwd, force: true });
    expect(res.status).toBe('invalid');
    expect(await read('.codex/config.toml')).toBe(before);
  });

  it('codex: rejects duplicate tables as invalid', async () => {
    const before = '[a]\nx = 1\n[a]\ny = 2\n';
    await put('.codex/config.toml', before);
    expect((await initClientConfig({ client: 'codex', cwd })).status).toBe('invalid');
    expect(await read('.codex/config.toml')).toBe(before);
  });

  it('codex: keeps CRLF line endings', async () => {
    await put('.codex/config.toml', 'model = "x"\r\n\r\n[mcp_servers.other]\r\ncommand = "o"\r\n');
    expect((await initClientConfig({ client: 'codex', cwd })).status).toBe('merged');
    const after = await read('.codex/config.toml');
    expect(after.replace(/\r\n/g, '')).not.toContain('\n');
  });
});

describe('handleInit exit codes', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns 0 on create and on an idempotent rerun', async () => {
    expect(await handleInit(['init', '--client', 'claude'], cwd)).toBe(0);
    expect(await handleInit(['init', '--client', 'claude'], cwd)).toBe(0);
  });

  it('returns 1 on conflict, 0 with --force', async () => {
    await put('.mcp.json', JSON.stringify({ mcpServers: { [SERVER_NAME]: { command: 'node' } } }));
    expect(await handleInit(['init', '--client', 'claude'], cwd)).toBe(1);
    expect(await handleInit(['init', '--client', 'claude', '--force'], cwd)).toBe(0);
  });

  it('returns 1 for an invalid file and for bad arguments', async () => {
    await put('.mcp.json', 'not json');
    expect(await handleInit(['init', '--client', 'claude'], cwd)).toBe(1);
    expect(await handleInit(['init'], cwd)).toBe(1);
    expect(await handleInit(['init', '--client', 'nope'], cwd)).toBe(1);
    expect(await handleInit(['init', '--help'], cwd)).toBe(0);
  });
});

describe('init --client opencode', () => {
  it('writes opencode.json in the project root with OpenCode\'s local-server shape', async () => {
    const res = await initClientConfig({ client: 'opencode', cwd });
    expect(res.status).toBe('created');
    expect(res.path).toBe('opencode.json');
    const doc = parseJsonConfig(await read('opencode.json'), true) as Record<string, any>;
    expect(doc.$schema).toBe('https://opencode.ai/config.json');
    expect(doc.mcpServers).toBeUndefined();
    expect(doc.mcp[SERVER_NAME]).toEqual({
      type: 'local',
      command: ['npx', '-y', 'github:GemachDAO/gdex-skill', 'gdex-mcp-server'],
      environment: { GDEX_API_KEY: '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54' },
      enabled: true,
    });
    expect(existsSync(join(cwd, '.opencode', 'mcp.json'))).toBe(false);
  });

  it('merges into an existing opencode.jsonc, keeping comments, other servers and settings', async () => {
    const before = [
      '{',
      '  "$schema": "https://opencode.ai/config.json",',
      '  // my model',
      '  "model": "anthropic/claude-sonnet-4",',
      '  "mcp": {',
      '    "other": { "type": "remote", "url": "https://example.com/mcp", },',
      '  },',
      '}',
      '',
    ].join('\n');
    await put('opencode.jsonc', before);
    const res = await initClientConfig({ client: 'opencode', cwd });
    expect(res.status).toBe('merged');
    expect(res.path).toBe('opencode.jsonc');
    expect(existsSync(join(cwd, 'opencode.json'))).toBe(false);
    const after = await read('opencode.jsonc');
    expect(after).toContain('// my model');
    const doc = parseJsonConfig(after, true) as Record<string, any>;
    expect(doc.model).toBe('anthropic/claude-sonnet-4');
    expect(doc.mcp.other).toEqual({ type: 'remote', url: 'https://example.com/mcp' });
    expect(doc.mcp[SERVER_NAME]).toEqual(getTarget('opencode', cwd).entry);
    expect((await initClientConfig({ client: 'opencode', cwd })).status).toBe('unchanged');
  });

  it('prefers opencode.json when both files exist', async () => {
    await put('opencode.json', '{\n  "mcp": {}\n}\n');
    await put('opencode.jsonc', '{\n  "mcp": {}\n}\n');
    expect((await initClientConfig({ client: 'opencode', cwd })).path).toBe('opencode.json');
    expect(await read('opencode.jsonc')).toBe('{\n  "mcp": {}\n}\n');
  });

  it('points out the legacy .opencode/mcp.json that OpenCode never read', async () => {
    await put('.opencode/mcp.json', '{ "mcpServers": {} }');
    const res = await initClientConfig({ client: 'opencode', cwd });
    expect(res.status).toBe('created');
    expect(res.message).toMatch(/\.opencode\/mcp\.json .* not read by OpenCode/);
  });
});
