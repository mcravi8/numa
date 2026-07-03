"""Offline tests for the output validator (app/research/validator.py) and its
executor wiring: score the memo, retry synthesis once on a low score, fold the
extra tokens into usage, emit a 'validation' event.

Every test mocks the Anthropic client — no live Claude call. The mocked client
records create calls (conftest), so we assert which model each call hit and that
the retry prompt carries the validator's feedback.
"""
import asyncio

from app.research import validator
from app.research.executor import run_plan
from app.research.schemas import Plan, Subtask


def _drain(agen):
    async def _collect():
        return [ev async for ev in agen]
    return asyncio.run(_collect())


def _reason_plan():
    # One reason step (an LLM create call) + the implicit synthesis, so a run
    # exercises reason + synthesis + validator (+ retry) calls.
    return Plan(subtasks=[Subtask(name="reason", description="assess momentum", depends_on=[])])


def _run(client, fake_stock, recorded_info, objective="read AAPL"):
    return _drain(run_plan(_reason_plan(), ["AAPL"], objective=objective, client=client,
                           stock_factory=lambda t: (fake_stock, recorded_info)))


# ============================================================
# === validate(): scoring, fail-open, kill-switch ===
# ============================================================

def test_validate_high_score(fake_anthropic, make_msg):
    c = fake_anthropic(create_fn=lambda kw: make_msg('{"score":8.5,"ok":true,"issues":[],"feedback":""}'))
    verdict, usage = validator.validate("obj", "a solid, numeric memo", {"x": 1}, client=c)
    assert verdict["score"] == 8.5 and verdict["ok"] is True
    assert usage is not None   # a real call → tokens flow back to the caller


def test_validate_low_score_recomputes_ok_from_score(fake_anthropic, make_msg):
    # The model claims ok:true, but ok is recomputed from the (below-bar) score.
    c = fake_anthropic(create_fn=lambda kw: make_msg('{"score":3.0,"ok":true,"issues":["vague"],"feedback":"add numbers"}'))
    verdict, _ = validator.validate("obj", "weak memo", {}, client=c)
    assert verdict["score"] == 3.0 and verdict["ok"] is False
    assert verdict["issues"] == ["vague"] and verdict["feedback"] == "add numbers"


def test_validate_malformed_fails_open_but_counts_tokens(fake_anthropic, make_msg):
    # A real call that returns garbage still cost tokens: fail open on the verdict,
    # but report the usage so displayed cost stays truthful.
    c = fake_anthropic(create_fn=lambda kw: make_msg("this is not json {{{", 9, 3))
    verdict, usage = validator.validate("obj", "memo", {}, client=c)
    assert verdict == {"score": 10.0, "ok": True, "issues": [], "feedback": ""}
    assert usage is not None and usage.input_tokens == 9 and usage.output_tokens == 3


def test_validate_kill_switch_no_call(monkeypatch, fake_anthropic, make_msg):
    monkeypatch.setattr(validator, "NUMA_VALIDATOR", False)
    calls = {"n": 0}

    def cf(kw):
        calls["n"] += 1
        return make_msg('{"score":2.0,"ok":false,"issues":[],"feedback":"x"}')

    verdict, usage = validator.validate("obj", "memo", {}, client=fake_anthropic(create_fn=cf))
    assert verdict["ok"] is True and verdict["score"] == 10.0
    assert calls["n"] == 0 and usage is None
    assert validator.enabled() is False


def test_validate_no_key_no_call(fake_anthropic, make_msg):
    calls = {"n": 0}

    def cf(kw):
        calls["n"] += 1
        return make_msg("{}")

    verdict, usage = validator.validate("obj", "memo", {}, client=fake_anthropic(create_fn=cf, api_key=""))
    assert verdict["ok"] is True and calls["n"] == 0 and usage is None


# ============================================================
# === Executor: validation event, single retry, usage ===
# ============================================================

def test_executor_high_score_no_retry_emits_badge(fake_anthropic, make_msg, fake_stock, recorded_info):
    def cf(kw):
        s = kw.get("system", "")
        if "grading" in s:
            return make_msg('{"score":9.0,"ok":true,"issues":[],"feedback":""}')
        if "Synthesize" in s:
            return make_msg("SHOULD-NOT-BE-CALLED")   # a retry synthesis (create)
        return make_msg("reasoned")

    c = fake_anthropic(create_fn=cf, stream_tokens=("Bottom line.",))
    events = _run(c, fake_stock, recorded_info)

    val = next(e for e in events if e["type"] == "validation")
    assert val["score"] == 9.0 and val["ok"] is True and val["retried"] is False
    # ordering: validation → usage → complete
    types = [e["type"] for e in events]
    assert types.index("validation") < types.index("usage") < types.index("complete")
    # no retry synthesis happened (no create call used the synthesis system)
    assert not any("Synthesize" in k.get("system", "") for k in c.messages.create_calls)
    assert events[-1]["synthesis"] == "Bottom line."   # the streamed first draft ships


def test_executor_low_score_retries_once_with_feedback(fake_anthropic, make_msg, fake_stock, recorded_info):
    fb = "Add the P/E ratio and revenue growth figures."

    def cf(kw):
        s = kw.get("system", "")
        if "grading" in s:
            return make_msg('{"score":3.0,"ok":false,"issues":["too vague"],"feedback":"%s"}' % fb)
        if "Synthesize" in s:
            return make_msg("Revised: P/E is 30x, revenue +12%.")
        return make_msg("reasoned")

    c = fake_anthropic(create_fn=cf, stream_tokens=("weak first draft.",))
    events = _run(c, fake_stock, recorded_info)

    val = next(e for e in events if e["type"] == "validation")
    assert val["retried"] is True and val["ok"] is False and val["score"] == 3.0
    # EXACTLY ONE retry synthesis create, and it carries the validator's feedback
    retries = [k for k in c.messages.create_calls if "Synthesize" in k.get("system", "")]
    assert len(retries) == 1
    assert fb in retries[0]["messages"][0]["content"]
    # the revised second draft ships, replacing the streamed first draft
    assert events[-1]["synthesis"] == "Revised: P/E is 30x, revenue +12%."


def test_executor_usage_includes_validator_and_retry(fake_anthropic, make_msg, fake_stock, recorded_info):
    def cf(kw):
        s = kw.get("system", "")
        if "grading" in s:
            return make_msg('{"score":3.0,"ok":false,"issues":[],"feedback":"more"}', 5, 6)
        if "Synthesize" in s:
            return make_msg("revised memo", 7, 8)          # retry synthesis
        return make_msg("reasoned", 10, 20)                # reason step

    c = fake_anthropic(create_fn=cf, stream_tokens=("draft.",), stream_usage=(3, 4))
    events = _run(c, fake_stock, recorded_info)

    usage = next(e for e in events if e["type"] == "usage")
    # reason(10,20) + synthesis stream(3,4) + validator(5,6) + retry(7,8)
    assert usage["input_tokens"] == 10 + 3 + 5 + 7
    assert usage["output_tokens"] == 20 + 4 + 6 + 8


def test_executor_kill_switch_skips_validation(monkeypatch, fake_anthropic, make_msg, fake_stock, recorded_info):
    monkeypatch.setattr(validator, "NUMA_VALIDATOR", False)

    def cf(kw):
        if "grading" in kw.get("system", ""):
            return make_msg('{"score":1.0,"ok":false,"issues":[],"feedback":"x"}')
        return make_msg("reasoned")

    c = fake_anthropic(create_fn=cf, stream_tokens=("draft.",))
    events = _run(c, fake_stock, recorded_info)

    assert not any(e["type"] == "validation" for e in events)          # no badge event
    assert not any("grading" in k.get("system", "") for k in c.messages.create_calls)  # no scoring call
    assert events[-1]["type"] == "complete"
