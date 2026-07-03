"""Offline unit tests for the research engine (planner + executor).

Every test uses a mocked Anthropic client — **no live Claude call ever happens**
(RESEARCH_PLAN.md: the engine must be testable offline). The executor is driven
against the recorded AAPL FakeTicker fixtures from conftest.py, so no network is
touched at all; these carry no ``network`` mark and run in CI.
"""
import asyncio
import json
from types import SimpleNamespace

from app.research.executor import resolve_tool, run_plan
from app.research.planner import (
    AUTO_MAX_SUBTASKS,
    SKILL_MAX_SUBTASKS,
    build_plan,
)
from app.research.schemas import Plan, Subtask

# ============================================================
# === Mocked Anthropic client (no network) ===
# ============================================================

def _content(text, input_tokens=0, output_tokens=0):
    """Mimic client.messages.create(...) return: .content[0].text (+ .usage)."""
    return SimpleNamespace(
        content=[SimpleNamespace(text=text)],
        usage=SimpleNamespace(input_tokens=input_tokens, output_tokens=output_tokens),
    )


class _FakeStream:
    """Mimic client.messages.stream(...) — a context manager exposing a
    .text_stream iterable and .get_final_message()."""

    def __init__(self, tokens, usage=(0, 0)):
        self._tokens = list(tokens)
        self._usage = usage

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    @property
    def text_stream(self):
        return iter(self._tokens)

    def get_final_message(self):
        return SimpleNamespace(usage=SimpleNamespace(
            input_tokens=self._usage[0], output_tokens=self._usage[1]))


class _FakeMessages:
    def __init__(self, create_fn, stream_tokens, stream_usage):
        self._create_fn = create_fn
        self._stream_tokens = stream_tokens
        self._stream_usage = stream_usage
        self.create_calls = []
        self.stream_calls = []

    def create(self, **kwargs):
        self.create_calls.append(kwargs)
        return self._create_fn(kwargs)

    def stream(self, **kwargs):
        self.stream_calls.append(kwargs)
        return _FakeStream(self._stream_tokens, self._stream_usage)


class FakeAnthropic:
    def __init__(self, create_fn=None, stream_tokens=("syn", "thesis"),
                 stream_usage=(0, 0), api_key="test-key"):
        self.api_key = api_key
        self.messages = _FakeMessages(
            create_fn or (lambda kw: _content("{}")), stream_tokens, stream_usage)


def _drain(agen):
    """Collect an async generator's events without pytest-asyncio."""
    async def _collect():
        return [ev async for ev in agen]
    return asyncio.run(_collect())


# ============================================================
# === PLANNER ===
# ============================================================

def test_planner_parses_good_json():
    plan_json = {
        "subtasks": [
            {"name": "technicals", "description": "pull technicals", "depends_on": []},
            {"name": "financials", "description": "pull financials", "depends_on": []},
            {"name": "reason", "description": "tie together", "depends_on": ["technicals", "financials"]},
        ]
    }
    client = FakeAnthropic(create_fn=lambda kw: _content(json.dumps(plan_json)))
    plan = build_plan("assess AAPL momentum", ["AAPL"], client=client)

    assert isinstance(plan, Plan)
    assert [st.name for st in plan.subtasks] == ["technicals", "financials", "reason"]
    assert plan.subtasks[2].depends_on == ["technicals", "financials"]
    assert plan.subtasks[0].description == "pull technicals"


def test_planner_strips_code_fences():
    plan_json = {"subtasks": [{"name": "news_sentiment", "description": "headlines", "depends_on": []}]}
    fenced = "```json\n" + json.dumps(plan_json) + "\n```"
    client = FakeAnthropic(create_fn=lambda kw: _content(fenced))
    plan = build_plan("news read", ["MSFT"], client=client)
    assert [st.name for st in plan.subtasks] == ["news_sentiment"]


def test_planner_degrades_on_garbage():
    client = FakeAnthropic(create_fn=lambda kw: _content("this is not json at all {{{"))
    plan = build_plan("understand NVDA", ["NVDA"], client=client)
    assert len(plan.subtasks) == 1
    assert plan.subtasks[0].name == "reason"
    assert "NVDA" in plan.subtasks[0].description or plan.subtasks[0].description == "understand NVDA"


def test_planner_degrades_on_zero_subtasks():
    client = FakeAnthropic(create_fn=lambda kw: _content(json.dumps({"subtasks": []})))
    plan = build_plan("empty objective", ["AAPL"], client=client)
    assert len(plan.subtasks) == 1
    assert plan.subtasks[0].name == "reason"


def test_planner_degrades_without_api_key():
    client = FakeAnthropic(api_key="")
    plan = build_plan("no key", ["AAPL"], client=client)
    assert len(plan.subtasks) == 1
    assert plan.subtasks[0].name == "reason"


def test_planner_enforces_auto_cap():
    many = {"subtasks": [{"name": "reason", "description": f"step {i}", "depends_on": []}
                         for i in range(10)]}
    client = FakeAnthropic(create_fn=lambda kw: _content(json.dumps(many)))
    plan = build_plan("big objective", ["AAPL"], client=client)
    assert len(plan.subtasks) == AUTO_MAX_SUBTASKS == 5


def test_planner_enforces_skill_cap():
    many = {"subtasks": [{"name": "reason", "description": f"step {i}", "depends_on": []}
                         for i in range(20)]}
    client = FakeAnthropic(create_fn=lambda kw: _content(json.dumps(many)))
    plan = build_plan("big skill", ["AAPL"], max_subtasks=SKILL_MAX_SUBTASKS, client=client)
    assert len(plan.subtasks) == SKILL_MAX_SUBTASKS == 8


# ============================================================
# === TOOL RESOLUTION ===
# ============================================================

def test_resolve_tool():
    assert resolve_tool("technicals") == "technicals"
    assert resolve_tool("news_sentiment") == "news_sentiment"
    assert resolve_tool("macro") == "macro"
    assert resolve_tool("reason") == "reason"
    assert resolve_tool("reason_2") == "reason"          # numeric suffix stripped
    assert resolve_tool("Reason 3") == "reason"          # case/space normalized
    assert resolve_tool("summarize findings") == "reason"  # unknown → reason


# ============================================================
# === EXECUTOR ===
# ============================================================

def _executor_client():
    """A client whose reason step RAISES on a sentinel and otherwise returns
    canned prose; synthesis streams two tokens."""
    def create_fn(kw):
        user = kw["messages"][0]["content"]
        if "TRIGGER_ERROR" in user:
            raise RuntimeError("boom")
        return _content("reasoned analysis text")
    return FakeAnthropic(create_fn=create_fn, stream_tokens=("Bottom line: ", "hold."))


def test_executor_runs_in_order_injects_data_and_survives_errors(fake_stock, recorded_info):
    plan = Plan(subtasks=[
        Subtask(name="technicals", description="pull technicals for {ticker}", depends_on=[]),
        Subtask(name="reason", description="TRIGGER_ERROR analyze it", depends_on=["technicals"]),
        Subtask(name="reason_2", description="summarize the read", depends_on=["technicals"]),
    ])
    client = _executor_client()
    events = _drain(run_plan(
        plan, ["AAPL"],
        objective="quick technical read on AAPL",
        client=client,
        stock_factory=lambda t: (fake_stock, recorded_info),
    ))

    types = [e["type"] for e in events]
    # First event is the plan; run reaches completion despite a mid-plan error.
    assert types[0] == "plan"
    assert types[-1] == "complete"
    assert "error" not in types  # no FATAL run-level error

    # Subtasks started strictly in plan order.
    started = [e["name"] for e in events if e["type"] == "subtask_started"]
    assert started == ["technicals", "reason", "reason_2"]

    completed = {e["name"]: e for e in events if e["type"] == "subtask_completed"}

    # Fetch subtask injected real module data (per-ticker bag), no error.
    tech = completed["technicals"]["data"]
    assert completed["technicals"]["tool"] == "technicals"
    assert "AAPL" in tech and "error" not in tech["AAPL"]
    assert "rsi" in tech["AAPL"] and "chart_data" in tech["AAPL"]

    # The erroring subtask propagated an error BAG (not a fatal abort)...
    assert completed["reason"]["data"] == {"error": "boom"}
    # ...and the run continued: the next subtask still produced its reasoning.
    assert completed["reason_2"]["data"]["reasoning"] == "reasoned analysis text"

    # Synthesis streamed tokens that concatenate into the complete event.
    tokens = [e["token"] for e in events if e["type"] == "synthesis_token"]
    assert tokens == ["Bottom line: ", "hold."]
    assert events[-1]["synthesis"] == "Bottom line: hold."
    assert "technicals" in events[-1]["outputs"]


def test_executor_multi_ticker_fetch(fake_stock, recorded_info):
    plan = Plan(subtasks=[Subtask(name="financials", description="pull financials", depends_on=[])])
    client = _executor_client()
    events = _drain(run_plan(
        plan, ["AAPL", "MSFT"],
        client=client,
        stock_factory=lambda t: (fake_stock, recorded_info),
    ))
    fin = next(e for e in events if e["type"] == "subtask_completed")["data"]
    # One module bag per requested ticker.
    assert set(fin.keys()) == {"AAPL", "MSFT"}
    assert "revenue" in fin["AAPL"]


def test_executor_degraded_single_subtask_plan(fake_stock, recorded_info):
    # The degraded plan the planner emits (one lone reason step) still runs.
    plan = Plan(subtasks=[Subtask(name="reason", description="just reason", depends_on=[])])
    client = _executor_client()
    events = _drain(run_plan(
        plan, ["AAPL"],
        client=client,
        stock_factory=lambda t: (fake_stock, recorded_info),
    ))
    assert events[-1]["type"] == "complete"
    completed = [e for e in events if e["type"] == "subtask_completed"]
    assert len(completed) == 1 and completed[0]["data"]["reasoning"] == "reasoned analysis text"


# ============================================================
# === {ticker} RESOLVER (schema + run-time) ===
# ============================================================

def test_render_plan_substitutes_ticker_in_descriptions():
    from app.research.schemas import render_plan
    plan = Plan(subtasks=[
        Subtask(name="earnings", description="Fetch {ticker} earnings", depends_on=[]),
        Subtask(name="reason", description="Assess {ticker} vs peers", depends_on=["earnings"]),
    ])
    r = render_plan(plan, "msft")  # lower-case in → upper-case out
    assert r.subtasks[0].description == "Fetch MSFT earnings"
    assert r.subtasks[1].description == "Assess MSFT vs peers"
    assert all("{ticker}" not in s.description for s in r.subtasks)
    # names/depends_on survive rendering untouched
    assert r.subtasks[1].depends_on == ["earnings"]


def test_executor_renders_ticker_in_reason_prompt_and_events(monkeypatch, fake_stock, recorded_info):
    # A {ticker}-templated plan must reach the reason Claude call and the emitted
    # events with the concrete symbol — not the literal placeholder. Disable the
    # (separately-tested) validator so the last create call is the reason step.
    from app.research import validator
    monkeypatch.setattr(validator, "NUMA_VALIDATOR", False)
    plan = Plan(subtasks=[
        Subtask(name="technicals", description="Fetch {ticker} technicals", depends_on=[]),
        Subtask(name="reason", description="Assess {ticker} momentum", depends_on=["technicals"]),
    ])
    client = FakeAnthropic(create_fn=lambda kw: _content("ok"))
    events = _drain(run_plan(
        plan, ["AAPL"],
        client=client,
        stock_factory=lambda t: (fake_stock, recorded_info),
    ))

    # The reason step's Claude call saw the rendered description.
    reason_user = client.messages.create_calls[-1]["messages"][0]["content"]
    assert "Assess AAPL momentum" in reason_user
    assert "{ticker}" not in reason_user

    # The emitted plan + subtask_started descriptions are rendered too.
    started = next(e for e in events if e["type"] == "subtask_started" and e["name"] == "reason")
    assert started["description"] == "Assess AAPL momentum"
    plan_ev = next(e for e in events if e["type"] == "plan")
    assert "{ticker}" not in json.dumps(plan_ev["plan"])


# ============================================================
# === USAGE ACCUMULATION ===
# ============================================================

def test_run_plan_emits_usage_event_summing_all_calls(monkeypatch, fake_stock, recorded_info):
    from app.config import estimate_cost_usd
    from app.research import validator
    from app.research.executor import UsageAccumulator

    # Scope to planner+reason+synthesis summing: disable the validator so it adds
    # no extra call (its own token folding is covered in test_research_validator).
    monkeypatch.setattr(validator, "NUMA_VALIDATOR", False)
    plan = Plan(subtasks=[
        Subtask(name="technicals", description="pull technicals", depends_on=[]),
        Subtask(name="reason", description="assess", depends_on=["technicals"]),
    ])
    # reason create → (11 in, 22 out); synthesis stream → (33 in, 44 out).
    client = FakeAnthropic(
        create_fn=lambda kw: _content("reasoned", 11, 22),
        stream_tokens=("done.",), stream_usage=(33, 44),
    )
    # Seed the planner's tokens (55 in, 66 out) to prove they're included too.
    seed = UsageAccumulator()
    seed.add("claude-sonnet-4-6", SimpleNamespace(input_tokens=55, output_tokens=66))

    events = _drain(run_plan(
        plan, ["AAPL"], client=client,
        stock_factory=lambda t: (fake_stock, recorded_info), usage=seed,
    ))

    usage_ev = next(e for e in events if e["type"] == "usage")
    assert usage_ev["input_tokens"] == 11 + 33 + 55
    assert usage_ev["output_tokens"] == 22 + 44 + 66
    assert usage_ev["cost_usd"] == round(
        estimate_cost_usd("claude-sonnet-4-6", 11 + 33 + 55, 22 + 44 + 66), 4)

    # The usage event precedes complete (it's the run's final tally).
    types = [e["type"] for e in events]
    assert types.index("usage") < types.index("complete")
