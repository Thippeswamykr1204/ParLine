"""Tier 7 offline checks (no Postgres, no Groq key needed).
Run: python -m pytest backend/tests/test_agent.py -q
Separate file from test_offline.py by design -- it is additive and never touches
the Tier 0-6 fixtures or assertions in that suite."""
import os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("PROJECT_ROOT", str(ROOT))

from app.agent import tools, llm  # noqa: E402


def test_tool_specs_are_well_formed():
    names = {t["name"] for t in tools.TOOL_SPECS}
    assert names == set(tools.DISPATCH)
    for spec in tools.TOOL_SPECS:
        assert spec["description"], f"{spec['name']} is missing a docstring/description"
        assert spec["input_schema"]["type"] == "object"


def test_call_tool_rejects_unknown_tool_without_touching_db():
    out = tools.call_tool(conn=None, name="delete_everything", args={})
    assert out == {"found": False, "reason": "no such tool 'delete_everything'"}


def test_call_tool_rejects_bad_arguments_without_touching_db():
    # conn=None would blow up *inside* a real tool; a bad-argument call must be rejected
    # before ever reaching the DB, proving the tool layer can't be tricked into writing.
    out = tools.call_tool(conn=None, name="get_inventory", args={"bar": "X"})  # missing required 'brand'
    assert out["found"] is False
    assert "bad arguments" in out["reason"]


def test_no_tool_can_write():
    """Every dispatchable tool must be a read-only lookup: none of them may accept
    a payload shaped like a mutation (no 'quantity', 'accept', 'reject', 'order' args)."""
    forbidden = {"quantity_ml", "decided_by", "acceptance_status", "order_qty"}
    for spec in tools.TOOL_SPECS:
        props = set(spec["input_schema"]["properties"])
        assert not (props & forbidden), f"{spec['name']} exposes a mutating-looking argument"


def test_agent_reports_disabled_without_api_key(monkeypatch):
    # API_KEY is resolved once at import time from GROQ_API_KEY. Patch it directly,
    # then check the error names the env var to set.
    monkeypatch.setattr(llm, "API_KEY", "")
    result = llm.ask(conn=None, question="why is Grey Goose high-risk at Johnson's Bar?")
    assert result["answer"] is None
    assert llm._CFG["key_env_name"] in result["error"]
    assert result["tool_calls"] == []


def test_provider_is_groq_only():
    assert llm.PROVIDER == "groq"
    assert set(llm._PROVIDER_DEFAULTS) == {"groq"}
    for name, cfg in llm._PROVIDER_DEFAULTS.items():
        assert cfg["base_url"].startswith("https://")
        assert cfg["default_model"]
        assert cfg["key_env_name"]


def test_openai_tool_spec_conversion_preserves_every_tool():
    oa = llm._openai_tools()
    assert {t["function"]["name"] for t in oa} == set(tools.DISPATCH)
    for t in oa:
        assert t["type"] == "function"
        assert t["function"]["parameters"]["type"] == "object"
