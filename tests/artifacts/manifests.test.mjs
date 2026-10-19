// Release manifests: Claude Code marketplace + plugin, Gemini extension, .mcp.json files,
// Glama and MCP Registry metadata. Offline; no build needed.
//   npm run test:manifests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffPluginSkills } from '../../scripts/sync-plugin-skills.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(REPO, p), 'utf8');
const json = (p) => {
  try {
    return JSON.parse(read(p));
  } catch (e) {
    throw new Error(`${p} is not valid JSON: ${e.message}`);
  }
};

const ROOT_PKG = json('package.json');
const MCP_PKG = json('mcp-server/package.json');
const VERSION = ROOT_PKG.version;
const MCP_NAME = MCP_PKG.name; // @gemachdao/gdex-mcp-server
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const MANIFESTS = [
  '.claude-plugin/marketplace.json',
  'plugins/gdex/.claude-plugin/plugin.json',
  'plugins/gdex/.mcp.json',
  'gemini-extension.json',
  '.mcp.json',
  'glama.json',
  'mcp-server/server.json',
];
// Files that are scanned for `npx @gemachdao/gdex-mcp-server@x.y.z` pins and skill-count claims.
const PIN_FILES = [...MANIFESTS, 'README.md', 'mcp-server/README.md', 'plugins/gdex/README.md'];

const SKILLS = readdirSync(join(REPO, 'skills'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(REPO, 'skills', d.name, 'SKILL.md')))
  .map((d) => d.name)
  .sort();

function assertString(v, where) {
  assert.equal(typeof v, 'string', `${where} must be a string`);
  assert.ok(v.trim().length > 0, `${where} must be non-empty`);
}

/** Validates an `mcpServers` map and returns every pinned version found in its args. */
function checkMcpServers(servers, where) {
  assert.ok(servers && typeof servers === 'object' && !Array.isArray(servers), `${where}.mcpServers must be an object`);
  const entries = Object.entries(servers);
  assert.ok(entries.length > 0, `${where}.mcpServers is empty`);
  for (const [name, s] of entries) {
    const w = `${where}.mcpServers.${name}`;
    assert.match(name, KEBAB, `${w}: server key should be kebab-case`);
    assertString(s.command, `${w}.command`);
    assert.ok(Array.isArray(s.args) && s.args.every((a) => typeof a === 'string'), `${w}.args must be a string array`);
    if (s.env !== undefined) {
      assert.ok(typeof s.env === 'object' && !Array.isArray(s.env), `${w}.env must be an object`);
      for (const [k, v] of Object.entries(s.env)) {
        assert.match(k, /^[A-Z][A-Z0-9_]*$/, `${w}.env key ${k}`);
        assert.equal(typeof v, 'string', `${w}.env.${k} must be a string`);
      }
    }
    if (s.command === 'npx') {
      const spec = s.args.find((a) => a.startsWith(`${MCP_NAME}`));
      assert.ok(spec, `${w}: npx args do not name ${MCP_NAME}`);
      assert.equal(spec, `${MCP_NAME}@${VERSION}`, `${w}: npx must pin ${MCP_NAME}@${VERSION} (got ${spec})`);
      assert.ok(s.args.includes('-y') || s.args.includes('--yes'), `${w}: npx needs -y to run non-interactively`);
    }
  }
}

describe('package versions', () => {
  it('root and mcp-server package.json versions match and are semver', () => {
    assert.match(VERSION, SEMVER);
    assert.equal(MCP_PKG.version, VERSION, 'mcp-server/package.json version differs from package.json');
  });

  it('bin targets exist', () => {
    for (const [pkgDir, pkg] of [['.', ROOT_PKG], ['mcp-server', MCP_PKG]]) {
      for (const [bin, target] of Object.entries(pkg.bin ?? {})) {
        assert.ok(existsSync(join(REPO, pkgDir, target)), `${pkgDir}/package.json bin ${bin} -> ${target} is missing (run npm run build:mcp)`);
      }
    }
  });

  it('engines.node is declared identically in both packages', () => {
    assert.match(ROOT_PKG.engines?.node ?? '', /^>=\d+/, 'package.json engines.node');
    assert.equal(MCP_PKG.engines?.node, ROOT_PKG.engines.node, 'mcp-server engines.node differs from root');
  });
});

describe('manifests are well-formed', () => {
  for (const p of MANIFESTS) {
    it(`${p} parses as JSON`, () => {
      assert.ok(existsSync(join(REPO, p)), `${p} is missing`);
      json(p);
    });
  }

  it('.claude-plugin/marketplace.json', () => {
    const m = json('.claude-plugin/marketplace.json');
    assert.match(m.name, KEBAB, 'marketplace name must be kebab-case');
    assertString(m.owner?.name, 'owner.name');
    assert.ok(Array.isArray(m.plugins) && m.plugins.length > 0, 'plugins[] must be non-empty');
    const names = new Set();
    for (const [i, p] of m.plugins.entries()) {
      const w = `plugins[${i}]`;
      assert.match(p.name, KEBAB, `${w}.name`);
      assert.ok(!names.has(p.name), `duplicate plugin ${p.name}`);
      names.add(p.name);
      assertString(p.description, `${w}.description`);
      assert.equal(typeof p.source, 'string', `${w}.source must be a relative path for this repo`);
      assert.match(p.source, /^\.\//, `${w}.source must start with ./`);
      const manifest = join(REPO, p.source, '.claude-plugin', 'plugin.json');
      assert.ok(existsSync(manifest), `${w}.source has no .claude-plugin/plugin.json`);
      const plugin = JSON.parse(readFileSync(manifest, 'utf8'));
      assert.equal(plugin.name, p.name, `${w}.name differs from the plugin manifest name`);
      if (p.version !== undefined) assert.equal(p.version, plugin.version, `${w}.version differs from plugin.json`);
      if (p.tags !== undefined) assert.ok(Array.isArray(p.tags) && p.tags.every((t) => typeof t === 'string'), `${w}.tags`);
    }
  });

  it('plugins/gdex/.claude-plugin/plugin.json', () => {
    const p = json('plugins/gdex/.claude-plugin/plugin.json');
    assert.match(p.name, KEBAB);
    assert.equal(p.version, VERSION, 'plugin.json version must equal package.json version');
    assertString(p.description, 'description');
    if (p.author !== undefined) assertString(p.author.name, 'author.name');
    if (p.keywords !== undefined) assert.ok(Array.isArray(p.keywords), 'keywords must be an array');
    checkMcpServers(p.mcpServers, 'plugin.json');
    // Every ${user_config.X} reference must resolve to a declared userConfig option.
    const declared = new Set(Object.keys(p.userConfig ?? {}));
    for (const [k, opt] of Object.entries(p.userConfig ?? {})) {
      assert.match(k, /^[a-z][a-z0-9_]*$/, `userConfig key ${k}`);
      assert.ok(['string', 'number', 'boolean', 'directory', 'file'].includes(opt.type), `userConfig.${k}.type ${opt.type}`);
      assertString(opt.title ?? opt.description, `userConfig.${k}.title`);
    }
    for (const ref of JSON.stringify(p).matchAll(/\$\{user_config\.([A-Za-z0-9_]+)\}/g)) {
      assert.ok(declared.has(ref[1]), `\${user_config.${ref[1]}} is not declared in userConfig`);
    }
    // The plugin ships skills from its own directory.
    assert.ok(existsSync(join(REPO, 'plugins/gdex/skills')), 'plugins/gdex/skills is missing');
  });

  it('plugins/gdex/.mcp.json and .mcp.json', () => {
    checkMcpServers(json('plugins/gdex/.mcp.json').mcpServers, 'plugins/gdex/.mcp.json');
    checkMcpServers(json('.mcp.json').mcpServers, '.mcp.json');
    assert.deepEqual(json('plugins/gdex/.mcp.json').mcpServers.gdex.args, json('plugins/gdex/.claude-plugin/plugin.json').mcpServers.gdex.args,
      'plugin .mcp.json and plugin.json launch the server differently');
  });

  it('gemini-extension.json', () => {
    const g = json('gemini-extension.json');
    assert.match(g.name, KEBAB);
    assert.equal(g.version, VERSION, 'gemini-extension.json version must equal package.json version');
    assertString(g.description, 'description');
    checkMcpServers(g.mcpServers, 'gemini-extension.json');
    for (const [i, s] of (g.settings ?? []).entries()) {
      assertString(s.name, `settings[${i}].name`);
      assertString(s.description, `settings[${i}].description`);
      assert.match(s.envVar ?? '', /^[A-Z][A-Z0-9_]*$/, `settings[${i}].envVar`);
    }
    if (g.contextFileName !== undefined) {
      for (const f of [].concat(g.contextFileName)) assert.ok(existsSync(join(REPO, f)), `contextFileName ${f} is missing`);
    }
  });

  it('glama.json', () => {
    const g = json('glama.json');
    assert.match(g.$schema ?? '', /^https:\/\/glama\.ai\/mcp\/schemas\/server\.json$/);
    assert.ok(Array.isArray(g.maintainers) && g.maintainers.length > 0, 'maintainers[] must be non-empty');
    for (const m of g.maintainers) assert.match(m, /^[A-Za-z0-9-]+$/, `maintainer ${m} must be a GitHub username`);
  });

  it('mcp-server/server.json (MCP Registry)', () => {
    const s = json('mcp-server/server.json');
    assert.match(s.$schema ?? '', /^https:\/\/static\.modelcontextprotocol\.io\/schemas\/[0-9-]+\/server\.schema\.json$/);
    assert.equal(s.name, MCP_PKG.mcpName, 'server.json name must equal mcp-server package.json mcpName');
    assert.match(s.name, /^io\.github\.[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/);
    assertString(s.description, 'description');
    assert.ok(s.description.length <= 100, `description is ${s.description.length} chars; the MCP Registry caps it at 100`);
    assert.equal(s.version, VERSION, 'server.json version');
    assert.ok(Array.isArray(s.packages) && s.packages.length > 0, 'packages[]');
    const npm = s.packages.find((p) => p.registryType === 'npm');
    assert.ok(npm, 'no npm package entry');
    assert.equal(npm.identifier, MCP_NAME);
    assert.equal(npm.version, VERSION, 'server.json packages[npm].version');
    assert.equal(npm.transport?.type, 'stdio');
    for (const e of npm.environmentVariables ?? []) {
      assert.match(e.name, /^[A-Z][A-Z0-9_]*$/);
      assertString(e.description, `env ${e.name}.description`);
    }
    assert.equal(s.repository?.subfolder, 'mcp-server');
    assert.ok(existsSync(join(REPO, s.repository.subfolder, 'package.json')), 'repository.subfolder has no package.json');
  });
});

describe('version pins', () => {
  for (const p of PIN_FILES) {
    it(`every ${MCP_NAME}@x.y.z pin in ${p} equals ${VERSION}`, () => {
      const text = read(p);
      const pins = [...text.matchAll(/@gemachdao\/gdex-mcp-server@(\d+\.\d+\.\d+[0-9A-Za-z.-]*)/g)].map((m) => m[1]);
      for (const v of pins) assert.equal(v, VERSION, `${p} pins ${MCP_NAME}@${v}`);
    });
  }
});

describe('plugin skills', () => {
  it('plugins/gdex/skills is byte-identical to skills/ (scripts/sync-plugin-skills.mjs --check)', () => {
    assert.deepEqual(diffPluginSkills(REPO), [], 'run npm run sync:plugin-skills');
  });

  it('every skill has a SKILL.md with name frontmatter matching its directory', () => {
    assert.ok(SKILLS.length > 0);
    for (const s of SKILLS) {
      const md = read(`skills/${s}/SKILL.md`);
      const name = /^---\n[\s\S]*?^name:\s*["']?([^"'\n]+)["']?\s*$/m.exec(md)?.[1];
      assert.equal(name, s, `skills/${s}/SKILL.md frontmatter name`);
    }
  });

  it('skills.sh.json groups every skill exactly once and names no missing skill', () => {
    const grouped = json('skills.sh.json').groupings.flatMap((g) => g.skills);
    assert.equal(new Set(grouped).size, grouped.length, 'a skill is listed in two groupings');
    for (const s of grouped) assert.ok(SKILLS.includes(s), `skills.sh.json lists unknown skill ${s}`);
    if (json('skills.sh.json').notGrouped === undefined) assert.deepEqual([...grouped].sort(), SKILLS);
  });

  it('skill counts claimed in manifests and READMEs match the real count', () => {
    for (const p of PIN_FILES) {
      for (const m of read(p).matchAll(/\b(\d+)\s+(?:agent\s+|GDEX\s+|bundled\s+)?skills\b/gi)) {
        // "3 skills" style references inside shell examples are not counts of the bundle; only
        // flag numbers that are plausibly a total (>= 10).
        const n = Number(m[1]);
        if (n >= 10) assert.equal(n, SKILLS.length, `${p} claims ${m[0]} but skills/ has ${SKILLS.length}`);
      }
    }
  });
});

describe('known release-metadata drift', () => {
  // skill.json ships in the npm tarball (package.json "files") but release.yml never bumps it.
  it('skill.json version equals package.json version', () => {
    assert.equal(json('skill.json').version, VERSION);
  });
});
