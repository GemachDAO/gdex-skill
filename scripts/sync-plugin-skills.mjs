// Copy skills/ into plugins/gdex/skills/ so the Claude Code / Grok Build plugin ships real files.
// Plugin directory scanners (Anthropic, xAI) do not follow symlinks. Run after editing any skill:
//   npm run sync:plugin-skills
// CI runs it and fails if plugins/gdex/skills differs from skills/.
import { cpSync, rmSync } from "node:fs";

const SRC = "skills";
const DEST = "plugins/gdex/skills";

rmSync(DEST, { recursive: true, force: true });
cpSync(SRC, DEST, { recursive: true });
console.log(`synced ${SRC} -> ${DEST}`);
