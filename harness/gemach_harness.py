#!/usr/bin/env python3
"""Gemach skills harness — run Gemach agent skills with Claude on YOUR Anthropic API key.

Two modes:

    gemach_harness.py ask "Which HyperLiquid markets have the widest oracle premium?"
        An agent that can read the installed skills and run their scripts. Inference is
        billed to the ANTHROPIC_API_KEY (or `ant auth login` profile) in your environment.

    gemach_harness.py export --out feed.ndjson
        No model at all: runs every skill's data script and writes the combined NDJSON.
        Use this for pipelines. It fails non-zero if any feed fails or returns nothing, so a
        partial book is never published.

Numbers never come from the model. Every figure originates in a skill script's stdout; the
agent is instructed to quote tool output verbatim, and every tool call is written to an audit
log (script, arguments, exit code, sha256 of the exact output) so any figure in an answer can
be traced to the bytes it came from.

Skills are discovered from --skills-dir (repeatable) or GEMACH_SKILLS_PATH (os.pathsep-
separated): any directory holding a SKILL.md, whose runnable scripts live in ./scripts/*.py.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_MODEL = os.environ.get("GEMACH_MODEL", "claude-opus-5")
MAX_TOOL_CHARS = 80_000     # cap per tool result; truncation is always announced, never silent
SCRIPT_TIMEOUT_S = 180
SAFE_ARG = re.compile(r"^[A-Za-z0-9._:\-]{1,128}$")

SYSTEM = """You answer questions using Gemach agent skills. You have three tools: list_skills,
read_skill and run_skill_script.

Before running a skill's script, read that skill with read_skill and follow its rules.

Numbers: every figure you state must be copied from run_skill_script output in this
conversation. Do not estimate, interpolate, recompute, convert or round figures beyond what a
skill's rules allow, and do not use figures from memory. If the question needs a number no
script produced, say that plainly instead of supplying one. When you report a figure, name the
skill it came from. If a tool result says it was truncated, say so and narrow the query rather
than generalising from the part you saw."""


@dataclass
class Skill:
    name: str
    root: Path
    description: str
    scripts: dict[str, Path] = field(default_factory=dict)


def _frontmatter(text: str) -> dict[str, str]:
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.S)
    out: dict[str, str] = {}
    for line in (m.group(1).splitlines() if m else []):
        if ":" in line:
            k, v = line.split(":", 1)
            out[k.strip()] = v.strip()
    return out


def discover(dirs: list[Path]) -> dict[str, Skill]:
    skills: dict[str, Skill] = {}
    for base in dirs:
        base = base.expanduser().resolve()  # scripts run with cwd = their skill, so paths must be absolute
        for md in sorted(base.rglob("SKILL.md")):
            if any(p in {"node_modules", ".git"} for p in md.parts) or len(md.relative_to(base).parts) > 4:
                continue
            fm = _frontmatter(md.read_text(encoding="utf-8"))
            name = fm.get("name") or md.parent.name
            scripts = {p.name: p for p in sorted((md.parent / "scripts").glob("*.py"))}
            if not scripts:
                continue  # prose-only skills have nothing for this harness to run
            if name in skills:
                raise SystemExit(f"duplicate skill name {name!r}: {skills[name].root} and {md.parent}")
            skills[name] = Skill(name, md.parent, fm.get("description", ""), scripts)
    return skills


def run_script(skill: Skill, script: str, args: list[str]) -> tuple[int, str, str]:
    if script not in skill.scripts:
        raise ValueError(f"{skill.name} has no script {script!r}; it has {sorted(skill.scripts)}")
    bad = [a for a in args if not SAFE_ARG.match(a)]
    if bad:
        raise ValueError(f"rejected arguments {bad!r}: only [A-Za-z0-9._:-] tokens are allowed")
    proc = subprocess.run([sys.executable, str(skill.scripts[script]), *args], cwd=skill.root,
                          capture_output=True, text=True, timeout=SCRIPT_TIMEOUT_S)
    return proc.returncode, proc.stdout, proc.stderr


class Audit:
    def __init__(self, path: Path | None):
        self.path = path

    def write(self, **rec) -> None:
        if self.path:
            rec["ts"] = time.time()
            with self.path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(rec) + "\n")


# ---------------------------------------------------------------------- export (no model)

def export(skills: dict[str, Skill], out, audit: Audit) -> int:
    total = 0
    for s in sorted(skills.values(), key=lambda s: s.name):
        for script in s.scripts:
            code, stdout, stderr = run_script(s, script, [])
            rows = [l for l in stdout.splitlines() if l.strip()]
            audit.write(mode="export", skill=s.name, script=script, exit=code, rows=len(rows),
                        sha256=hashlib.sha256(stdout.encode()).hexdigest())
            if code != 0 or not rows:
                # A partial book reads downstream as the market collapsing. Refuse to publish.
                print(f"export FAILED: {s.name}/{script} exit={code} rows={len(rows)}\n{stderr[-2000:]}",
                      file=sys.stderr)
                return 1
            for l in rows:
                json.loads(l)  # every line must be one JSON object
            out.write("\n".join(rows) + "\n")
            total += len(rows)
            print(f"  {s.name}/{script}: {len(rows)} rows", file=sys.stderr)
    print(f"export: {total} rows", file=sys.stderr)
    return 0


# ---------------------------------------------------------------------- ask (agent)

def ask(skills: dict[str, Skill], question: str, model: str, audit: Audit, client=None) -> int:
    import anthropic
    from anthropic import beta_tool

    @beta_tool
    def list_skills() -> str:
        """List the installed Gemach skills, their descriptions and runnable scripts."""
        return json.dumps([{"name": s.name, "description": s.description, "scripts": sorted(s.scripts)}
                           for s in skills.values()], indent=1)

    @beta_tool
    def read_skill(name: str) -> str:
        """Read a skill's SKILL.md: how to run it, what its fields mean, and its rules.

        Args:
            name: Skill name as given by list_skills.
        """
        s = skills.get(name)
        return (s.root / "SKILL.md").read_text(encoding="utf-8") if s else f"No skill named {name!r}."

    @beta_tool
    def run_skill_script(skill: str, script: str, args: list[str] | None = None) -> str:
        """Run one of a skill's scripts and return its stdout (usually NDJSON, one record per line).

        Args:
            skill: Skill name as given by list_skills.
            script: Script file name, e.g. hl_market_risk.py.
            args: Command-line arguments as separate tokens, e.g. ["--symbol", "BTC", "ETH"].
        """
        s = skills.get(skill)
        if s is None:
            return f"ERROR: no skill named {skill!r}."
        try:
            code, stdout, stderr = run_script(s, script, list(args or []))
        except (ValueError, subprocess.TimeoutExpired) as exc:
            audit.write(mode="ask", skill=skill, script=script, args=args, error=str(exc))
            return f"ERROR: {exc}"
        audit.write(mode="ask", skill=skill, script=script, args=args, exit=code,
                    sha256=hashlib.sha256(stdout.encode()).hexdigest())
        if code != 0:
            return f"ERROR: script exited {code}. stderr:\n{stderr[-3000:]}"
        if len(stdout) <= MAX_TOOL_CHARS:
            return stdout or "(no output)"
        lines = stdout.splitlines()
        kept, size = [], 0
        for l in lines:
            if size + len(l) + 1 > MAX_TOOL_CHARS:
                break
            kept.append(l)
            size += len(l) + 1
        return ("\n".join(kept) + f"\n[TRUNCATED: showing {len(kept)} of {len(lines)} lines. "
                "Narrow the query with the script's filter arguments.]")

    client = client or anthropic.Anthropic()  # ANTHROPIC_API_KEY, or an `ant auth login` profile
    runner = client.beta.messages.tool_runner(
        model=model,
        max_tokens=16000,
        system=SYSTEM,
        tools=[list_skills, read_skill, run_skill_script],
        messages=[{"role": "user", "content": question}],
        # If a safety classifier declines, re-run on a fallback model inside the same call.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    )
    final = None
    for message in runner:
        final = message
    if final is None:
        print("No response.", file=sys.stderr)
        return 1
    if final.stop_reason == "refusal":
        print(f"Declined: {getattr(final, 'stop_details', None)}", file=sys.stderr)
        return 2
    print("".join(b.text for b in final.content if getattr(b, "type", "") == "text"))
    if final.stop_reason == "max_tokens":
        print("[answer cut off at max_tokens]", file=sys.stderr)
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Gemach skills harness")
    ap.add_argument("--skills-dir", action="append", type=Path, default=[],
                    help="directory to search for SKILL.md (repeatable; also GEMACH_SKILLS_PATH)")
    ap.add_argument("--audit", type=Path, default=Path("gemach-audit.jsonl"),
                    help="append-only audit log of every script run (default: gemach-audit.jsonl)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a_ask = sub.add_parser("ask", help="answer a question with an agent (uses your API key)")
    a_ask.add_argument("question")
    a_ask.add_argument("--model", default=DEFAULT_MODEL)
    a_exp = sub.add_parser("export", help="write every feed as NDJSON, no model")
    a_exp.add_argument("--out", type=Path, help="output file (default stdout)")
    sub.add_parser("skills", help="list discovered skills")
    a = ap.parse_args(argv)

    dirs = list(a.skills_dir) + [Path(p) for p in os.environ.get("GEMACH_SKILLS_PATH", "").split(os.pathsep) if p]
    if not dirs:
        dirs = [Path(__file__).resolve().parent.parent / "skills"]
    skills = discover(dirs)
    if not skills:
        print(f"no runnable skills found under {[str(d) for d in dirs]}", file=sys.stderr)
        return 1
    audit = Audit(a.audit)

    if a.cmd == "skills":
        for s in skills.values():
            print(f"{s.name:24} {', '.join(s.scripts):40} {s.root}")
        return 0
    if a.cmd == "export":
        if a.out:
            with a.out.open("w", encoding="utf-8") as f:
                return export(skills, f, audit)
        return export(skills, sys.stdout, audit)
    return ask(skills, a.question, a.model, audit)


if __name__ == "__main__":
    sys.exit(main())
