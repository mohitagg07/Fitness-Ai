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


class WorkoutGraphState(TypedDict):
    user_message: str
    user_id: str
    user_profile: dict
    agent_state: dict
    prior_messages: List[dict]
    parsed_logs: List[dict]
    guardrails: List[str]
    long_term_memories: List[str]
    emergency: bool
    workout_blocks: Optional[dict]
    reply: str
    cns_fatigue_score: int
    guardrails_triggered: List[str]
    structured_decision: Optional[dict]


def get_llm():
    return ChatGroq(
        model=settings.groq_model,
        api_key=settings.groq_api_key,
        temperature=0.3,
    )


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


def retrieve_guardrails_node(state: WorkoutGraphState) -> WorkoutGraphState:
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
        logger.warning(f"retrieve_guardrails_node: failed: {e}")
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
            "See a doctor before returning to training."
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

    # Detect if this is a workout plan request
    msg_lower = state["user_message"].lower()
    is_workout_request = any(k in msg_lower for k in [
        "workout", "plan", "today's session", "give me", "what should i do",
        "training", "session", "exercise", "chest", "back", "legs", "push", "pull"
    ])

    # Nutrition targets calculated from profile
    w = profile.get("weight_kg") or 75
    goal = profile.get("goal") or "maintain"
    protein_target = round(w * 2.0)
    calorie_target = round(w * (38 if goal == "bulk" else 30 if goal == "cut" else 34))
    fat_target = round((calorie_target * 0.25) / 9)
    carbs_target = round((calorie_target - protein_target * 4 - fat_target * 9) / 4)
    diet_type = profile.get("diet_type") or profile.get("food_preference") or "non-veg"

    system_prompt = f"""You are NeuroFit AI — an autonomous gym spotter and nutrition coach.

ATHLETE PROFILE:
- Name: {profile.get('full_name', 'Athlete')}
- Goal: {profile.get('goal', 'general fitness')}
- Experience: {profile.get('experience_level', 'intermediate')}
- Weight: {w} kg | Height: {profile.get('height_cm', '?')} cm
- Diet: {diet_type}
- Equipment: {', '.join(profile.get('equipment') or ['full gym'])}
- Injuries: {json.dumps(profile.get('injuries') or [])}
- Training days/week: {profile.get('workout_days_per_week', 4)}
- Coach style: {profile.get('coach_style', 'friendly')}

CNS FATIGUE: {fatigue}/10 (Recovery ≈ {recovery_pct}%)
{"⚠️ HIGH FATIGUE — reduce volume 40%, machines only" if fatigue >= 7 else ""}

DAILY NUTRITION TARGETS (based on profile):
- Calories: {calorie_target} kcal | Protein: {protein_target}g | Carbs: {carbs_target}g | Fat: {fat_target}g
- Diet type: {diet_type} — suggest foods accordingly

PR WEIGHT CAPS (never suggest above):
{weight_caps_str}

SAFETY RULES:
{guardrails_text if guardrails_text else "Standard safety applies."}

MEMORY (known about this user):
{memories_text}

RESPONSE RULES:
1. If user asks for a workout/plan → return mode "session_plan" with a full workout array
2. If user logs a set → return mode "live_set" — judge the set, give next action
3. If general question → return mode "chat"
4. Always personalize based on goal, diet, experience, injuries
5. Nutrition decisions must respect diet_type (no meat for veg, eggs ok for eggetarian)

OUTPUT — return ONLY valid JSON, no markdown, no preamble:

For SESSION_PLAN (workout request):
{{
  "mode": "session_plan",
  "mission": {{
    "goal": "{profile.get('goal', 'fitness')}",
    "recovery": {recovery_pct},
    "workout_type": "Push Day / Pull Day / Legs etc"
  }},
  "analysis": "One line: today's readiness assessment",
  "ai_decision": "One line: the key coaching decision today",
  "next_action": "Short: first exercise to do",
  "coaching_cue": "One technical cue",
  "coach_insight": "One punchy summary line",
  "workout": [
    {{
      "exercise": "Exercise Name",
      "sets": 4,
      "reps": 6,
      "weight": "80 kg",
      "rpe": 8,
      "rest": "180 sec"
    }}
  ],
  "nutrition": {{
    "calories": {calorie_target},
    "protein": {protein_target},
    "carbs": {carbs_target},
    "fat": {fat_target},
    "water_l": 3.5,
    "diet_note": "One personalized food suggestion based on {diet_type} diet"
  }},
  "decisions": [
    {{
      "decision": "Specific decision about load/volume/exercise",
      "reason": "Short reason based on their data"
    }}
  ]
}}

For LIVE_SET or CHAT:
{{
  "mode": "live_set" | "chat",
  "analysis": "...",
  "ai_decision": "...",
  "next_action": "...",
  "coaching_cue": "...",
  "coach_insight": "...",
  "intensity": "High" | "Moderate" | "Low" | null,
  "workout_type": null
}}
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
        logger.warning(f"build_workout_node: LLM returned invalid JSON: {e}")
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
    decision.setdefault("calories", calorie_target)
    decision.setdefault("protein", protein_target)
    decision.setdefault("mission", None)
    decision["reason"] = decision.get("ai_decision")

    fallback_parts = [
        decision.get("analysis"),
        decision.get("ai_decision"),
        decision.get("next_action"),
        decision.get("coaching_cue"),
    ]
    state["reply"] = " ".join(p for p in fallback_parts if p) or decision.get("coach_insight", "")

    try:
        msg_lower = state["user_message"].lower()
        durable_signals = [
            "i like", "i love", "i hate", "i can't stand", "i always",
            "i never", "i prefer", "my knee", "my shoulder", "my back",
        ]
        if any(sig in msg_lower for sig in durable_signals):
            remember(state["user_id"], state["user_message"], category="general")
    except Exception:
        pass

    state["workout_blocks"] = None
    state["structured_decision"] = decision
    return state


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
    prior_messages: list = None,
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