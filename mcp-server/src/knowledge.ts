import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export interface Skill {
  name: string;
  description: string;
  content: string;
  sections: Map<string, string>;
  /** Companion files shipped next to SKILL.md (e.g. scripts/foo.py), keyed by relative path. */
  files: Map<string, string>;
}

/** Shape of the registry scripts/build-mcp.mjs embeds (see scripts/skill-registry.mjs). */
export interface SkillRegistry {
  version: 1;
  skills: Array<{ name: string; description: string; content: string; files: Array<{ path: string; content: string }> }>;
}

// Replaced at bundle time by esbuild `define`; undefined under tsc / tsx / ts-jest.
declare const __GDEX_SKILL_REGISTRY__: SkillRegistry | undefined;

export type KnowledgeSource = 'bundled' | 'filesystem' | 'none';

let cachedSkills: Map<string, Skill> | null = null;
let knowledgeSource: KnowledgeSource = 'none';

function bundledRegistry(): SkillRegistry | null {
  return typeof __GDEX_SKILL_REGISTRY__ !== 'undefined' && __GDEX_SKILL_REGISTRY__ ? __GDEX_SKILL_REGISTRY__ : null;
}

function getSkillsDir(): string {
  // When running from dist/, skills are at ../../skills/
  // When running from src/ (dev), skills are at ../../skills/
  return resolve(__dirname, '..', '..', 'skills');
}

function getRootSkillPath(): string {
  return resolve(__dirname, '..', '..', 'SKILL.md');
}

function parseFrontmatter(content: string): { name: string; description: string; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { name: '', description: '', body: content };

  const frontmatter = match[1];
  const body = match[2];
  let name = '';
  let description = '';

  for (const line of frontmatter.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key === 'name') name = val;
    if (key === 'description') description = val;
  }

  return { name, description, body };
}

function parseSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = body.split('\n');
  let currentHeading = '';
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      if (currentHeading) {
        sections.set(currentHeading.toLowerCase(), currentContent.join('\n').trim());
      }
      currentHeading = headingMatch[1];
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  if (currentHeading) {
    sections.set(currentHeading.toLowerCase(), currentContent.join('\n').trim());
  }

  return sections;
}

async function readCompanionFiles(dir: string, prefix = ''): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === '__pycache__' || entry.name === 'node_modules') continue;
      for (const [k, v] of await readCompanionFiles(join(dir, entry.name), rel)) files.set(k, v);
    } else if (entry.isFile() && rel !== 'SKILL.md' && !/\.(pyc|pyo|png|jpe?g|gif|webp|ico|zip|gz|tgz)$/i.test(rel)) {
      files.set(rel, await readFile(join(dir, entry.name), 'utf-8'));
    }
  }
  return files;
}

async function findSkillDirs(dir: string): Promise<string[]> {
  const dirs: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = join(dir, entry.name, 'SKILL.md');
        try {
          await readFile(skillPath, 'utf-8');
          dirs.push(join(dir, entry.name));
        } catch {
          // Not a skill directory
        }
      }
    }
  } catch {
    // Skills directory not found
  }
  return dirs;
}

function fromRegistry(registry: SkillRegistry): Map<string, Skill> {
  const skills = new Map<string, Skill>();
  for (const entry of registry.skills) {
    skills.set(entry.name, {
      name: entry.name,
      description: entry.description,
      content: entry.content,
      sections: parseSections(entry.content),
      files: new Map(entry.files.map((f) => [f.path, f.content])),
    });
  }
  return skills;
}

async function fromFilesystem(skillsDir: string, rootSkillPath: string): Promise<Map<string, Skill>> {
  const skills = new Map<string, Skill>();
  const skillDirs = await findSkillDirs(skillsDir);

  for (const dir of skillDirs) {
    const content = await readFile(join(dir, 'SKILL.md'), 'utf-8');
    const { name, description, body } = parseFrontmatter(content);
    if (name) {
      skills.set(name, {
        name,
        description,
        content: body,
        sections: parseSections(body),
        files: await readCompanionFiles(dir),
      });
    }
  }

  // Also load the root SKILL.md as a special entry
  try {
    const rootContent = await readFile(rootSkillPath, 'utf-8');
    const { name, description, body } = parseFrontmatter(rootContent);
    skills.set('gdex-root', {
      name: 'gdex-root',
      description: description || name || 'Root skill router',
      content: body,
      sections: parseSections(body),
      files: new Map(),
    });
  } catch {
    // Root SKILL.md not found
  }

  return skills;
}

/**
 * Load the GDEX skills. A bundled build (scripts/build-mcp.mjs) carries them as an
 * embedded registry; only when that is missing (tsx dev, ts-jest) do we read the
 * repo's skills/ directory. Logs to stderr, never stdout (the MCP channel), when
 * no knowledge is available so the doc tools are not silently empty.
 */
export async function loadSkills(options: { registry?: SkillRegistry | null; skillsDir?: string } = {}): Promise<Map<string, Skill>> {
  if (cachedSkills) return cachedSkills;

  const registry = options.registry !== undefined ? options.registry : bundledRegistry();
  const skillsDir = options.skillsDir ?? getSkillsDir();
  let skills: Map<string, Skill>;
  if (registry && registry.skills.length > 0) {
    skills = fromRegistry(registry);
    knowledgeSource = 'bundled';
  } else {
    skills = await fromFilesystem(skillsDir, options.skillsDir ? join(skillsDir, '..', 'SKILL.md') : getRootSkillPath());
    knowledgeSource = skills.size > 0 ? 'filesystem' : 'none';
  }

  if (skills.size === 0) {
    console.error(
      `[gdex-mcp-server] warning: no GDEX skill documentation available (no bundled registry and no skills at ${skillsDir}). ` +
      'search_gdex_docs, get_trading_guide, get_sdk_pattern, explain_workflow and the other doc tools will return no content. ' +
      'Rebuild with `npm run build:mcp` to embed skills/.',
    );
  }

  cachedSkills = skills;
  return skills;
}

/** Where the loaded skills came from (after loadSkills()). */
export function getKnowledgeSource(): KnowledgeSource {
  return knowledgeSource;
}

/** Test hook: drop the cache so the next loadSkills() reloads. */
export function resetSkillCache(): void {
  cachedSkills = null;
  knowledgeSource = 'none';
}

export function searchSkills(skills: Map<string, Skill>, query: string): Array<{ skill: Skill; matches: string[] }> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results: Array<{ skill: Skill; score: number; matches: string[] }> = [];

  for (const skill of skills.values()) {
    let score = 0;
    const matches: string[] = [];
    const fullText = `${skill.name} ${skill.description} ${skill.content}`.toLowerCase();

    for (const term of terms) {
      if (fullText.includes(term)) {
        score++;
        // Find which sections match
        if (skill.name.toLowerCase().includes(term) || skill.description.toLowerCase().includes(term)) {
          matches.push(`name/description`);
        }
        for (const [heading, content] of skill.sections) {
          if (heading.includes(term) || content.toLowerCase().includes(term)) {
            matches.push(heading);
          }
        }
      }
    }

    if (score > 0) {
      results.push({ skill, score, matches: [...new Set(matches)] });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.map(r => ({ skill: r.skill, matches: r.matches }));
}

export function getSkillContent(skills: Map<string, Skill>, skillName: string): string | null {
  const skill = skills.get(skillName);
  return skill ? skill.content : null;
}

export function getSkillSection(skills: Map<string, Skill>, skillName: string, sectionHeading: string): string | null {
  const skill = skills.get(skillName);
  if (!skill) return null;
  return skill.sections.get(sectionHeading.toLowerCase()) ?? null;
}

export function getSkillFile(skills: Map<string, Skill>, skillName: string, path: string): string | null {
  const skill = skills.get(skillName);
  if (!skill) return null;
  return skill.files.get(path.replace(/^\.\//, '')) ?? null;
}

export function listSkills(skills: Map<string, Skill>): Array<{ name: string; description: string }> {
  return Array.from(skills.values())
    .filter(s => s.name !== 'gdex-root')
    .map(s => ({ name: s.name, description: s.description }));
}
