/**
 * GDX-05: run the server exactly as npm ships it. `npm pack` the package into a temp
 * dir outside the repo (so no skills/ directory is reachable), start
 * `node package/dist/index.js` and call the documentation tools over MCP stdio.
 *
 * Uses the committed bundle: run `npm run build:mcp` from the repo root first
 * (CI does, before this job's tests).
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MCP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface RpcResponse { id: number; result?: any; error?: any }

class StdioClient {
  private buf = '';
  private nextId = 1;
  private pending = new Map<number, (r: RpcResponse) => void>();
  stderr = '';
  stdoutNoise: string[] = [];

  constructor(private proc: ChildProcessWithoutNullStreams) {
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => {
      this.buf += chunk;
      let i: number;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as RpcResponse;
          this.pending.get(msg.id)?.(msg);
          this.pending.delete(msg.id);
        } catch {
          this.stdoutNoise.push(line); // anything non-JSON on stdout corrupts the MCP channel
        }
      }
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (c: string) => { this.stderr += c; });
  }

  request(method: string, params: unknown): Promise<RpcResponse> {
    const id = this.nextId++;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`${method} timed out; stderr: ${this.stderr}`)), 20_000);
      this.pending.set(id, (r) => { clearTimeout(timer); res(r); });
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  notify(method: string): void {
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  }

  async callText(name: string, args: Record<string, unknown>): Promise<string> {
    const r = await this.request('tools/call', { name, arguments: args });
    expect(r.error).toBeUndefined();
    return String(r.result?.content?.[0]?.text ?? '');
  }
}

let work: string;
let proc: ChildProcessWithoutNullStreams;
let client: StdioClient;

beforeAll(async () => {
  if (!existsSync(join(MCP_DIR, 'dist', 'index.js'))) {
    throw new Error('mcp-server/dist/index.js missing: run `npm run build:mcp` from the repo root');
  }
  work = await mkdtemp(join(tmpdir(), 'gdex-mcp-packed-'));
  execFileSync('npm', ['pack', '--pack-destination', work, '--silent'], { cwd: MCP_DIR, stdio: 'pipe' });
  const tgz = readdirSync(work).find((f) => f.endsWith('.tgz'));
  if (!tgz) throw new Error('npm pack produced no tarball');
  execFileSync('tar', ['xzf', tgz], { cwd: work });
  // The published package carries no docs directory, so the registry must be bundled.
  expect(existsSync(join(work, 'package', 'skills'))).toBe(false);

  proc = spawn(process.execPath, [join(work, 'package', 'dist', 'index.js')], {
    cwd: work,
    env: { PATH: process.env.PATH ?? '', HOME: work, GDEX_HOME: join(work, '.gdex') },
  });
  client = new StdioClient(proc);
  const init = await client.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'packed-artifact-test', version: '1' },
  });
  expect(init.result?.serverInfo?.name).toBe('gdex-mcp-server');
  client.notify('notifications/initialized');
}, 120_000);

afterAll(async () => {
  proc?.kill();
  if (work) await rm(work, { recursive: true, force: true });
});

describe('packed @gemachdao/gdex-mcp-server', () => {
  it('get_trading_guide spot returns the spot trading skill', async () => {
    const text = await client.callText('get_trading_guide', { type: 'spot' });
    expect(text).not.toMatch(/No trading guide found/);
    expect(text).toMatch(/# GDEX: Spot Trading/);
    expect(text).toMatch(/buyToken/);
  });

  it('search_gdex_docs outcome finds the outcome markets skill', async () => {
    const text = await client.callText('search_gdex_docs', { query: 'outcome' });
    expect(text).not.toMatch(/^No results found/);
    expect(text).toMatch(/### gdex-hl-outcomes/);
  });

  it('explain_workflow returns real guides (hand-written and skill-backed)', async () => {
    const perp = await client.callText('explain_workflow', { workflow: 'perp-trade' });
    expect(perp).toMatch(/hlCreateOrder/);
    expect(perp).not.toMatch(/skill\.openPerpPosition\(/);
    const bridge = await client.callText('explain_workflow', { workflow: 'bridge' });
    expect(bridge).not.toMatch(/No workflow guide found/);
    expect(bridge).toMatch(/estimateBridge/);
  });

  it('get_sdk_pattern and get_skill_file serve bundled content', async () => {
    const pattern = await client.callText('get_sdk_pattern', { operation: 'perp-trade' });
    expect(pattern).toMatch(/```typescript/);
    const script = await client.callText('get_skill_file', { skill: 'gdex-token-risk', path: 'scripts/token_risk.py' });
    expect(script).toMatch(/def /);
  });

  it('keeps stdout clean and logs no missing-knowledge warning', () => {
    expect(client.stdoutNoise).toEqual([]);
    expect(client.stderr).not.toMatch(/no GDEX skill documentation available/);
  });
});
