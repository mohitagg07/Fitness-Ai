"""
LangGraph Stateful Workout Coach Agent

Graph flow:
  parse_input → evaluate_fatigue → retrieve_guardrails → build_workout → post_process
"""
from __future__ import annotations
import json
from typing import TypedDict, List, Optional, Annotated
from datetime import date

from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
from langchain_openai import ChatOpenAI
from langchain_core.output_parsers import JsonOutputParser
from langgraph.graph import StateGraph, END

from db.chroma_client import query_guardrails
from schemas.models import PerformanceLog, AgentState
from core.config import get_settings

settings = get_settings()


# ─── LangGraph State ─────────────────────────────────────────────────────────
class WorkoutGraphState(TypedDict):
    # Input
    user_message: str
    user_id: str
    user_profile: dict           # height, weight, goal, experience, injuries, PRs
    agent_state: dict            # persisted fatigue/state from DB

    # Intermediate
    parsed_logs: List[dict]      # parsed PerformanceLogs from natural language
    guardrails: List[str]        # retrieved safety rules from ChromaDB
    emergency: bool              # True if acute injury keyword detected

    # Output
    workout_blocks: Optional[dict]
    reply: str
    cns_fatigue_score: int
    guardrails_triggered: List[str]


# ─── LLM ─────────────────────────────────────────────────────────────────────
def get_llm():
    return ChatOpenAI(
        model="gpt-4o",
        api_key=settings.openai_api_key,
        temperature=0.3,
    )


# ─── Node 1: Parse Input ──────────────────────────────────────────────────────
def parse_input_node(state: WorkoutGraphState) -> WorkoutGraphState:
    """
    Convert natural language workout logs into structured PerformanceLog objects.
    E.g. "I deadlifted 150kg x 3 with straps" → PerformanceLog(exercise=Deadlift, weight=150, reps=3, modifiers=[straps])
    """
    user_msg = state["user_message"]

    # Check for emergency keywords FIRST — bypass everything
    emergency_kws = ["sharp pain", "pop", "snap", "tore", "torn", "injured badly", "can't move"]
    if any(kw in user_msg.lower() for kw in emergency_kws):
        state["emergency"] = True
        state["parsed_logs"] = []
        return state

    llm = get_llm()
    parse_prompt = f"""
Extract all exercise performance data from this user message.
Return a JSON array. If no exercise data, return empty array [].

Each item must have:
- exercise_name (string)
- weight_kg (float)
- reps_completed (int)
- equipment_modifiers (list of strings, e.g. ["straps", "belt"])
- user_reported_rpe (float 1-10 or null — infer from phrases like "felt easy"=6, "almost failed"=9.5)
- notes (string or null)

User message: "{user_msg}"

Return ONLY valid JSON array, no explanation.
"""
    try:
        response = llm.invoke([HumanMessage(content=parse_prompt)])
        raw = response.content.strip()
        # Strip markdown fences if present
        raw = raw.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(raw)
        state["parsed_logs"] = parsed if isinstance(parsed, list) else []
    except Exception:
        state["parsed_logs"] = []

    state["emergency"] = False
    return state


# ─── Node 2: Evaluate CNS Fatigue ────────────────────────────────────────────
def evaluate_fatigue_node(state: WorkoutGraphState) -> WorkoutGraphState:
    """
    Update CNS fatigue score based on:
    - Last logged RPE from parsed logs
    - Accumulated spinal load
    - Days since last session
    """
    agent = state["agent_state"]
    fatigue = agent.get("cns_fatigue_score", 0)
    spinal_load = agent.get("accumulated_spinal_load", 0)

    # Extract max RPE from this session's logs
    logs = state["parsed_logs"]
    if logs:
        max_rpe = max((l.get("user_reported_rpe") or 5 for l in logs), default=5)

        # High RPE on heavy compound = CNS stress
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
            # Recovery — reduce fatigue slightly
            fatigue = max(0, fatigue - 1)

        # Track spinal load from deadlifts/squats
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
    Query ChromaDB for relevant safety rules based on:
    - User message content
    - User's injury profile
    - Current exercise mentions
    """
    if state.get("emergency"):
        emergency_rule = query_guardrails("sharp pain injury emergency", n_results=1)
        state["guardrails"] = emergency_rule
        state["guardrails_triggered"] = ["EMERGENCY: Acute injury protocol"]
        return state

    profile = state.get("user_profile", {})
    injuries = profile.get("injuries", [])
    injury_tags = [f"{i['body_part']}_{i['issue_type']}" for i in injuries]

    query_text = state["user_message"]

    # Enrich query with exercise mentions from parsed logs
    for log in state.get("parsed_logs", []):
        name = log.get("exercise_name", "")
        if name:
            query_text += f" {name}"

    rules = query_guardrails(
        query_text=query_text,
        injury_tags=injury_tags,
        n_results=4
    )

    # High fatigue always pulls the CNS protocol
    if state["cns_fatigue_score"] >= 7:
        cns_rule = query_guardrails("CNS fatigue overtraining exhausted", n_results=1)
        rules = list(set(rules + cns_rule))

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


# ─── Node 4: Build Workout ────────────────────────────────────────────────────
def build_workout_node(state: WorkoutGraphState) -> WorkoutGraphState:
    """
    Generate the personalized workout response using the LLM,
    with guardrails injected into the system prompt.
    """
    if state.get("emergency"):
        state["reply"] = (
            "⚠️ WORKOUT TERMINATED — ACUTE INJURY PROTOCOL ACTIVATED\n\n"
            "Sharp pain / injury signal detected. Do NOT continue training.\n\n"
            "R.I.C.E PROTOCOL:\n"
            "• REST — Stop all activity immediately\n"
            "• ICE — Apply ice for 20 min every hour\n"
            "• COMPRESSION — Wrap the affected area\n"
            "• ELEVATION — Raise above heart level\n\n"
            "See a doctor before returning to training. Your safety is the priority."
        )
        state["workout_blocks"] = None
        return state

    profile = state.get("user_profile", {})
    prs = profile.get("personal_records", {})
    fatigue = state["cns_fatigue_score"]
    guardrails_text = "\n".join(state.get("guardrails", []))

    # Anti-hallucination: compute max allowed weights
    weight_caps = {
        ex: round(weight * 1.05, 1)
        for ex, weight in prs.items()
    }
    weight_caps_str = json.dumps(weight_caps) if weight_caps else "No PRs on file yet"

    system_prompt = f"""You are an elite AI fitness coach. Authoritative, precise, science-driven.
You generate highly tactical, personalized workout plans and coaching responses.

ATHLETE PROFILE:
- Goal: {profile.get('goal', 'general fitness')}
- Experience: {profile.get('experience_level', 'intermediate')}
- Weight: {profile.get('weight_kg', '?')} kg
- Phase: {profile.get('current_phase', 'general')}
- Equipment: {', '.join(profile.get('equipment', ['full gym']))}
- Injuries: {json.dumps(profile.get('injuries', []))}

CNS FATIGUE SCORE: {fatigue}/10
{"⚠️ HIGH FATIGUE — shift remaining session to machine-only, reduce volume 40%" if fatigue >= 7 else ""}

ANTI-HALLUCINATION WEIGHT CAPS (never suggest above these):
{weight_caps_str}

BIOMECHANICAL SAFETY RULES (MANDATORY — apply all relevant rules):
{guardrails_text if guardrails_text else "No specific guardrails triggered — standard safety applies."}

RESPONSE RULES:
1. Never suggest weight > 105% of user's known PR for any exercise.
2. If injury tag matches an exercise, replace it with the safe alternative.
3. Structure workouts as: BLOCK A (compounds) → BLOCK B (isolation) → BLOCK C (decompression/finisher).
4. Include: exercise name, sets × reps, load target, execution cue.
5. Mention mandatory dead hang after Deadlifts/Squats always.
6. Tone: tactical, motivating, no generic fluff. Use precise terminology.
7. If user is logging a completed session, acknowledge the performance, assess it, and give next-session guidance.
"""

    llm = get_llm()
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=state["user_message"]),
    ]

    response = llm.invoke(messages)
    state["reply"] = response.content

    # Try to extract structured workout blocks if present
    try:
        if "BLOCK A" in response.content or "BLOCK B" in response.content:
            state["workout_blocks"] = {
                "raw": response.content,
                "generated": True,
            }
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
    graph.add_node("build_workout", build_workout_node)

    graph.set_entry_point("parse_input")
    graph.add_edge("parse_input", "evaluate_fatigue")
    graph.add_edge("evaluate_fatigue", "retrieve_guardrails")
    graph.add_edge("retrieve_guardrails", "build_workout")
    graph.add_edge("build_workout", END)

    return graph.compile()


# Singleton compiled graph
coach_graph = build_coach_graph()


async def run_coach(
    user_message: str,
    user_id: str,
    user_profile: dict,
    agent_state: dict,
) -> dict:
    """Entry point for the coach agent."""
    initial_state: WorkoutGraphState = {
        "user_message": user_message,
        "user_id": user_id,
        "user_profile": user_profile,
        "agent_state": agent_state,
        "parsed_logs": [],
        "guardrails": [],
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
