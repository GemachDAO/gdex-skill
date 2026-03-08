import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

interface SkillFrontmatter {
  name: string;
  description: string;
}

interface ValidationResult {
  skill: string;
  valid: boolean;
  errors: string[];
}

const SKILLS_DIR = join(__dirname, '..', 'skills');

async function findSkillFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const subFiles = await findSkillFiles(fullPath);
      files.push(...subFiles);
    } else if (entry.name === 'SKILL.md') {
      files.push(fullPath);
    }
  }

  return files;
}

function extractFrontmatter(content: string): { frontmatter: string; body: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return null;
  }
  return { frontmatter: match[1], body: match[2] };
}

function parseFrontmatter(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    result[key] = val;
  }
  return result;
}

function validateFrontmatter(skillPath: string, content: string): ValidationResult {
  const errors: string[] = [];
  const relativePath = skillPath.replace(SKILLS_DIR, 'skills');

  const extracted = extractFrontmatter(content);
  if (!extracted) {
    return {
      skill: relativePath,
      valid: false,
      errors: ['Missing or invalid YAML frontmatter (must be between --- lines)'],
    };
  }

  const frontmatter = parseFrontmatter(extracted.frontmatter) as unknown as SkillFrontmatter;

  if (!frontmatter.name) {
    errors.push('Missing required field: name');
  } else if (typeof frontmatter.name !== 'string') {
    errors.push('Field "name" must be a string');
  } else if (!/^[a-z0-9-]+$/.test(frontmatter.name)) {
    errors.push('Field "name" must be lowercase with hyphens only (e.g., "my-skill-name")');
  }

  if (!frontmatter.description) {
    errors.push('Missing required field: description');
  } else if (typeof frontmatter.description !== 'string') {
    errors.push('Field "description" must be a string');
  } else if (frontmatter.description.length < 10) {
    errors.push('Field "description" should be at least 10 characters');
  } else if (frontmatter.description.length > 200) {
    errors.push('Field "description" should be at most 200 characters');
  }

  if (!extracted.body.trim()) {
    errors.push('Skill has no content after frontmatter');
  }

  return {
    skill: relativePath,
    valid: errors.length === 0,
    errors,
  };
}

async function main(): Promise<void> {
  console.log('Validating GDEX Skills...\n');

  const skillFiles = await findSkillFiles(SKILLS_DIR);

  if (skillFiles.length === 0) {
    console.error('No SKILL.md files found in skills directory');
    process.exit(1);
  }

  console.log(`Found ${skillFiles.length} skill(s) to validate\n`);

  const results: ValidationResult[] = [];

  for (const skillFile of skillFiles) {
    const content = await readFile(skillFile, 'utf-8');
    const result = validateFrontmatter(skillFile, content);
    results.push(result);
  }

  let validCount = 0;
  let invalidCount = 0;

  for (const result of results) {
    if (result.valid) {
      console.log(`  OK  ${result.skill}`);
      validCount++;
    } else {
      console.log(`  FAIL  ${result.skill}`);
      for (const error of result.errors) {
        console.log(`        - ${error}`);
      }
      invalidCount++;
    }
  }

  console.log(`\n${validCount} valid, ${invalidCount} invalid`);

  if (invalidCount > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error during validation:', error);
  process.exit(1);
});
