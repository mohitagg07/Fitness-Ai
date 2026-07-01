"""
VYRN — LangGraph Coach Agent (v2)

MAJOR CHANGES vs v1:
  - LLM returns structured JSON with response_type so the frontend can
    render rich cards instead of plain chat bubbles.
  - response_type: "workout_plan" | "nutrition_tip" | "recovery_advice"
                   | "progress_update" | "chat"
  - workout_plan responses include a full `exercises` array (name, sets,
    reps, weight, rest, focus) plus summary (intensity, estimated_time, reason).
  - Internal reasoning NEVER leaks to the user. The prompt is rewritten
    to produce first-person coach responses, not planning notes.
  - Prior messages are injected for session continuity.
  - Proactive insights surface without user prompting (e.g. protein gap,
    missed session) when the agent detects relevant state.
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

    # Live nutrition + body-weight context, fetched once per turn so the
    # coach can reference today's actual intake and the real weight trend
    # instead of only the static onboarding weight_kg field.
    nutrition_today: Optional[dict]
    weight_trend: Optional[dict]


def _load_nutrition_today(user_id: str) -> dict:
    """
    Today's logged calories/protein/carbs/fat/water vs target, so the coach
    can say "you're 40g short on protein" instead of generic advice. Mirrors
    the same query api/routes/nutrition.py:get_today_nutrition uses, kept
    intentionally separate (not imported) to avoid a route->agent import
    cycle; both read the same nutrition_logs rows so they can never disagree.
    """
    from datetime import date as _date
    from db.supabase_client import get_supabase
    sb = get_supabase()
    today = str(_date.today())
    try:
        res = (
            sb.table("nutrition_logs")
            .select("calories, protein_g, carbs_g, fat_g, water_ml")
            .eq("user_id", user_id)
            .eq("log_date", today)
            .execute()
        )
        logs = res.data or []
    except Exception:
        logs = []
    return {
        "calories":  sum(l.get("calories")  or 0 for l in logs),
        "protein_g": round(sum(l.get("protein_g") or 0 for l in logs), 1),
        "carbs_g":   round(sum(l.get("carbs_g")   or 0 for l in logs), 1),
        "fat_g":     round(sum(l.get("fat_g")     or 0 for l in logs), 1),
        "water_ml":  sum(l.get("water_ml")  or 0 for l in logs),
        "logged":    len(logs) > 0,
    }


def _load_weight_trend(user_id: str, lookback_days: int = 30) -> dict:
    """
    Real body-weight trend from progress_metrics — latest entry, the delta
    vs the oldest entry in the lookback window, and the direction. Returns
    has_data=False if the user has never logged a weigh-in, so the coach
    can say "no weight logged yet" instead of fabricating a number.
    """
    from datetime import date as _date, timedelta as _timedelta
    from db.supabase_client import get_supabase
    sb = get_supabase()
    cutoff = str(_date.today() - _timedelta(days=lookback_days))
    try:
        res = (
            sb.table("progress_metrics")
            .select("weight_kg, recorded_date")
            .eq("user_id", user_id)
            .not_.is_("weight_kg", "null")
            .gte("recorded_date", cutoff)
            .order("recorded_date")
            .execute()
        )
        rows = [r for r in (res.data or []) if r.get("weight_kg")]
    except Exception:
        rows = []

    if not rows:
        return {"has_data": False}

    latest = rows[-1]["weight_kg"]
    earliest = rows[0]["weight_kg"]
    delta = round(latest - earliest, 1)
    return {
        "has_data": True,
        "latest_kg": latest,
        "latest_date": rows[-1]["recorded_date"],
        "delta_kg": delta,
        "direction": "up" if delta > 0.1 else "down" if delta < -0.1 else "stable",
        "entries_count": len(rows),
        "window_days": lookback_days,
    }


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


# ─── Node 3b: Load Live Nutrition + Weight Context ───────────────────────────
def load_nutrition_and_weight_node(state: WorkoutGraphState) -> WorkoutGraphState:
    """
    Fetches today's actual nutrition log and the user's real weight trend so
    the coach prompt can ground statements like "you're short on protein" or
    "you've lost 1.2kg this month" in real data rather than the static
    onboarding profile. Skipped on the emergency path since that reply is a
    fixed safety template and doesn't need this context.
    """
    if state.get("emergency"):
        state["nutrition_today"] = None
        state["weight_trend"] = None
        return state
    user_id = state["user_id"]
    try:
        state["nutrition_today"] = _load_nutrition_today(user_id)
    except Exception as e:
        logger.debug(f"load_nutrition_and_weight_node: nutrition fetch failed: {e}")
        state["nutrition_today"] = None
    try:
        state["weight_trend"] = _load_weight_trend(user_id)
    except Exception as e:
        logger.debug(f"load_nutrition_and_weight_node: weight fetch failed: {e}")
        state["weight_trend"] = None
    return state


# ─── Node 4: Build Workout ────────────────────────────────────────────────────
def build_workout_node(state: WorkoutGraphState) -> WorkoutGraphState:
    if state.get("emergency"):
        state["reply"] = (
            "Stop training immediately — I've detected an acute injury signal.\n\n"
            "Apply R.I.C.E right now:\n"
            "• REST — no more reps today\n"
            "• ICE — 20 min every hour\n"
            "• COMPRESSION — wrap the area\n"
            "• ELEVATION — raise above heart level\n\n"
            "See a physio before your next session. Your health > any PR."
        )

        state["workout_blocks"] = None
        state["structured_decision"] = {
            "response_type": "emergency",
            "summary": "Acute injury signal detected. Training terminated.",
            "coach_message": "Stop training immediately — I've detected an acute injury signal.",
            "exercises": [],
            "tips": ["Apply R.I.C.E.", "Rest completely.", "See a physio before returning."],
            "intensity": "Rest",
            "estimated_time": None,
            "reason": "Acute injury overrides all other goals.",
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

    # ── Live nutrition + body-weight context (NOT the static onboarding
    # values above) — lets the coach say "you're 40g short on protein
    # today" or "you're down 1.2kg this month" grounded in real logs.
    nutrition_today = state.get("nutrition_today")
    if nutrition_today and nutrition_today.get("logged"):
        nutrition_text = (
            f"Logged today: {round(nutrition_today['calories'])} kcal, "
            f"{nutrition_today['protein_g']}g protein, "
            f"{nutrition_today['carbs_g']}g carbs, {nutrition_today['fat_g']}g fat, "
            f"{nutrition_today['water_ml']}ml water."
        )
    elif nutrition_today is not None:
        nutrition_text = "No meals logged yet today."
    else:
        nutrition_text = "Nutrition data unavailable this turn."

    weight_trend = state.get("weight_trend")
    if weight_trend and weight_trend.get("has_data"):
        direction_word = {"up": "up", "down": "down", "stable": "stable"}[weight_trend["direction"]]
        weight_text = (
            f"Latest logged weight: {weight_trend['latest_kg']}kg on {weight_trend['latest_date']}. "
            f"Trend over last {weight_trend['window_days']} days: {direction_word} "
            f"{abs(weight_trend['delta_kg'])}kg ({weight_trend['entries_count']} weigh-ins logged)."
        )
    else:
        weight_text = "No body-weight log entries yet — encourage a weigh-in if relevant, never invent a number."

    system_prompt = f"""You are VYRN — an adaptive performance AI coach. You observe, remember, and decide proactively. You know this athlete completely.

CRITICAL RULES — READ FIRST:
1. NEVER expose internal planning notes. Never say things like "Initial greeting", "User needs a session plan", "Provide current day". Speak directly to the athlete as their coach.
2. NEVER repeat yourself — say each thing once, clearly.
3. You already know their profile from onboarding. Never ask for information they've already provided.
4. Speak in first-person coach voice: "Your recovery is low today" not "Recovery: low".
5. ALWAYS respond to what the athlete actually said first. Read their message and reply to its actual content and tone — a greeting gets a greeting back, a question gets an answer, a joke gets a light reply. Do not ignore their message and substitute a generic status update instead.
6. Only bring up recovery, nutrition, or fatigue proactively when it's genuinely relevant to what they asked, when they haven't messaged in a while, or when something urgent needs their attention (e.g. very low recovery before a planned heavy session, or a guardrail-triggering injury risk). Casual messages like "hi", "hey", "how are you", or small talk should get a short, natural, in-character reply — NOT a forced nutrition/recovery briefing. If you have already mentioned a specific insight (e.g. "nutrition is low") earlier in this conversation, don't repeat the same insight again unless the athlete asks about it or the underlying numbers have changed.
7. When planning a workout, provide specific exercises, not vague advice.
8. NEVER invent a calorie/protein/water number or a body-weight figure. Use ONLY the TODAY'S NUTRITION and BODY WEIGHT sections below — if they say no data, say so honestly instead of guessing.

ATHLETE PROFILE (from onboarding — you already know this):
- Name: {(profile.get('full_name') or 'Athlete').split()[0]}
- Goal: {profile.get('goal', 'general fitness')}
- Experience: {profile.get('experience_level', 'intermediate')}
- Onboarding weight: {profile.get('weight_kg', '?')} kg (may be stale — prefer BODY WEIGHT section below for current trend)
- Phase: {profile.get('current_phase', 'general')}
- Equipment: {', '.join(profile.get('equipment') or ['full gym'])}
- Injuries: {json.dumps(profile.get('injuries') or [])}

TODAY'S NUTRITION (real logged data — ground any food/protein/calorie statement in this):
{nutrition_text}

BODY WEIGHT (real logged data — ground any weight-trend statement in this):
{weight_text}

CURRENT STATUS:
- CNS Fatigue: {fatigue}/10 (Recovery ≈ {recovery_pct}%)
- Today: {date.today().strftime('%A, %B %d')}
{"- ⚠️ HIGH FATIGUE: Recommend machine-only, 40% lower volume" if fatigue >= 7 else ""}

WEIGHT CAPS (never exceed these — anti-hallucination):
{weight_caps_str}

SAFETY RULES:
{guardrails_text if guardrails_text else "Standard safety rules apply."}

MEMORY (things you know about this athlete from past sessions):
{memories_text}

RESPONSE TYPE RULES:
- User logged a set → response_type: "live_set" — judge the set, give next action
- User asks for workout/plan → response_type: "workout_plan" — give structured plan with exercises array
- User asks about nutrition/food/protein → response_type: "nutrition_tip"
- User asks about recovery/sleep/fatigue → response_type: "recovery_advice"
- User asks about progress/PRs → response_type: "progress_update"
- Greeting, small talk, or anything else not covered above → response_type: "chat" — reply briefly and naturally to what they actually said; do not default to a nutrition/recovery status update just because it's available context

OUTPUT FORMAT — return ONLY valid JSON, no markdown fences, no text outside the JSON:
{{
  "response_type": "workout_plan" | "live_set" | "nutrition_tip" | "recovery_advice" | "progress_update" | "chat",
  "coach_message": "Your direct message to the athlete. First-person, warm but direct. Never expose internal reasoning. Never repeat info from exercises array.",
  "workout_type": "push" | "pull" | "legs" | "upper" | "lower" | "full_body" | "cardio" | "rest" | null,
  "exercises": [
    {{
      "name": "Leg Press",
      "sets": 3,
      "reps": "8",
      "weight": "70kg",
      "rest": "90 sec",
      "focus": "Slow eccentric — 3 seconds down"
    }}
  ],
  "summary": {{
    "intensity": "High" | "Moderate" | "Low" | "Recovery",
    "estimated_time": "45 min",
    "reason": "One sentence: why this plan for today"
  }},
  "tips": ["Tip 1", "Tip 2"],
  "next_action": "The single most important next step. Short.",
  "coach_insight": "One memorable coaching line. Always filled.",
  "recovery": {recovery_pct},
  "intensity": "High" | "Moderate" | "Low" | "Rest" | null
}}

For response_type "chat", "live_set", "nutrition_tip", "recovery_advice", "progress_update":
- exercises array can be empty []
- summary can be null
- tips can be 1-2 items or []

For response_type "workout_plan":
- exercises must have at least 3 items
- summary must be filled
- workout_type must be filled (best-fitting category for the session you just built)
- coach_message should NOT list the exercises again (the UI shows them in a card)

Hard limits:
- coach_message: under 100 words
- Each tip: under 15 words
- Total response: under 300 words across all fields
- Never use planning language like "I will provide", "generating", "here is"
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
        logger.warning(f"build_workout_node: LLM did not return valid JSON: {e}")
        decision = {
            "response_type": "chat",
            "coach_message": raw[:400],
            "exercises": [],
            "summary": None,
            "tips": [],
            "next_action": None,
            "coach_insight": raw[:150],
            "intensity": None,
        }

    decision["recovery"] = recovery_pct
    decision.setdefault("calories", None)
    decision.setdefault("protein", None)
    decision.setdefault("exercises", [])
    decision.setdefault("tips", [])
    decision.setdefault("summary", None)
    # backward compat aliases
    decision["reason"] = (decision.get("summary") or {}).get("reason") if isinstance(decision.get("summary"), dict) else None
    decision["ai_decision"] = decision.get("coach_message")
    decision["next_action"] = decision.get("next_action")
    decision["coaching_cue"] = (decision.get("tips") or [""])[0] if decision.get("tips") else None

    # Plain text fallback for history / clients not yet on card UI
    state["reply"] = decision.get("coach_message") or decision.get("coach_insight") or ""

    # Auto-extract memories from this message using LLM
    try:
        _auto_extract_memories(state["user_id"], state["user_message"])
    except Exception:
        pass

    # FIX: workout_blocks was unconditionally set to None here, which meant
    # coach.py's _persist_coach_plan() — gated on `if blocks:` — never ran.
    # Every workout the coach generated in chat lived only in this turn's
    # reply; workout_plans (which the dashboard's "Today's Workout" card and
    # workout_agent.py both read) was never updated, so the dashboard stayed
    # on "NO PLAN YET" forever even right after the coach built a plan.
    # Now: whenever the coach actually produced a workout_plan with real
    # exercises, we pass that along so it gets written to workout_plans.
    if decision.get("response_type") == "workout_plan" and decision.get("exercises"):
        state["workout_blocks"] = {
            "type": decision.get("workout_type"),
            "workout_type": decision.get("workout_type"),
            "exercises": decision.get("exercises"),
            "intensity": (decision.get("summary") or {}).get("intensity"),
        }
    else:
        state["workout_blocks"] = None
    state["structured_decision"] = decision
    return state


# ─── Build the Graph ──────────────────────────────────────────────────────────
def build_coach_graph():
    graph = StateGraph(WorkoutGraphState)
    graph.add_node("parse_input", parse_input_node)
    graph.add_node("evaluate_fatigue", evaluate_fatigue_node)
    graph.add_node("retrieve_guardrails", retrieve_guardrails_node)
    graph.add_node("recall_memory", recall_memory_node)
    graph.add_node("load_nutrition_and_weight", load_nutrition_and_weight_node)
    graph.add_node("build_workout", build_workout_node)
    graph.set_entry_point("parse_input")
    graph.add_edge("parse_input", "evaluate_fatigue")
    graph.add_edge("evaluate_fatigue", "retrieve_guardrails")
    graph.add_edge("retrieve_guardrails", "recall_memory")
    graph.add_edge("recall_memory", "load_nutrition_and_weight")
    graph.add_edge("load_nutrition_and_weight", "build_workout")
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
        "nutrition_today": None,
        "weight_trend": None,
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


# ─── Auto Memory Extraction Helper ───────────────────────────────────────────
_MEMORY_CATEGORY_SIGNALS = {
    "schedule": ["morning", "evening", "afternoon", "always train", "prefer to train", "work out at", "train at"],
    "food_preference": ["i like", "i love", "i hate", "i prefer", "i avoid", "i eat", "paneer", "oats", "vegan", "vegetarian"],
    "injury": ["my knee", "my shoulder", "my back", "my wrist", "pain in", "sore", "injured", "discomfort"],
    "equipment": ["home gym", "no equipment", "smith machine", "only dumbbells", "no barbell"],
    "goal_progress": ["trying to", "my goal is", "aiming for", "working towards"],
    "coaching_style": ["too hard", "motivate me", "be strict", "be gentle", "push me harder"],
}


def _auto_extract_memories(user_id: str, message: str) -> None:
    """Auto-detect and store durable personal facts from conversation."""
    msg_lower = message.lower()
    detected_category = None
    for category, signals in _MEMORY_CATEGORY_SIGNALS.items():
        if any(sig in msg_lower for sig in signals):
            detected_category = category
            break

    if detected_category:
        remember(user_id, message[:500], category=detected_category)
        return

    # LLM-based detection for longer messages
    if len(message.split()) > 8:
        llm = get_llm()
        extract_prompt = (
            'Does this fitness app message contain a durable personal fact worth storing for coaching?\n'
            'Examples worth storing: preferences, habits, injuries, schedule, equipment constraints.\n'
            'Examples NOT worth storing: questions, one-off requests, workout logs.\n\n'
            f'Message: "{message[:300]}"\n\n'
            'Reply ONLY with JSON: {"store": true/false, "category": "food_preference|injury|schedule|equipment|goal_progress|general", "fact": "compact fact"}\n'
            'If store is false, set fact to empty string.'
        )
        try:
            resp = llm.invoke([HumanMessage(content=extract_prompt)])
            raw = resp.content.strip().replace("```json", "").replace("```", "").strip()
            extracted = json.loads(raw)
            if extracted.get("store") and extracted.get("fact"):
                remember(user_id, extracted["fact"][:300], category=extracted.get("category", "general"))
        except Exception:
            pass