// Docker image built from the repo Dockerfile: start it over stdio with no network and check
// tools/list and the bundled guides.
//   npm run test:artifacts:docker
// Set GDEX_DOCKER_IMAGE to test an existing image instead of building one.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBundledGuides, startServer } from '../../scripts/artifacts/mcp-stdio.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERSION = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version;
const IMAGE = process.env.GDEX_DOCKER_IMAGE || 'gdex-mcp-server:artifact-test';
const NAME = `gdex-mcp-artifact-${process.pid}`;
const STRICT = process.env.GDEX_STRICT_ARTIFACTS === '1';

const docker = (args, opts = {}) => execFileSync('docker', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
let client;
let startMs;

before(() => {
  if (!process.env.GDEX_DOCKER_IMAGE) {
    const t0 = Date.now();
    docker(['build', '-t', IMAGE, '.'], { timeout: 900_000, maxBuffer: 64 * 1024 * 1024 });
    console.log(`docker build: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  const size = Number(docker(['image', 'inspect', '--format', '{{.Size}}', IMAGE]).trim());
  console.log(`image ${IMAGE}: ${(size / 1e6).toFixed(0)} MB`);
});

after(() => {
  client?.close();
  try { docker(['rm', '-f', NAME]); } catch { /* already gone (--rm) */ }
});

describe(`docker image (${IMAGE})`, () => {
  it('starts over stdio without network and answers initialize', async () => {
    const t0 = Date.now();
    client = startServer('docker', ['run', '-i', '--rm', '--network', 'none', '--name', NAME, IMAGE], { cwd: REPO, env: { HOME: process.env.HOME ?? '/tmp' } });
    client.timeoutMs = 60_000;
    const init = await client.initialize('docker-artifact-test');
    startMs = Date.now() - t0;
    console.log(`container start -> initialize: ${startMs} ms`);
    assert.equal(init.serverInfo.name, 'gdex-mcp-server');
    assert.equal(init.serverInfo.version, VERSION, 'image reports a different version than package.json');
  });

  it('tools/list and the guide tools return bundled content', async () => {
    await assertBundledGuides(client, assert);
  });

  it('can load the HyperLiquid trader for perp reads', {
    // @gdexsdk/hyper-liquid-trader is a runtime import esbuild cannot bundle; the image installs it
    // from mcp-server/package.json dependencies. This was broken in 5.0.0.
  }, async () => {
    // With --network none a working build fails on DNS, not on module resolution.
    const r = await client.call('get_mark_price', { coin: 'BTC' });
    assert.doesNotMatch(r.text, /ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM|Cannot find (package|module)/, r.text);
  });
});
