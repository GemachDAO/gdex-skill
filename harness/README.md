# Gemach skills harness

Run Gemach's agent skills with Claude, on **your own** Anthropic API key. Gemach hosts
nothing and bills nothing: the skills are open, the scripts run on your machine, and every
model call is billed to the key in your environment.

## Install

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt            # just the Anthropic SDK
npx skills add GemachDAO/gdex-skill         # or: git clone the repo
npx skills add GemachDAO/glend-skill
export ANTHROPIC_API_KEY=sk-ant-...         # yours; or run `ant auth login` once
export GEMACH_SKILLS_PATH=/path/to/gdex-skill/skills:/path/to/glend-skill
```

## Two modes

```bash
# Pipelines: no model, no key needed. Every feed as NDJSON.
python gemach_harness.py export --out feed.ndjson

# Questions: an agent that reads the skills and runs their scripts.
python gemach_harness.py ask "Which HyperLiquid markets trade furthest from oracle?"

python gemach_harness.py skills             # what was discovered
```

`export` fails with a non-zero exit if **any** feed fails or returns nothing, so a partial
book is never published. Use it for anything that feeds reporting: its output is produced
entirely by deterministic scripts.

## Where the numbers come from

Never from the model. Every figure originates in a skill script's stdout; the agent is
instructed to copy figures from tool output verbatim, name the skill each came from, and say
so when no script produced a figure it would need. Every script run — in both modes — is
appended to `gemach-audit.jsonl` with the script, its arguments, its exit code and the
sha256 of its exact output, so any number in an answer can be traced to the bytes it came from.

## Safety

The agent can only run scripts found in discovered skills' `scripts/` directories, by name.
Arguments are passed as an argument list (never through a shell) and must match
`[A-Za-z0-9._:-]`. Tool output is capped at 80,000 characters; truncation is always announced
to the model, never silent.

## Model

Defaults to `claude-opus-5`; override with `GEMACH_MODEL` or `--model`. Server-side refusal
fallbacks are enabled, and a refused request exits with code 2 rather than printing a partial
answer.

## Tests

```bash
pip install pytest && python -m pytest -q test_harness.py
```

The agent loop is tested against a mock of the Messages API — no key, no cost. The skill
scripts in those tests run for real against live data.
