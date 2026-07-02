"""Research engine package.

One engine, two doors (see docs/RESEARCH_PLAN.md): a planner turns an objective
into a subtask plan, an executor walks that plan against Numa's data modules and
synthesizes the result. Skills are saved, editable plan templates over the same
engine.

Nothing here is imported at package-import time on purpose — the HTTP layer
(app/routes/research.py) imports ``planner`` and ``executor`` explicitly — so
``import app.research`` stays cheap.
"""
