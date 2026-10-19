// Root SDK package as npm publishes it: `npm pack` @gemachdao/gdex-skill, install the tarball
// into a fresh project outside the repo, then exercise it as a consumer would (CJS require, ESM
// import, TypeScript types, the gdex-mcp-server bin over MCP stdio) and secret-scan the tarball.
//
//   npm run build && npm run build:mcp   # the tarball packs the committed/built dist trees
//   npm run test:artifacts
//
// Needs the npm registry (to install the package's dependencies); never calls the GDEX backend.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBundledGuides, startServer } from '../../scripts/artifacts/mcp-stdio.mjs';
import { scanPackageDir } from '../../scripts/artifacts/secret-scan.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PKG = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const KEY_EXPORTS = ['GdexSkill', 'normalizeChain', 'closePerpPosition', 'buyWithUsdc', 'watchUsdcTrade', 'GdexSubmissionUnknownError'];
const [MAJOR, MINOR] = process.versions.node.split('.').map(Number);
// require(esm) is unflagged from Node 20.19 / 22.12; @nktkas/hyperliquid (via
// @gdexsdk/hyper-liquid-trader) needs it, and declares engines >=20.19 itself.
// GDEX_STRICT_ARTIFACTS=1 turns known-defect todos into hard failures.
const STRICT = process.env.GDEX_STRICT_ARTIFACTS === '1';
const HAS_REQUIRE_ESM = MAJOR > 22 || (MAJOR === 22 && MINOR >= 12) || (MAJOR === 20 && MINOR >= 19);

let work;
let proj;
let packed; // npm pack --json entry
let client;

function run(cmd, args, cwd, opts = {}) {
  try {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts });
  } catch (e) {
    // Surface the child's output; execFileSync's own message omits it.
    throw new Error(`${cmd} ${args.join(' ').slice(0, 200)} failed (${e.status ?? e.signal}):\n${e.stdout ?? ''}\n${e.stderr ?? ''}`);
  }
}
const nodeIn = (cwd, args) => run(process.execPath, args, cwd);

before(async () => {
  for (const f of ['dist/index.js', 'dist/index.d.ts', 'mcp-server/dist/index.js']) {
    assert.ok(existsSync(join(REPO, f)), `${f} missing: run npm run build && npm run build:mcp first`);
  }
  work = await mkdtemp(join(tmpdir(), 'gdex-skill-packed-'));
  // --ignore-scripts: pack exactly the trees CI just built. npm 10.8 (Node 18) runs `prepare`
  // (tsc) anyway and prints its banner on stdout, so parse the JSON array that follows it.
  const packOut = run(NPM, ['pack', '--ignore-scripts', '--json', '--pack-destination', work], REPO);
  packed = JSON.parse(packOut.slice(packOut.search(/^\[/m)))[0];
  const tgz = join(work, packed.filename);
  mkdirSync(join(work, 'extracted'));
  run('tar', ['xzf', tgz, '-C', join(work, 'extracted')], work);

  proj = join(work, 'consumer');
  mkdirSync(proj);
  run(NPM, ['init', '-y'], proj);
  run(NPM, ['install', '--no-audit', '--no-fund', '--loglevel=error', tgz], proj, { timeout: 300_000 });
});

after(async () => {
  client?.close();
  if (work && !process.env.KEEP_ARTIFACT_TMP) await rm(work, { recursive: true, force: true });
});

describe('packed file list', () => {
  it('ships the runtime, types, bin, server package.json and every skill', () => {
    const files = new Set(packed.files.map((f) => f.path));
    for (const f of ['package.json', 'README.md', 'dist/index.js', 'dist/index.d.ts', 'mcp-server/dist/index.js', 'mcp-server/package.json']) {
      assert.ok(files.has(f), `tarball is missing ${f}`);
    }
    assert.ok(files.has(PKG.bin['gdex-mcp-server']), 'bin target is not packed');
    assert.ok(files.has(PKG.types), 'types entry is not packed');
    for (const s of run('ls', ['skills'], REPO).split('\n').filter(Boolean)) {
      if (existsSync(join(REPO, 'skills', s, 'SKILL.md'))) assert.ok(files.has(`skills/${s}/SKILL.md`), `skills/${s}/SKILL.md not packed`);
    }
  });

  it('ships no dev scripts, tests, env files, harness or nested node_modules', () => {
    const banned = [
      /^scripts\//, // repo dev/live-trading scripts (skills/*/scripts/ companions are intended)
      /^tests?\//, /^mcp-server\/tests\//, /^harness\//, /^examples\//, /^plugins\//, /^\.github\//,
      /(^|\/)node_modules\//, /(^|\/)\.env(\.|$)/, /\.tgz$/, /^coverage\//, /wallet.*\.json$/i, /\.pem$|\.key$/,
    ];
    const bad = packed.files.map((f) => f.path).filter((p) => banned.some((re) => re.test(p)));
    assert.deepEqual(bad, []);
  });
});

describe('release secret scan', () => {
  it('the scanner catches a planted key and seed phrase (negative control)', async () => {
    const dir = join(work, 'scan-control');
    mkdirSync(dir);
    writeFileSync(join(dir, 'leak.js'), `const k = "0x${'ab'.repeat(32)}";\n// legal winner thank year wave sausage worth useful legal winner thank yellow\n`);
    const kinds = scanPackageDir(dir).map((f) => f.kind).sort();
    assert.deepEqual(kinds, ['bip39-mnemonic-valid', 'hex64']);
  });

  it('the packed tarball has no private keys, seed phrases or tokens', () => {
    const findings = scanPackageDir(join(work, 'extracted', 'package'));
    assert.deepEqual(findings, [], findings.map((f) => `${f.kind} ${f.file} ${f.match}`).join('\n'));
  });
});

describe('installed @gemachdao/gdex-skill', () => {
  it('require() (CommonJS) exposes GdexSkill and the key exports', () => {
    const out = nodeIn(proj, ['-e', `
      const m = require('@gemachdao/gdex-skill');
      const r = {};
      for (const k of ${JSON.stringify(KEY_EXPORTS)}) r[k] = typeof m[k];
      r.errorIsError = m.GdexSubmissionUnknownError.prototype instanceof Error;
      r.chain = m.normalizeChain('base');
      const s = new m.GdexSkill();
      r.methods = ['buyToken', 'closePerpPosition', 'buyWithUsdc', 'watchUsdcTrade'].map((k) => typeof s[k]);
      r.resolved = require.resolve('@gemachdao/gdex-skill');
      console.log(JSON.stringify(r));`]);
    const r = JSON.parse(out);
    for (const k of KEY_EXPORTS) assert.equal(r[k], 'function', `${k} is ${r[k]}`);
    assert.equal(r.errorIsError, true);
    assert.equal(r.chain.id, 8453);
    assert.deepEqual(r.methods, ['function', 'function', 'function', 'function']);
    assert.ok(r.resolved.startsWith(proj), `resolved outside the consumer project: ${r.resolved}`);
  });

  it('import() (ESM) sees the same named exports', () => {
    const out = nodeIn(proj, ['--input-type=module', '-e', `
      const m = await import('@gemachdao/gdex-skill');
      console.log(JSON.stringify(${JSON.stringify(KEY_EXPORTS)}.map((k) => typeof m[k])));`]);
    assert.deepEqual(JSON.parse(out), KEY_EXPORTS.map(() => 'function'));
  });

  it('the declared types type-check a consumer file', () => {
    assert.ok(existsSync(join(proj, 'node_modules/@gemachdao/gdex-skill', PKG.types)), 'types file not installed');
    writeFileSync(join(proj, 'check.ts'), `
import { GdexSkill, normalizeChain, closePerpPosition, buyWithUsdc, watchUsdcTrade, GdexSubmissionUnknownError } from '@gemachdao/gdex-skill';
const skill: GdexSkill = new GdexSkill();
const chain = normalizeChain('solana');
const id: number = chain.id;
const fns: Array<(...a: never[]) => unknown> = [closePerpPosition, buyWithUsdc, watchUsdcTrade, skill.buyToken];
const e: Error = new GdexSubmissionUnknownError('m', 'POST', '/x');
// @ts-expect-error normalizeChain does not accept an object
normalizeChain({});
export { id, fns, e };
`);
    writeFileSync(join(proj, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, module: 'commonjs', moduleResolution: 'node', target: 'ES2020', esModuleInterop: true, skipLibCheck: true, types: [] },
      files: ['check.ts'],
    }));
    const tsc = join(REPO, 'node_modules', 'typescript', 'bin', 'tsc');
    nodeIn(proj, [tsc, '-p', 'tsconfig.json']);
  });

  it(`the HyperLiquid trader dependency loads on Node ${process.versions.node}`, {
    todo: HAS_REQUIRE_ESM || STRICT ? false : `engines says ${PKG.engines.node}, but @nktkas/hyperliquid needs require(esm) (Node >=20.19); perp reads fail with ERR_REQUIRE_ESM here`,
  }, () => {
    // The same dynamic import the SDK's getHlTraderModule() performs; offline.
    nodeIn(proj, ['--input-type=module', '-e', "const m = await import('@gdexsdk/hyper-liquid-trader'); if (!m.HyperLiquidTrading) throw new Error('no HyperLiquidTrading export');"]);
  });
});

describe('installed gdex-mcp-server bin', () => {
  before(async () => {
    const bin = join(proj, 'node_modules', '.bin', 'gdex-mcp-server');
    assert.ok(existsSync(bin), 'node_modules/.bin/gdex-mcp-server was not linked');
    client = startServer(process.execPath, [bin], { cwd: proj, home: join(work, 'home') });
  });

  it('answers initialize with the package version', async () => {
    const init = await client.initialize();
    assert.equal(init.serverInfo.name, 'gdex-mcp-server');
    assert.equal(init.serverInfo.version, PKG.version);
  });

  it('lists the advertised tools and serves real bundled guides', async () => {
    const names = await assertBundledGuides(client, assert);
    const claim = /\((\d+) tools\)|\b(\d+) tools\b/.exec(readFileSync(join(REPO, 'mcp-server', 'README.md'), 'utf8'));
    if (claim) assert.equal(names.length, Number(claim[1] ?? claim[2]), `mcp-server/README.md claims ${claim[0]}`);
  });
});
