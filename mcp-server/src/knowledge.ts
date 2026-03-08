import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export interface Skill {
  name: string;
  description: string;
  content: string;
  sections: Map<string, string>;
}

let cachedSkills: Map<string, Skill> | null = null;

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

export async function loadSkills(): Promise<Map<string, Skill>> {
  if (cachedSkills) return cachedSkills;

  const skills = new Map<string, Skill>();
  const skillsDir = getSkillsDir();
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
      });
    }
  }

  // Also load the root SKILL.md as a special entry
  try {
    const rootContent = await readFile(getRootSkillPath(), 'utf-8');
    const { name, description, body } = parseFrontmatter(rootContent);
    skills.set('gdex-root', {
      name: name || 'gdex-root',
      description: description || 'Root skill router',
      content: body,
      sections: parseSections(body),
    });
  } catch {
    // Root SKILL.md not found
  }

  cachedSkills = skills;
  return skills;
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

export function listSkills(skills: Map<string, Skill>): Array<{ name: string; description: string }> {
  return Array.from(skills.values())
    .filter(s => s.name !== 'gdex-root')
    .map(s => ({ name: s.name, description: s.description }));
}
