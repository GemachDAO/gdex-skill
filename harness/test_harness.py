"""Offline tests for the harness: the agent loop runs against a mock of the Messages API, so
no API key is needed and nothing is billed. Skill scripts DO run for real (network)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import anthropic
import httpx2 as httpx  # anthropic 1.x uses httpx2; the mock must too
import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import gemach_harness as h  # noqa: E402

SKILLS = [HERE.parent / "skills"]


def _msg(content, stop):
    return {"id": "msg_x", "type": "message", "role": "assistant", "model": "claude-opus-5",
            "content": content, "stop_reason": stop, "stop_sequence": None,
            "usage": {"input_tokens": 1, "output_tokens": 1}}


def test_discovery_finds_script_skills_with_absolute_paths():
    sk = h.discover([Path("../skills")]) if Path("../skills").exists() else h.discover(SKILLS)
    assert {"gdex-hl-market-risk", "gdex-token-risk", "gvault"} <= set(sk)
    assert all(p.is_absolute() for s in sk.values() for p in s.scripts.values())


@pytest.mark.parametrize("args", [["BTC; rm -rf /"], ["$(id)"], ["a b"], ["--x=`id`"]])
def test_unsafe_arguments_are_rejected(args):
    sk = h.discover(SKILLS)
    with pytest.raises(ValueError):
        h.run_script(sk["gdex-hl-market-risk"], "hl_market_risk.py", args)


def test_unknown_script_is_rejected():
    sk = h.discover(SKILLS)
    with pytest.raises(ValueError):
        h.run_script(sk["gdex-hl-market-risk"], "../../gvault/scripts/gvault.py", [])


def test_agent_loop_runs_the_skill_and_quotes_its_output(tmp_path, capsys):
    """Turn 1: the 'model' calls run_skill_script. Turn 2: it answers. We assert the real
    script output reached the model and the request carried tools, system and fallbacks."""
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append(body)
        if len(seen) == 1:
            return httpx.Response(200, json=_msg([{
                "type": "tool_use", "id": "tu_1", "name": "run_skill_script",
                "input": {"skill": "gdex-hl-market-risk", "script": "hl_market_risk.py",
                          "args": ["--symbol", "BTC"]}}], "tool_use"))
        return httpx.Response(200, json=_msg([{"type": "text", "text": "BTC answer"}], "end_turn"))

    client = anthropic.Anthropic(api_key="test", http_client=httpx.Client(transport=httpx.MockTransport(handler)))
    audit = h.Audit(tmp_path / "audit.jsonl")
    rc = h.ask(h.discover(SKILLS), "BTC funding?", "claude-opus-5", audit, client=client)

    assert rc == 0 and "BTC answer" in capsys.readouterr().out
    first = seen[0]
    assert {t["name"] for t in first["tools"]} == {"list_skills", "read_skill", "run_skill_script"}
    assert first["fallbacks"] == "default" and "copied from run_skill_script" in first["system"]
    # the second request carries the REAL script output as the tool result
    result = [b for m in seen[1]["messages"] for b in (m["content"] if isinstance(m["content"], list) else [])
              if b.get("type") == "tool_result"][0]
    text = result["content"] if isinstance(result["content"], str) else result["content"][0]["text"]
    row = json.loads(text.splitlines()[0])
    assert row["gemach_id"] == "hl-BTC" and row["mark_px_usd"] > 0
    log = [json.loads(l) for l in (tmp_path / "audit.jsonl").read_text().splitlines()]
    assert log[0]["exit"] == 0 and len(log[0]["sha256"]) == 64


def test_refusal_is_reported_not_printed_as_an_answer(tmp_path, capsys):
    handler = lambda req: httpx.Response(200, json=_msg([], "refusal"))
    client = anthropic.Anthropic(api_key="test", http_client=httpx.Client(transport=httpx.MockTransport(handler)))
    rc = h.ask(h.discover(SKILLS), "q", "claude-opus-5", h.Audit(None), client=client)
    assert rc == 2 and capsys.readouterr().out == ""
