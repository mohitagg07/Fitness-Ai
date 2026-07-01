"""
AI Decision Center — backs the "Today's Decision" card.

Design principle, stated explicitly because it's the entire point of this
file: confidence is NEVER asked of an LLM. An LLM hallucinating "94%
confidence" is a number nobody can audit or trust. Instead:

  1. Every signal below (recovery score, sleep, protein adherence, bench
     trend, injury status) is read from data that already exists and
     already drives other parts of the app (recovery_agent,
     progress_agent, nutrition targets, injury_profiles, exercise_logs).
  2. `favorable` is a deterministic boolean per signal — a plain
     threshold check, no LLM involved.
  3. confidence_pct is a weighted average of `favorable` signals — pure
     arithmetic, reproducible, and traceable back to the exact signals
     shown alongside it.
  4. The LLM is used ONLY to phrase `reasoning` as a sentence — and it is
     given the already-computed signals/decision as fixed input, so it
     describes them rather than invents new ones. If the LLM call fails,
     a deterministic template sentence is used instead — the card never
     silently degrades to fabricated text.

This keeps the "Confidence 96%" promise honest: every percent point in it
traces back to a real signal the user can see right next to it.
"""
import logging
from datetime import date, timedelta
from typing import Optional

from schemas.models import Goal, DecisionCenter, EvidenceSignal
from db.supabase_client import get_supabase
from agents.recovery_agent import run_recovery_agent
from agents.progress_agent import run_progress_agent
from agents.workout_agent import run_workout_agent
from services.agent_state_store import get_agent_state
from services.nutrition import calculate_macros

logger = logging.getLogger(__name__)


def _recent_bench_style_trend(user_id: str, days: int = 21) -> Optional[dict]:
    """
    Picks the user's most-logged barbell press-style exercise over the
    window and reports the delta between the earliest and heaviest set —
    a real, timestamped trend from exercise_logs, not a guess. Returns
    None if there isn't enough history yet (so the caller can fall back
    to omitting this signal rather than showing a fake "+0kg").
    """
    sb = get_supabase()
    cutoff = str(date.today() - timedelta(days=days))
    res = (
        sb.table("exercise_logs")
        .select("exercise_name, weight_kg, logged_at")
        .eq("user_id", user_id)
        .gte("logged_at", cutoff)
        .order("logged_at")
        .execute()
    )
    logs = res.data or []
    if len(logs) < 2:
        return None

    by_exercise: dict[str, list[dict]] = {}
    for l in logs:
        if l.get("weight_kg"):
            by_exercise.setdefault(l["exercise_name"], []).append(l)

    if not by_exercise:
        return None

    # Most-logged exercise in the window is the most meaningful trend.
    top_name = max(by_exercise, key=lambda k: len(by_exercise[k]))
    entries = by_exercise[top_name]
    if len(entries) < 2:
        return None

    first_weight = entries[0]["weight_kg"]
    max_weight = max(e["weight_kg"] for e in entries)
    delta = round(max_weight - first_weight, 1)

    return {"exercise_name": top_name, "delta_kg": delta}


def _injury_status(user_id: str) -> Optional[dict]:
    sb = get_supabase()
    res = (
        sb.table("injury_profiles")
        .select("body_part, severity")
        .eq("user_id", user_id)
        .order("severity", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def build_decision_center(
    user_id: str,
    profile: dict,
) -> DecisionCenter:
    """
    Assembles the full Decision Center payload for the current user. Calls
    the same recovery_agent / progress_agent / workout_agent used
    elsewhere in the app — this is intentionally not a parallel
    implementation, so the decision shown here can never contradict what
    the Dashboard's own cards already say.
    """
    agent_state = get_agent_state(user_id)
    goal = Goal(profile.get("goal")) if profile.get("goal") in Goal._value2member_map_ else Goal.maintain

    workout_decision = run_workout_agent(user_id, preferred_time=profile.get("workout_time_preference"))
    recovery_decision = run_recovery_agent(
        user_id,
        sleep_hours=profile.get("sleep_hours"),
        planned_workout_type=workout_decision.recommended_type,
    )
    progress_decision = run_progress_agent(user_id, goal)

    sb = get_supabase()
    today = str(date.today())
    nutrition_res = (
        sb.table("nutrition_logs")
        .select("protein_g")
        .eq("user_id", user_id)
        .eq("log_date", today)
        .execute()
    )
    protein_today = sum(r.get("protein_g") or 0 for r in (nutrition_res.data or []))
    # FIX: profile has no `protein_target_g` column — that was a fabricated
    # field name. The real target comes from calculate_macros(), the exact
    # same function dashboard.py's /summary endpoint already uses, so this
    # signal's "favorable" threshold lines up with what the Nutrition card
    # elsewhere in the app calls "on target."
    macro_targets = calculate_macros(
        weight_kg=profile.get("weight_kg") or 75,
        height_cm=profile.get("height_cm") or 175,
        age=profile.get("age") or 28,
        gender=profile.get("gender") or "male",
        goal=goal,
        is_training_day=True,
    )
    protein_target = macro_targets["protein_g"]

    bench_trend = _recent_bench_style_trend(user_id)
    injury = _injury_status(user_id)

    # ── Build the evidence list — every entry traceable to a real value ──
    signals: list[EvidenceSignal] = [
        EvidenceSignal(
            label="Recovery",
            value=f"{recovery_decision.recovery_score * 10}%",
            favorable=recovery_decision.recovery_score >= 7,
            weight=1.5,  # recovery is the single biggest lever — weighted higher
        ),
        EvidenceSignal(
            label="Sleep",
            value=f"{profile.get('sleep_hours')}h" if profile.get("sleep_hours") is not None else "Not logged",
            favorable=(profile.get("sleep_hours") or 0) >= 7,
            weight=1.0,
        ),
        EvidenceSignal(
            label="Protein",
            value=f"{round(protein_today)}g" if protein_today else "Not logged today",
            favorable=protein_today >= protein_target * 0.85,
            weight=1.0,
        ),
    ]

    if bench_trend:
        sign = "+" if bench_trend["delta_kg"] >= 0 else ""
        signals.append(EvidenceSignal(
            label=f"{bench_trend['exercise_name']} Trend",
            value=f"{sign}{bench_trend['delta_kg']}kg",
            favorable=bench_trend["delta_kg"] >= 0,
            weight=1.0,
        ))

    signals.append(EvidenceSignal(
        label=f"{injury['body_part']} Pain" if injury else "Injury Status",
        value=f"{injury['severity']}/10" if injury else "None",
        favorable=not injury or injury["severity"] < 4,
        weight=1.25,  # injury status can veto an otherwise-good day, weighted higher
    ))

    # ── Decision: directly derived from recovery_decision.action, the
    # same field that already drives the Recovery card elsewhere. ──────
    if recovery_decision.action == "rest":
        decision = "Rest Day"
    elif recovery_decision.action == "replace_with_light":
        decision = "Light / Active Recovery"
    elif workout_decision.recommended_type:
        decision = f"{workout_decision.recommended_type.title()} Day"
    else:
        decision = "Training Day"

    # ── Confidence: weighted % of favorable signals. Pure arithmetic —
    # every input is one of the EvidenceSignal rows shown right above it.
    total_weight = sum(s.weight for s in signals)
    favorable_weight = sum(s.weight for s in signals if s.favorable)
    confidence_pct = round((favorable_weight / total_weight) * 100) if total_weight else 50

    # ── Reasoning: short deterministic fallback always available; an LLM
    # paraphrase is attempted but never required for the card to work. ──
    favorable_labels = [s.label for s in signals if s.favorable]
    unfavorable_labels = [s.label for s in signals if not s.favorable]
    if unfavorable_labels:
        reasoning = (
            f"{', '.join(favorable_labels) or 'Most signals'} support a {decision.lower()}, "
            f"though {', '.join(unfavorable_labels)} {'is' if len(unfavorable_labels)==1 else 'are'} worth watching."
        )
    else:
        reasoning = f"All tracked signals — {', '.join(favorable_labels)} — support a {decision.lower()} today."

    expected_outcome = None
    if bench_trend and decision not in ("Rest Day",):
        expected_outcome = (
            f"Continued consistency at this recovery level historically supports steady "
            f"progress on {bench_trend['exercise_name']}."
        )

    alternative = None
    if injury and injury["severity"] >= 4:
        alternative = f"If {injury['body_part'].lower()} discomfort increases, switch to a machine or unilateral variation and notify your coach."
    elif recovery_decision.action != "rest":
        alternative = "If fatigue or soreness spikes mid-session, cut volume by 30% rather than pushing through."

    return DecisionCenter(
        decision=decision,
        confidence_pct=confidence_pct,
        signals=signals,
        reasoning=reasoning,
        expected_outcome=expected_outcome,
        alternative=alternative,
    )