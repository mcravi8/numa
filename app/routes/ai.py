"""AI endpoints: /synthesize turns a section's data into investment-grade prose
via the shared Anthropic client, and /numa proxies the browser's chat to
Anthropic, streaming both back as SSE.
"""
# ============================================================
# === AI ENDPOINTS — synthesize + Numa chat proxy ===
# ============================================================
# /synthesize turns a section's data into investment-grade prose using the
# shared server-side Anthropic client. /numa proxies the browser's chat to
# Anthropic (browsers can't call api.anthropic.com directly — CORS), streaming
# the response back as SSE.

import json
from typing import Any, List

import anthropic
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.config import ANTHROPIC_CLIENT

router = APIRouter()


# ============================================================
# === SYNTHESIZE ENDPOINT ===
# ============================================================

class SynthesisPayload:
    pass


class SynthesisRequest(BaseModel):
    ticker: str
    company_name: str
    section: str
    data: dict

SECTION_PROMPTS = {
    "technicals": "Write the technical analysis section for {name} ({ticker}). Lead with the most important signal. Use specific numbers. 3-5 sentences.\n\nData: {data}",
    "options": "Write the options flow analysis for {name} ({ticker}). Identify the most significant smart money signal. Use specific contract details. 3-5 sentences.\n\nData: {data}",
    "insider": "Write the insider activity interpretation for {name} ({ticker}). What is the net insider sentiment signal? Use specific names and values. 3 sentences.\n\nData: {data}",
    "fundamentals": "Write the fundamental analysis section for {name} ({ticker}). Focus on growth trajectory and margin quality. Use specific numbers. 3-5 sentences.\n\nData: {data}",
    "peers": "Write the relative valuation section for {name} ({ticker}). How does it compare to peers on key multiples? Use specific numbers. 3 sentences.\n\nData: {data}",
    "news": "Write the news sentiment summary for {name} ({ticker}). What is the dominant narrative? 2-3 sentences.\n\nData: {data}",
    "earnings": "Write the earnings quality section for {name} ({ticker}). Focus on beat rate and upcoming catalyst. 3 sentences.\n\nData: {data}",
    "overall": """Write a concise institutional research note for {name} ({ticker}) with these exact sections:

**EXECUTIVE SUMMARY**
[2 sentences — single most important bullish signal vs single most important risk]

**FUNDAMENTAL PICTURE**
[Revenue growth, margin trajectory, balance sheet health — 3 sentences with specific numbers]

**TECHNICAL SETUP**
[Price structure, key levels, momentum — 2-3 sentences]

**SMART MONEY SIGNALS**
[Options flow and insider activity combined — 2-3 sentences]

**RELATIVE VALUE**
[Vs peers on key multiples — 2 sentences]

**KEY RISKS**
- [Risk 1]
- [Risk 2]
- [Risk 3]

**BOTTOM LINE**
[One decisive sentence]

Data: {data}""",
}

@router.post("/synthesize")
async def synthesize(req: SynthesisRequest) -> StreamingResponse:
    if not ANTHROPIC_CLIENT.api_key:
        return {"error": "ANTHROPIC_API_KEY not configured"}

    system = (
        "You are a senior sell-side equity research analyst. Write precise, analytical prose. "
        "Use specific numbers from the data provided. No generic disclaimers. "
        "Never fabricate data not in the payload. Be direct and investment-grade in tone."
    )

    template = SECTION_PROMPTS.get(req.section, SECTION_PROMPTS["overall"])
    user_msg = template.format(
        name=req.company_name,
        ticker=req.ticker,
        data=json.dumps(req.data, default=str)[:6000]
    )

    def stream_response():
        with ANTHROPIC_CLIENT.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=600,
            system=system,
            messages=[{"role": "user", "content": user_msg}]
        ) as stream:
            for text in stream.text_stream:
                yield f"data: {json.dumps({'token': text})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(stream_response(), media_type="text/event-stream")


# ============================================================
# === NUMA CHAT PROXY ===
# ============================================================
# Browsers cannot call api.anthropic.com directly (CORS), so Numa's chat is
# proxied here: the frontend posts the user's key + conversation to this local
# backend, which streams the Claude response back as SSE (server->Anthropic has
# no CORS). Emits {token}, then {usage}, then [DONE]; {error} on failure.

class NumaRequest(BaseModel):
    api_key: str
    system: str = ""
    messages: List[Any]
    max_tokens: int = 8192
    model: str = "claude-sonnet-4-6"


@router.post("/numa")
def numa_chat(req: NumaRequest) -> StreamingResponse:
    def gen():
        try:
            client = anthropic.Anthropic(api_key=req.api_key)
            with client.messages.stream(
                model=req.model,
                max_tokens=req.max_tokens,
                system=req.system or "",
                messages=req.messages,
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'token': text})}\n\n"
                final = stream.get_final_message()
                usage = getattr(final, "usage", None)
                if usage is not None:
                    yield f"data: {json.dumps({'usage': {'input_tokens': usage.input_tokens, 'output_tokens': usage.output_tokens}})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")
