"""
LangGraph Stateful Workout Coach Agent

Graph flow:
  parse_input → evaluate_fatigue → retrieve_guardrails → recall_memory → build_workout → END

build_workout_node is the ONLY node that calls the LLM for the coaching
decision. It outputs a structured "Mission Control" decision card directly
(analysis → ai_decision → next_action → coaching_cue) in a single call —
there is no separate "write an essay, then distil it to JSON" step anymore.
Philosophy: less reading, less thinking, more lifting.

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

  BUG 4 — Two LLM calls doing one job's worth of work:
    The graph used to have build_workout_node write a free-text "elite coach"
    essay, then a second node (structured_decision_node) made another LLM
    call to distil that essay back into the JSON decision card the UI
    actually needs. That doubled latency and Groq cost on every turn for no
    benefit — the model already "knows" the structured answer when it writes
    prose, so asking it to skip straight to the structured answer is strictly
    better. structured_decision_node is removed; build_workout_node now
    returns the decision card directly.

  BUG 5 — StructuredDecision schema/prompt field mismatch:
    The old distil prompt asked the LLM for `ai_decision`, `protein_target`,
    `calories_target`, but the Pydantic schema only declared `reason`,
    `protein`, `calories`. Pydantic silently drops unknown fields, so
    `ai_decision` was always None in every API response regardless of what
    the LLM returned. Schema now matches what the agent actually produces.
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
    prior_messages: List[dict]   # injected chat history from DB

    parsed_logs: List[dict]
    guardrails: List[str]
    long_term_memories: List[str]
    emergency: bool

    workout_blocks: Optional[dict]
    reply: str
    cns_fatigue_score: int
    guardrails_triggered: List[str]
    structured_decision: Optional[dict]   # JSON decision card payload


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


# ─── Node 4: Build Workout (single-call Mission Control decision) ───────────
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
        state["structured_decision"] = {
            "mode": "emergency",
            "analysis": "Acute injury signal detected.",
            "ai_decision": "Stop training immediately.",
            "next_action": "Apply R.I.C.E. See a doctor before returning.",
            "coaching_cue": "Your safety is the priority — no exceptions.",
            "coach_insight": "Sharp pain overrides every other goal today.",
        }
        return state

    profile = state.get("user_profile", {})
    prs = profile.get("personal_records") or {}
    fatigue = state.get("cns_fatigue_score", 0)
    recovery_pct = max(0, min(100, round((10 - fatigue) / 10 * 100)))
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

    # NeuroFit AI — Mission Control prompt.
    # Replaces the old "elite coach writes an essay" prompt. The job here is
    # to REDUCE decision making, not narrate it. One LLM call produces the
    # final decision card directly — no second call to distil prose into
    # JSON afterward (that's what structured_decision_node used to do, and
    # it doubled latency/cost for no benefit since the LLM already "knows"
    # the structured answer when it writes the prose version).
    system_prompt = f"""You are NeuroFit AI — an autonomous gym spotter, not a chatbot.

Your job is to REDUCE decision making, not generate reading material.
Never write a workout article. Never explain at length. Never ask a question
unless the input is too ambiguous to act on at all.

Philosophy: Less Reading. Less Thinking. More Lifting.

ATHLETE PROFILE:
- Goal: {profile.get('goal', 'general fitness')}
- Experience: {profile.get('experience_level', 'intermediate')}
- Weight: {profile.get('weight_kg', '?')} kg
- Phase: {profile.get('current_phase', 'general')}
- Equipment: {', '.join(profile.get('equipment') or ['full gym'])}
- Injuries: {json.dumps(profile.get('injuries') or [])}

CNS FATIGUE SCORE: {fatigue}/10 (recovery ≈ {recovery_pct}%)
{"⚠️ HIGH FATIGUE — shift remaining session to machine-only, reduce volume 40%" if fatigue >= 7 else ""}

ANTI-HALLUCINATION WEIGHT CAPS (never suggest above these):
{weight_caps_str}

BIOMECHANICAL SAFETY RULES (MANDATORY):
{guardrails_text if guardrails_text else "No specific guardrails triggered — standard safety applies."}

LONG-TERM MEMORY (things you know about this user):
{memories_text}

DECISION RULES:
1. Never suggest weight > 105% of user's known PR for any exercise.
2. If an injury tag matches an exercise, silently substitute the safe alternative in your decision — don't lecture about it.
3. If the user just logged a set/exercise (e.g. "Deadlift 150kg x 3 @ RPE 9"), this is a LIVE_SET turn:
   judge that set, then give the next concrete action (adjust load/reps, or proceed).
4. If the user is asking "what's today's session" or similar with no live set logged, this is a SESSION_PLAN turn:
   give ONE next exercise with load/reps/RPE target — not a full multi-block program dump.
5. If the message is general chat with no actionable training decision, this is a CHAT turn:
   answer in one line, still no essay.
6. Mention mandatory dead hang after Deadlifts/Squats only if directly relevant to the decision.
7. This is an ongoing conversation — use prior turns for continuity, but never re-explain past context.

OUTPUT FORMAT — return ONLY a valid JSON object, no markdown fences, no preamble, no text outside the JSON:
{{
  "mode": "live_set" | "session_plan" | "chat",
  "analysis": "One short line: what happened. e.g. 'Performance: Strong. Fatigue: High. Recovery cost: Significant.'",
  "ai_decision": "The single decision/call itself. e.g. 'Reduce next set to 145kg for 2 reps.' Never a question.",
  "next_action": "The concrete next step only, e.g. '145kg × 2' or 'Train before 7 PM'. Short as possible.",
  "coaching_cue": "ONE short technical or motivating cue. e.g. 'Brace harder before the pull.' Never more than one sentence.",
  "coach_insight": "One punchy line, always filled, usable as a standalone summary.",
  "intensity": "High" | "Moderate" | "Low" | "Rest" | null,
  "workout_type": "Push" | "Pull" | "Legs" | "Upper" | "Lower" | "Full Body" | "Cardio" | "Rest" | null
}}

Hard limits:
- Total words across all string fields combined: under 150 unless the user explicitly asks for detail.
- No bullet-pointed essays. No "Here's why..." paragraphs. Prefer numbers over adjectives.
- If you genuinely cannot decide without more info, set ai_decision to a single direct clarifying question — still under 150 words total, still no preamble.
"""

    llm = get_llm()

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
    raw = response.content.strip().replace("```json", "").replace("```", "").strip()

    try:
        decision = json.loads(raw)
    except Exception as e:
        logger.warning(f"build_workout_node: LLM did not return valid JSON, falling back to plain text: {e}")
        # Graceful degradation: still give the user something usable rather
        # than a 500. The frontend should treat a missing structured_decision
        # as "render reply as plain text".
        decision = {
            "mode": "chat",
            "analysis": None,
            "ai_decision": raw[:300],
            "next_action": None,
            "coaching_cue": None,
            "coach_insight": raw[:150],
            "intensity": None,
            "workout_type": None,
        }

    decision["recovery"] = recovery_pct
    decision.setdefault("calories", None)
    decision.setdefault("protein", None)
    decision.setdefault("mission", None)
    # Backward-compat alias: some older frontend code may still read `reason`
    decision["reason"] = decision.get("ai_decision")

    # Build a short plain-text fallback string too (for clients/screens that
    # haven't migrated to the card UI yet, and for conversation history).
    fallback_parts = [
        decision.get("analysis"),
        decision.get("ai_decision"),
        decision.get("next_action"),
        decision.get("coaching_cue"),
    ]
    state["reply"] = " ".join(p for p in fallback_parts if p) or decision.get("coach_insight", "")

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

    state["workout_blocks"] = None  # block-style prose dumps are gone by design
    state["structured_decision"] = decision
    return state




# ─── Build the Graph ──────────────────────────────────────────────────────────
# NOTE: there used to be a 5th node here ("structured_decision") that took
# build_workout_node's free-text reply and made a SECOND LLM call to distil
# it into JSON. That was pure waste: build_workout_node now produces the
# decision card directly in its one call, so the graph is back to 4 nodes.
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
        "structured_decision": None,
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
        "structured_decision": result.get("structured_decision"),
    }