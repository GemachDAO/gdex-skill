// Collect every skills/*/SKILL.md (plus the text files each skill ships next to it,
// e.g. scripts/*.py) into one registry that build-mcp.mjs embeds in the MCP bundle.
// The published @gemachdao/gdex-mcp-server tarball and the Docker image carry only
// dist/index.js, so the documentation tools cannot read skills/ from disk there.
//
// Output is deterministic (sorted, no timestamps) so CI's stale-bundle check holds.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SKIP_DIRS = new Set(['__pycache__', 'node_modules', '.pytest_cache']);
const SKIP_FILES = /\.(pyc|pyo|png|jpe?g|gif|webp|ico|zip|gz|tgz)$/i;
const MAX_FILE_BYTES = 256 * 1024;

/** Same frontmatter rules as mcp-server/src/knowledge.ts and scripts/validate-skills.ts. */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { name: '', description: '', body: content };
  let name = '';
  let description = '';
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key === 'name') name = val;
    if (key === 'description') description = val;
  }
  return { name, description, body: match[2] };
}

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...listFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/** Companion files of one skill: every text file under its directory except SKILL.md. */
function companionFiles(skillDir) {
  const files = [];
  for (const full of listFiles(skillDir)) {
    const path = relative(skillDir, full).split(sep).join('/');
    if (path === 'SKILL.md' || SKIP_FILES.test(path)) continue;
    if (statSync(full).size > MAX_FILE_BYTES) {
      throw new Error(`${full} is larger than ${MAX_FILE_BYTES} bytes; keep bundled skill files small`);
    }
    const content = readFileSync(full, 'utf8');
    if (content.includes('\u0000')) continue; // binary
    files.push({ path, content });
  }
  return files;
}

/**
 * @param {string} skillsDir  path to the repo's skills/ directory
 * @param {string} [rootSkill] optional path to a root SKILL.md router
 * @returns {{ version: 1, skills: Array<{ name: string, description: string, content: string, files: Array<{ path: string, content: string }> }> }}
 */
export function buildSkillRegistry(skillsDir, rootSkill) {
  const skills = [];
  for (const entry of readdirSync(skillsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const dir = join(skillsDir, entry.name);
    const skillPath = join(dir, 'SKILL.md');
    if (!existsSync(skillPath)) continue;
    const { name, description, body } = parseFrontmatter(readFileSync(skillPath, 'utf8'));
    if (!name) throw new Error(`${skillPath} has no frontmatter name`);
    skills.push({ name, description, content: body, files: companionFiles(dir) });
  }
  if (rootSkill && existsSync(rootSkill)) {
    const { name, description, body } = parseFrontmatter(readFileSync(rootSkill, 'utf8'));
    skills.push({ name: 'gdex-root', description: description || name || 'Root skill router', content: body, files: [] });
  }
  if (skills.length === 0) throw new Error(`No skills found under ${skillsDir}`);
  return { version: 1, skills };
}
