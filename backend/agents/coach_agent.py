"""
LangGraph Stateful Workout Coach Agent

Graph flow:
  parse_input → evaluate_fatigue → retrieve_guardrails → recall_memory → build_workout → END

FIXES:
  BUG 1 — "can only join an iterable" (original crash):
    retrieve_guardrails_node used i['body_part'] and i['issue_type'] directly.
    If either key was missing/None, the list contained None values, and
    ",".join(...) in ChromaDB metadata blew up. Fixed with .get() + filtering.

  BUG 2 — ChromaDB dimension mismatch (384 vs 256):
    Self-heal only caught InvalidArgumentError; newer ChromaDB raises plain
    Exception. Fixed in chroma_client.py with _is_dimension_error().

  BUG 3 — Coach had NO session memory:
    Every message was sent cold to the LLM — prior conversation turns were
    stored in DB but never re-injected. Added prior_messages parameter to
    run_coach() and injected as HumanMessage/AIMessage pairs in build_workout_node,
    giving the coach genuine within-session recall.
"""
from __future__ import annotations
import json
import logging
from typing import TypedDict, List, Optional
from datetime import date

from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
from langchain_groq import ChatGroq
from langgraph.graph import StateGraph, END

from db.chroma_client import query_guardrails
from db.memory_client import recall, remember
from core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


# ─── LangGraph State ─────────────────────────────────────────────────────────
class WorkoutGraphState(TypedDict):
    user_message: str
    user_id: str
    user_profile: dict
    agent_state: dict
    prior_messages: List[dict]   # NEW: injected chat history from DB

    parsed_logs: List[dict]
    guardrails: List[str]
    long_term_memories: List[str]
    emergency: bool

    workout_blocks: Optional[dict]
    reply: str
    cns_fatigue_score: int
    guardrails_triggered: List[str]


def get_llm():
    return ChatGroq(
        model=settings.groq_model,
        api_key=settings.groq_api_key,
        temperature=0.3,
    )


# ─── Node 1: Parse Input ─────────────────────────────────────────────────────
def parse_input_node(state: WorkoutGraphState) -> WorkoutGraphState:
    user_msg = state["user_message"]

    emergency_kws = ["sharp pain", "pop", "snap", "tore", "torn", "injured badly", "can't move"]
    if any(kw in user_msg.lower() for kw in emergency_kws):
        state["emergency"] = True
        state["parsed_logs"] = []
        return state

    llm = get_llm()
    parse_prompt = f"""Extract all exercise performance data from this user message.
Return a JSON array. If no exercise data, return empty array [].

Each item must have:
- exercise_name (string)
- weight_kg (float)
- reps_completed (int)
- equipment_modifiers (list of strings)
- user_reported_rpe (float 1-10 or null)
- notes (string or null)

User message: "{user_msg}"

Return ONLY valid JSON array, no explanation, no markdown fences."""

    try:
        response = llm.invoke([HumanMessage(content=parse_prompt)])
        raw = response.content.strip().replace("```json", "").replace("```", "").strip()
        parsed = json.loads(raw)
        state["parsed_logs"] = parsed if isinstance(parsed, list) else []
    except Exception as e:
        logger.debug(f"parse_input_node: could not parse logs: {e}")
        state["parsed_logs"] = []

    state["emergency"] = False
    return state


# ─── Node 2: Evaluate CNS Fatigue ────────────────────────────────────────────
def evaluate_fatigue_node(state: WorkoutGraphState) -> WorkoutGraphState:
    agent = state["agent_state"]
    fatigue = agent.get("cns_fatigue_score", 0)
    spinal_load = agent.get("accumulated_spinal_load", 0)

    logs = state["parsed_logs"]
    if logs:
        max_rpe = max((l.get("user_reported_rpe") or 5 for l in logs), default=5)
        heavy_compounds = ["deadlift", "squat", "bench press"]
        has_heavy = any(
            any(c in (l.get("exercise_name") or "").lower() for c in heavy_compounds)
            for l in logs
        )
        if max_rpe >= 9.5 and has_heavy:
            fatigue = min(10, fatigue + 3)
        elif max_rpe >= 9.0:
            fatigue = min(10, fatigue + 2)
        elif max_rpe >= 8.0:
            fatigue = min(10, fatigue + 1)
        else:
            fatigue = max(0, fatigue - 1)

        for log in logs:
            name = (log.get("exercise_name") or "").lower()
            weight = log.get("weight_kg") or 0
            if "deadlift" in name or "squat" in name:
                spinal_load += int(weight * (log.get("reps_completed") or 1))

    state["cns_fatigue_score"] = fatigue
    state["agent_state"] = {**agent, "cns_fatigue_score": fatigue, "accumulated_spinal_load": spinal_load}
    return state


# ─── Node 3: Retrieve Guardrails ─────────────────────────────────────────────
def retrieve_guardrails_node(state: WorkoutGraphState) -> WorkoutGraphState:
    """
    FIX: Safe extraction of injury_tags using .get() with defaults.
    None values in the tag list caused "can only join an iterable".
    """
    if state.get("emergency"):
        state["guardrails"] = query_guardrails("sharp pain injury emergency", n_results=1)
        state["guardrails_triggered"] = ["EMERGENCY: Acute injury protocol"]
        return state

    profile = state.get("user_profile", {})
    injuries = profile.get("injuries") or []

    injury_tags = []
    for inj in injuries:
        if not isinstance(inj, dict):
            continue
        body_part = (inj.get("body_part") or "").strip()
        issue_type = (inj.get("issue_type") or "").strip()
        if body_part and issue_type:
            injury_tags.append(f"{body_part}_{issue_type}")
        elif body_part:
            injury_tags.append(body_part)

    query_text = state["user_message"]
    for log in state.get("parsed_logs", []):
        name = log.get("exercise_name", "")
        if name:
            query_text += f" {name}"

    try:
        rules = query_guardrails(query_text=query_text, injury_tags=injury_tags, n_results=4)
        if state.get("cns_fatigue_score", 0) >= 7:
            cns_rules = query_guardrails("CNS fatigue overtraining exhausted", n_results=1)
            seen = set(rules)
            for r in cns_rules:
                if r not in seen:
                    rules.append(r)
                    seen.add(r)
    except Exception as e:
        logger.warning(f"retrieve_guardrails_node: failed, continuing without guardrails: {e}")
        rules = []

    triggered = []
    for rule in rules:
        if "EMERGENCY" in rule:
            triggered.append("Emergency protocol")
        elif "shoulder" in rule.lower():
            triggered.append("Shoulder protection")
        elif "spinal" in rule.lower() or "deadlift" in rule.lower():
            triggered.append("Spinal decompression")
        elif "CNS FATIGUE" in rule:
            triggered.append("CNS fatigue modifier")
        elif "DELOAD" in rule:
            triggered.append("Deload protocol")

    state["guardrails"] = rules
    state["guardrails_triggered"] = triggered
    return state


# ─── Node 3.5: Recall Long-Term Memory ───────────────────────────────────────
def recall_memory_node(state: WorkoutGraphState) -> WorkoutGraphState:
    if state.get("emergency"):
        state["long_term_memories"] = []
        return state
    try:
        memories = recall(state["user_id"], state["user_message"], n_results=5)
    except Exception as e:
        logger.debug(f"recall_memory_node: failed: {e}")
        memories = []
    state["long_term_memories"] = memories
    return state


# ─── Node 4: Build Workout ────────────────────────────────────────────────────
def build_workout_node(state: WorkoutGraphState) -> WorkoutGraphState:
    if state.get("emergency"):
        state["reply"] = (
            "WORKOUT TERMINATED — ACUTE INJURY PROTOCOL ACTIVATED\n\n"
            "Sharp pain / injury signal detected. Do NOT continue training.\n\n"
            "R.I.C.E PROTOCOL:\n"
            "- REST — Stop all activity immediately\n"
            "- ICE — Apply ice for 20 min every hour\n"
            "- COMPRESSION — Wrap the affected area\n"
            "- ELEVATION — Raise above heart level\n\n"
            "See a doctor before returning to training. Your safety is the priority."
        )
        state["workout_blocks"] = None
        return state

    profile = state.get("user_profile", {})
    prs = profile.get("personal_records") or {}
    fatigue = state.get("cns_fatigue_score", 0)
    guardrails_text = "\n".join(state.get("guardrails", []))

    weight_caps = {
        ex: round(weight * 1.05, 1)
        for ex, weight in (prs.items() if isinstance(prs, dict) else {}.items())
    }
    weight_caps_str = json.dumps(weight_caps) if weight_caps else "No PRs on file yet"

    memories = state.get("long_term_memories") or []
    memories_text = (
        "\n".join(f"- {m}" for m in memories)
        if memories else "Nothing specific on file yet."
    )

    system_prompt = f"""You are an elite AI fitness coach. Authoritative, precise, science-driven.
You generate highly tactical, personalized workout plans and coaching responses.

ATHLETE PROFILE:
- Goal: {profile.get('goal', 'general fitness')}
- Experience: {profile.get('experience_level', 'intermediate')}
- Weight: {profile.get('weight_kg', '?')} kg
- Phase: {profile.get('current_phase', 'general')}
- Equipment: {', '.join(profile.get('equipment') or ['full gym'])}
- Injuries: {json.dumps(profile.get('injuries') or [])}

CNS FATIGUE SCORE: {fatigue}/10
{"⚠️ HIGH FATIGUE — shift remaining session to machine-only, reduce volume 40%" if fatigue >= 7 else ""}

ANTI-HALLUCINATION WEIGHT CAPS (never suggest above these):
{weight_caps_str}

BIOMECHANICAL SAFETY RULES (MANDATORY):
{guardrails_text if guardrails_text else "No specific guardrails triggered — standard safety applies."}

LONG-TERM MEMORY (things you know about this user):
{memories_text}

RESPONSE RULES:
1. Never suggest weight > 105% of user's known PR for any exercise.
2. If injury tag matches an exercise, replace it with the safe alternative.
3. Structure workouts as: BLOCK A (compounds) → BLOCK B (isolation) → BLOCK C (decompression/finisher).
4. Include: exercise name, sets × reps, load target, execution cue.
5. Mention mandatory dead hang after Deadlifts/Squats.
6. Tone: tactical, motivating, no generic fluff.
7. If user is logging a completed session, acknowledge it and give next-session guidance.
8. This is an ongoing conversation — refer to what was said earlier when relevant.
"""

    llm = get_llm()

    # FIX: Inject prior conversation turns as actual LangChain message objects.
    # Previously every message was sent cold (no history). Now the LLM sees
    # the full recent conversation and can refer back to it naturally.
    messages = [SystemMessage(content=system_prompt)]

    for turn in state.get("prior_messages", []):
        role = turn.get("role", "")
        content = turn.get("content", "")
        if not content:
            continue
        if role == "user":
            messages.append(HumanMessage(content=content))
        elif role == "assistant":
            messages.append(AIMessage(content=content))

    messages.append(HumanMessage(content=state["user_message"]))

    response = llm.invoke(messages)
    state["reply"] = response.content

    # Store durable personal facts in long-term memory
    try:
        msg_lower = state["user_message"].lower()
        durable_signals = [
            "i like", "i love", "i hate", "i can't stand", "i always",
            "i never", "i prefer", "my knee", "my shoulder", "my back",
            "best in the", "worst in the", "i miss", "i skip",
        ]
        if any(sig in msg_lower for sig in durable_signals):
            remember(state["user_id"], state["user_message"], category="general")
    except Exception:
        pass

    try:
        if "BLOCK A" in response.content or "BLOCK B" in response.content:
            state["workout_blocks"] = {"raw": response.content, "generated": True}
        else:
            state["workout_blocks"] = None
    except Exception:
        state["workout_blocks"] = None

    return state


# ─── Build the Graph ──────────────────────────────────────────────────────────
def build_coach_graph():
    graph = StateGraph(WorkoutGraphState)
    graph.add_node("parse_input", parse_input_node)
    graph.add_node("evaluate_fatigue", evaluate_fatigue_node)
    graph.add_node("retrieve_guardrails", retrieve_guardrails_node)
    graph.add_node("recall_memory", recall_memory_node)
    graph.add_node("build_workout", build_workout_node)
    graph.set_entry_point("parse_input")
    graph.add_edge("parse_input", "evaluate_fatigue")
    graph.add_edge("evaluate_fatigue", "retrieve_guardrails")
    graph.add_edge("retrieve_guardrails", "recall_memory")
    graph.add_edge("recall_memory", "build_workout")
    graph.add_edge("build_workout", END)
    return graph.compile()


coach_graph = build_coach_graph()


async def run_coach(
    user_message: str,
    user_id: str,
    user_profile: dict,
    agent_state: dict,
    prior_messages: list = None,   # NEW parameter
) -> dict:
    initial_state: WorkoutGraphState = {
        "user_message": user_message,
        "user_id": user_id,
        "user_profile": user_profile,
        "agent_state": agent_state,
        "prior_messages": prior_messages or [],
        "parsed_logs": [],
        "guardrails": [],
        "long_term_memories": [],
        "emergency": False,
        "workout_blocks": None,
        "reply": "",
        "cns_fatigue_score": agent_state.get("cns_fatigue_score", 0),
        "guardrails_triggered": [],
    }

    result = await coach_graph.ainvoke(initial_state)
    return {
        "reply": result["reply"],
        "guardrails_triggered": result["guardrails_triggered"],
        "emergency": result["emergency"],
        "cns_fatigue_score": result["cns_fatigue_score"],
        "workout_blocks": result["workout_blocks"],
        "updated_agent_state": result["agent_state"],
        "parsed_logs": result["parsed_logs"],
    }