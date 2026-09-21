"""Tier 7 agent loop. Calls Groq (free tier, OpenAI-compatible tool calling) with the
tools in tools.py.

The agent NEVER computes a forecast, par level, safety stock or recommendation
itself: the system prompt forbids it, and there is literally no path in
tools.py that lets it do so -- every tool either returns a value already
sitting in Postgres (written by the Tier 2-4 pipeline) or returns
{"found": False}. If the model tries to answer with an invented number instead
of calling a tool, that is a prompt-following failure, not a capability the
tool layer grants.
"""
from __future__ import annotations
import json, logging, os
from typing import Optional
import httpx
from . import tools

log = logging.getLogger("parline.agent")

# --- Groq config (free tier) --------------------------------------------------
# Get a free key at https://console.groq.com/keys and set GROQ_API_KEY in .env.
# Groq retires/rotates free models often, so several tool-calling models are tried in order
# on "model_not_found"; set AGENT_MODEL in .env to force a specific one.
PROVIDER = "groq"
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")

_PROVIDER_DEFAULTS = {
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "default_model": "openai/gpt-oss-120b",
        "key": GROQ_API_KEY,
        "key_env_name": "GROQ_API_KEY",
    },
}

_CFG = _PROVIDER_DEFAULTS[PROVIDER]
API_KEY = _CFG["key"]
_FALLBACK_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile", "qwen/qwen3-32b"]
MODEL = os.environ.get("AGENT_MODEL", "").strip() or _CFG["default_model"]
_working_model: Optional[str] = None
MAX_TOOL_ROUNDS = 6

SYSTEM_PROMPT = """You are the ParLine in-app assistant for hotel bar managers.

Hard rules, no exceptions:
1. You NEVER compute, estimate, or guess a forecast, par level, safety stock figure,
   reorder point, or stockout probability. Every number in your answer must come from
   a tool call result in this conversation.
2. If the tools return {"found": false}, or the data needed to answer isn't something
   any tool exposes (e.g. "why did we run out last Tuesday specifically", intraday
   detail, a reason code that doesn't exist in the schema), say plainly that you don't
   have that data -- do not fabricate a plausible-sounding reason.
3. Cite the concrete numbers you retrieved (units included, e.g. "1,850 ml/day") so the
   manager can see the answer is grounded, not a guess.
4. Remember the load-bearing finding: the forecast-accuracy winner (Rolling Mean 7d,
   lowest WAPE) is NOT the business winner. Global ML at 99% service level is, because
   it wins on simulated stockouts/lost volume (263 stockout days vs 584 for naive).
   If a question touches model choice, surface this distinction rather than assuming
   "lowest error" and "best policy" are the same thing.
5. Keep answers short and operational: a bar manager wants the number and what to do,
   not a lecture on time-series methodology.
6. Tone and format: write like a concise operations briefing to a hotel manager. Formal,
   plain English; no emoji, slang or filler; do not restate the question or mention tools.
   Structure every answer as:
   - one direct sentence that answers the question (bold only the policy or item name);
   - then at most three bullet lines ("- ") of supporting figures, with units and thousands
     separators (e.g. 41,351 ml), and "approximately" instead of the symbol "~" or "≈";
   - then, only if an action follows, one line starting "Recommendation:".
   Keep the whole answer under 90 words. Do not use headings, tables or nested lists.
"""


# --- tools.TOOL_SPECS (name/description/input_schema) -> OpenAI-style tools spec ----
def _openai_tools() -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["input_schema"],
            },
        }
        for t in tools.TOOL_SPECS
    ]


def _client() -> httpx.Client:
    headers = {"Authorization": f"Bearer {API_KEY}", "content-type": "application/json"}
    return httpx.Client(base_url=_CFG["base_url"], timeout=60, headers=headers)


def _post_chat(client: httpx.Client, payload: dict) -> httpx.Response:
    """POST /chat/completions, moving to the next candidate model on model_not_found."""
    global _working_model
    order = [_working_model] if _working_model else [MODEL] + [m for m in _FALLBACK_MODELS if m != MODEL]
    resp = None
    for m in order:
        resp = client.post("/chat/completions", json={**payload, "model": m})
        if resp.status_code == 404 or "model_not_found" in resp.text[:300]:
            log.warning("Groq model %s unavailable, trying next", m); _working_model = None; continue
        if resp.status_code < 400: _working_model = m
        return resp
    return resp


def _disabled_error() -> dict:
    return {
        "answer": None,
        "error": (
            f"{_CFG['key_env_name']} is not set on the backend; "
            "Tier 7 agent is disabled. Get a free key at https://console.groq.com/keys."
        ),
        "tool_calls": [],
    }


# --- Groq chat-completions + tools loop ---
def _ask_groq(conn, question: str, bar_hint: Optional[str]) -> dict:
    user_msg = question if not bar_hint else f"[current bar in view: {bar_hint}]\n{question}"
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]
    trace: list[dict] = []
    oa_tools = _openai_tools()

    with _client() as client:
        for _ in range(MAX_TOOL_ROUNDS):
            resp = _post_chat(client, {"messages": messages, "tools": oa_tools,
                                       "tool_choice": "auto", "max_tokens": 1500})
            if resp.status_code == 429:
                return {"answer": None, "tool_calls": trace,
                        "error": "Groq free-tier rate limit hit; wait a few seconds and retry."}
            if resp.status_code in (401, 403):
                return {"answer": None, "tool_calls": trace,
                        "error": "Groq rejected GROQ_API_KEY; check the key in .env."}
            if resp.status_code >= 400:                       # e.g. 400 tool_use_failed, 404 model retired, 5xx
                log.error("Groq %s: %s", resp.status_code, resp.text[:500])
                return {"answer": None, "tool_calls": trace,
                        "error": f"Groq returned HTTP {resp.status_code}: {resp.text[:300]}"}
            data = resp.json()
            choice = data["choices"][0]["message"]
            tool_calls = choice.get("tool_calls") or []
            # keep only fields the API accepts back (Groq can return extras like "reasoning" that it then rejects)
            messages.append({"role": "assistant", "content": choice.get("content") or "",
                             **({"tool_calls": tool_calls} if tool_calls else {})})
            if not tool_calls:
                return {"answer": choice.get("content") or "", "tool_calls": trace}

            for tc in tool_calls:
                name = tc["function"]["name"]
                try:
                    args = json.loads(tc["function"].get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                try:
                    result = tools.call_tool(conn, name, args)
                except Exception as exc:                      # a broken tool must not take down the endpoint
                    log.exception("tool %s failed", name)
                    result = {"found": False, "error": f"tool {name} failed: {exc}"}
                trace.append({"tool": name, "input": args, "result": result})
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": json.dumps(result, default=str),
                })

    return {"answer": None, "error": "agent did not converge within the tool-call round limit", "tool_calls": trace}


def ask(conn, question: str, bar_hint: Optional[str] = None) -> dict:
    """Runs the tool-use loop for one question. Returns {"answer", "tool_calls", "error"?}."""
    if not API_KEY:
        return _disabled_error()
    try:
        return _ask_groq(conn, question, bar_hint)
    except httpx.HTTPError as exc:                            # network/DNS/timeout to api.groq.com
        log.error("Groq unreachable: %s", exc)
        return {"answer": None, "tool_calls": [], "error": f"Could not reach Groq ({type(exc).__name__}). Check internet access from the backend container."}
    except Exception as exc:                                  # never return a bare 500 (browser would report it as CORS)
        log.exception("agent failed")
        return {"answer": None, "tool_calls": [], "error": f"Agent error: {type(exc).__name__}: {exc}"}