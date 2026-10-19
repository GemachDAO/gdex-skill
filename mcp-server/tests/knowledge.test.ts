import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadSkills,
  resetSkillCache,
  getKnowledgeSource,
  getSkillFile,
  getSkillContent,
  listSkills,
  searchSkills,
  type SkillRegistry,
} from '../src/knowledge.js';

beforeEach(() => resetSkillCache());
afterEach(() => {
  resetSkillCache();
  jest.restoreAllMocks();
});

describe('loadSkills', () => {
  it('falls back to the repo skills/ directory when no registry is bundled', async () => {
    const skills = await loadSkills({ registry: null });
    expect(getKnowledgeSource()).toBe('filesystem');
    expect(listSkills(skills).length).toBeGreaterThanOrEqual(30);
    expect(getSkillContent(skills, 'gdex-spot-trading')).toMatch(/buyToken/);
    // Companion files are loaded with their skill
    expect(getSkillFile(skills, 'gdex-token-risk', 'scripts/token_risk.py')).toMatch(/def /);
    expect(getSkillFile(skills, 'gdex-token-risk', './scripts/token_risk.py')).not.toBeNull();
    expect(searchSkills(skills, 'outcome').map((r) => r.skill.name)).toContain('gdex-hl-outcomes');
  });

  it('uses a bundled registry first', async () => {
    const registry: SkillRegistry = {
      version: 1,
      skills: [{
        name: 'gdex-demo',
        description: 'Demo skill',
        content: '# Demo\n\n## Usage\n\nCall skill.hlCreateOrder.',
        files: [{ path: 'scripts/demo.py', content: 'print(1)\n' }],
      }],
    };
    const skills = await loadSkills({ registry });
    expect(getKnowledgeSource()).toBe('bundled');
    expect([...skills.keys()]).toEqual(['gdex-demo']);
    expect(skills.get('gdex-demo')?.sections.get('usage')).toMatch(/hlCreateOrder/);
    expect(getSkillFile(skills, 'gdex-demo', 'scripts/demo.py')).toBe('print(1)\n');
  });

  it('warns on stderr, never stdout, when no knowledge is available', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'gdex-no-skills-'));
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const out = jest.spyOn(process.stdout, 'write');
    try {
      const skills = await loadSkills({ registry: null, skillsDir: join(empty, 'skills') });
      expect(skills.size).toBe(0);
      expect(getKnowledgeSource()).toBe('none');
      expect(err).toHaveBeenCalledTimes(1);
      expect(String(err.mock.calls[0][0])).toMatch(/no GDEX skill documentation available/);
      expect(log).not.toHaveBeenCalled();
      expect(out).not.toHaveBeenCalled();
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
