// Minimal MCP stdio client for the release-artifact tests (tests/artifacts/*.test.mjs).
// Same line-delimited JSON-RPC approach as mcp-server/tests/packedArtifact.test.ts, but plain
// ESM JavaScript so it runs on every Node version in `engines` without a TypeScript toolchain.
import { spawn } from 'node:child_process';

export class StdioClient {
  constructor(proc, { timeoutMs = 30_000 } = {}) {
    this.proc = proc;
    this.timeoutMs = timeoutMs;
    this.buf = '';
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = '';
    this.stdoutNoise = [];
    this.exited = null;
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      this.buf += chunk;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          this.stdoutNoise.push(line); // anything non-JSON on stdout corrupts the MCP channel
          continue;
        }
        const cb = this.pending.get(msg.id);
        if (cb) {
          this.pending.delete(msg.id);
          cb(msg);
        }
      }
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (c) => { this.stderr += c; });
    proc.on('exit', (code, signal) => {
      this.exited = { code, signal };
      for (const [id, cb] of this.pending) cb({ id, error: { message: `server exited (${code ?? signal}); stderr: ${this.stderr}` } });
      this.pending.clear();
    });
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (this.exited) return reject(new Error(`server already exited; stderr: ${this.stderr}`));
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${this.timeoutMs}ms; stderr: ${this.stderr}`));
      }, this.timeoutMs);
      this.pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  notify(method, params) {
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) })}\n`);
  }

  async initialize(clientName = 'gdex-artifact-test') {
    const init = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: clientName, version: '1' },
    });
    if (init.error) throw new Error(`initialize failed: ${JSON.stringify(init.error)}`);
    this.notify('notifications/initialized');
    return init.result;
  }

  async listTools() {
    const r = await this.request('tools/list', {});
    if (r.error) throw new Error(`tools/list failed: ${JSON.stringify(r.error)}`);
    return r.result.tools;
  }

  /** Calls a tool and returns { text, isError }. */
  async call(name, args = {}) {
    const r = await this.request('tools/call', { name, arguments: args });
    if (r.error) throw new Error(`tools/call ${name} failed: ${JSON.stringify(r.error)}`);
    return { text: String(r.result?.content?.[0]?.text ?? ''), isError: Boolean(r.result?.isError) };
  }

  close() {
    if (!this.exited) this.proc.kill();
  }
}

/** Spawns `command args` with a scrubbed environment (no inherited GDEX_* credentials). */
export function startServer(command, args, { cwd, home, env = {} } = {}) {
  const proc = spawn(command, args, {
    cwd,
    env: { PATH: process.env.PATH ?? '', ...(home ? { HOME: home, GDEX_HOME: `${home}/.gdex` } : {}), ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return new StdioClient(proc);
}

// Tools every distribution must expose; the doc tools must answer from the bundled skill registry.
export const REQUIRED_TOOLS = ['get_trading_guide', 'search_gdex_docs', 'explain_workflow', 'get_sdk_pattern', 'get_skill_file'];

/** Asserts the doc tools return real bundled guide content. Throws on the first failure. */
export async function assertBundledGuides(client, assert) {
  const tools = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const t of REQUIRED_TOOLS) assert.ok(names.includes(t), `tools/list is missing ${t}`);
  assert.ok(names.length >= 20, `expected the full tool surface, got ${names.length} tools`);

  const spot = await client.call('get_trading_guide', { type: 'spot' });
  assert.equal(spot.isError, false, spot.text);
  assert.doesNotMatch(spot.text, /No trading guide found/);
  assert.match(spot.text, /# GDEX: Spot Trading/);
  assert.match(spot.text, /buyToken/);
  assert.ok(spot.text.length > 2000, `spot guide suspiciously short (${spot.text.length} chars)`);

  const perp = await client.call('get_trading_guide', { type: 'perp' });
  assert.equal(perp.isError, false, perp.text);
  assert.doesNotMatch(perp.text, /No trading guide found/);

  const search = await client.call('search_gdex_docs', { query: 'outcome' });
  assert.doesNotMatch(search.text, /^No results found/);
  assert.match(search.text, /### gdex-hl-outcomes/);

  const script = await client.call('get_skill_file', { skill: 'gdex-token-risk', path: 'scripts/token_risk.py' });
  assert.match(script.text, /def /);

  assert.deepEqual(client.stdoutNoise, [], 'non-JSON output on stdout');
  assert.doesNotMatch(client.stderr, /no GDEX skill documentation available/);
  return names;
}
