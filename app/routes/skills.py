"""Skills persistence: CRUD over saved research pipelines + propose-a-draft.

Skills are the deliberate door of the research engine (docs/RESEARCH_PLAN.md):
saved, editable plan templates. Storage mirrors the notes pattern exactly — the
whole ``skills.json`` array is read and rewritten on every mutation (no database,
no new infrastructure) — but the operations are proper per-item CRUD keyed by a
uuid ``id``, and ``version`` increments on every edit.

* GET    /skills          → the saved skills array
* POST   /skills          → create (server assigns a uuid id, version 1)
* PUT    /skills/{id}      → replace name/description/plan, bump version
* DELETE /skills/{id}      → remove
* POST   /skills/propose   → planner proposes a plan template → a DRAFT skill
  (id=None, **not persisted** — persisting is the caller's subsequent POST)
"""

import json
import uuid
from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import SKILLS_FILE
from app.research.planner import SKILL_MAX_SUBTASKS, propose_plan
from app.research.schemas import Plan, Skill

router = APIRouter()


# --- Whole-file read/write, like notes -------------------------------------

def _load_skills() -> list:
    """Load the skills array from disk. Empty list if the file is absent/bad."""
    try:
        if SKILLS_FILE.exists():
            return json.loads(SKILLS_FILE.read_text(encoding="utf-8"))
        return []
    except Exception:
        return []


def _save_skills(skills: list) -> None:
    SKILLS_FILE.write_text(
        json.dumps(skills, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


# --- Wire shapes ------------------------------------------------------------

class SkillIn(BaseModel):
    """The editable fields of a skill (id/version are server-managed)."""

    name: str
    description: str = ""
    plan: Plan = Field(default_factory=Plan)


class ProposeRequest(BaseModel):
    description: str
    # Tickers the user is currently looking at — used only by the generalize
    # safety net below to scrub concrete symbols out of the reusable draft.
    tickers: List[str] = Field(default_factory=list)


# ============================================================
# === CRUD ===
# ============================================================

@router.get("/skills")
def list_skills() -> list:
    return _load_skills()


@router.post("/skills")
def create_skill(req: SkillIn) -> dict:
    """Persist a new skill with a fresh uuid id at version 1."""
    skills = _load_skills()
    skill = Skill(id=uuid.uuid4().hex, name=req.name,
                  description=req.description, version=1, plan=req.plan)
    skills.append(skill.model_dump())
    _save_skills(skills)
    return skill.model_dump()


@router.put("/skills/{skill_id}")
def update_skill(skill_id: str, req: SkillIn) -> dict:
    """Replace an existing skill's editable fields, bumping its version."""
    skills = _load_skills()
    for i, existing in enumerate(skills):
        if existing.get("id") == skill_id:
            updated = Skill(
                id=skill_id, name=req.name, description=req.description,
                version=int(existing.get("version", 1)) + 1, plan=req.plan,
            )
            skills[i] = updated.model_dump()
            _save_skills(skills)
            return updated.model_dump()
    raise HTTPException(status_code=404, detail=f"skill {skill_id} not found")


@router.delete("/skills/{skill_id}")
def delete_skill(skill_id: str) -> dict:
    skills = _load_skills()
    remaining = [s for s in skills if s.get("id") != skill_id]
    if len(remaining) == len(skills):
        raise HTTPException(status_code=404, detail=f"skill {skill_id} not found")
    _save_skills(remaining)
    return {"ok": True, "id": skill_id}


# ============================================================
# === PROPOSE — planner drafts a plan template (not persisted) ===
# ============================================================

@router.post("/skills/propose")
def propose_skill(req: ProposeRequest) -> dict:
    """One planner pass over the skill's description → a DRAFT skill for the user
    to edit and then save (POST /skills). id is None to mark it unsaved.

    All the work lives in ``planner.propose_plan`` (invert-the-substitution): it
    plans against a concrete example ticker, then swaps it back to ``{ticker}``,
    returning a short Title-Case name and a reusable, ticker-agnostic plan. The
    request's ``tickers`` are handed through so the caller's real symbols are
    canonicalized/scrubbed too. Capped at 8 steps."""
    description = req.description.strip()
    name, plan = propose_plan(description, tickers=req.tickers, max_subtasks=SKILL_MAX_SUBTASKS)
    draft = Skill(id=None, name=name or "New skill",
                  description=description, version=1, plan=plan)
    return draft.model_dump()
