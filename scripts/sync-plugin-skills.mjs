// Copy skills/ into plugins/gdex/skills/ so the Claude Code / Grok Build plugin ships real files.
// Plugin directory scanners (Anthropic, xAI) do not follow symlinks. Run after editing any skill:
//   npm run sync:plugin-skills
// CI runs it and fails if plugins/gdex/skills differs from skills/.
//
//   node scripts/sync-plugin-skills.mjs --check   # read-only: exit 1 and list differences
// The check mode is also imported by tests/artifacts/manifests.test.mjs (diffPluginSkills).
import { cpSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = "skills";
const DEST = "plugins/gdex/skills";

function listFiles(dir, prefix = "", out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(p).isDirectory()) listFiles(p, rel, out);
    else out.push(rel);
  }
  return out;
}

/** Differences between skills/ and plugins/gdex/skills/ under repoRoot; empty when in sync. */
export function diffPluginSkills(repoRoot = process.cwd()) {
  const src = join(repoRoot, SRC);
  const dest = join(repoRoot, DEST);
  const a = new Set(listFiles(src));
  let b;
  try {
    b = new Set(listFiles(dest));
  } catch {
    return [`${DEST} is missing`];
  }
  const diffs = [];
  for (const f of a) {
    if (!b.has(f)) diffs.push(`missing in ${DEST}: ${f}`);
    else if (!readFileSync(join(src, f)).equals(readFileSync(join(dest, f)))) diffs.push(`differs: ${f}`);
  }
  for (const f of b) if (!a.has(f)) diffs.push(`extra in ${DEST}: ${f}`);
  return diffs;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const diffs = diffPluginSkills();
    for (const d of diffs) console.error(d);
    if (diffs.length) {
      console.error(`${DEST} is out of sync with ${SRC}/. Run 'npm run sync:plugin-skills'.`);
      process.exit(1);
    }
    console.log(`${DEST} matches ${SRC}/`);
  } else {
    rmSync(DEST, { recursive: true, force: true });
    cpSync(SRC, DEST, { recursive: true });
    console.log(`synced ${SRC} -> ${DEST}`);
  }
}
