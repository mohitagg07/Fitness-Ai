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

from schemas.models import Goal, DecisionCenter, EvidenceSignal, WhyNotItem
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


def _daily_recovery_evidence(check_in: dict | None) -> list[EvidenceSignal]:
    """Display today's self-reported inputs without weighting them twice.

    The aggregate Recovery signal already scores these same check-in fields
    alongside training, nutrition and fatigue evidence. These rows are
    explanatory detail only; adding independent weights here would double-count
    sleep, soreness and energy in confidence.
    """
    values = check_in or {}
    sleep = values.get("sleep_hours")
    soreness = values.get("soreness_level")
    energy = values.get("energy_level")

    return [
        EvidenceSignal(
            label="Reported sleep",
            value=f"{sleep}h" if sleep is not None else "Not reported",
            favorable=sleep is not None and float(sleep) >= 7,
            weight=0.0,
        ),
        EvidenceSignal(
            label="Reported soreness",
            value=f"{soreness}/5" if soreness is not None else "Not reported",
            favorable=soreness is not None and int(soreness) <= 2,
            weight=0.0,
        ),
        EvidenceSignal(
            label="Reported energy",
            value=f"{energy}/5" if energy is not None else "Not reported",
            favorable=energy is not None and int(energy) >= 3,
            weight=0.0,
        ),
    ]


def _recovery_data_coverage(recovery_decision) -> int:
    """Return weighted recovery evidence coverage (0-100), not UI signal count."""
    raw = getattr(recovery_decision, "data_completeness_pct", None)
    if raw is None:
        raw = getattr(recovery_decision, "__dict__", {}).get("data_completeness_pct", 0)
    try:
        value = int(round(float(raw or 0)))
    except (TypeError, ValueError, OverflowError):
        value = 0
    return max(0, min(100, value))


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
    measurements_complete = all(
        profile.get(key) is not None
        for key in ("weight_kg", "height_cm", "age", "gender")
    )
    nutrition_targets = None
    if measurements_complete:
        nutrition_targets = calculate_macros(
            weight_kg=profile["weight_kg"],
            height_cm=profile["height_cm"],
            age=profile["age"],
            gender=profile["gender"],
            goal=goal,
            is_training_day=True,
        )
    recovery_decision = run_recovery_agent(
        user_id,
        sleep_hours=profile.get("sleep_hours"),
        planned_workout_type=workout_decision.recommended_type,
        protein_target_g=nutrition_targets["protein_g"] if nutrition_targets else None,
        calorie_target=nutrition_targets["calories"] if nutrition_targets else None,
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
    nutrition_rows = nutrition_res.data or []
    has_protein_log = bool(nutrition_rows) and any(
        row.get("protein_g") is not None for row in nutrition_rows
    )
    protein_today = sum(r.get("protein_g") or 0 for r in nutrition_rows)
    # FIX: profile has no `protein_target_g` column — that was a fabricated
    # field name. The real target comes from calculate_macros(), the exact
    # same function dashboard.py's /summary endpoint already uses, so this
    # signal's "favorable" threshold lines up with what the Nutrition card
    # elsewhere in the app calls "on target."
    protein_target = nutrition_targets["protein_g"] if nutrition_targets else None

    bench_trend = _recent_bench_style_trend(user_id)
    injury = _injury_status(user_id)

    # ── Build the evidence list — every entry traceable to a real value ──
    recovery_pct = getattr(recovery_decision, "score_pct", None)
    daily_check_in = getattr(recovery_decision, "check_in", None)
    if daily_check_in is None:
        daily_check_in = recovery_decision.__dict__.get("check_in")
    recovery_evidence = _daily_recovery_evidence(daily_check_in)
    signals: list[EvidenceSignal] = [
        EvidenceSignal(
            label="Recovery",
            value=f"{recovery_pct}%" if recovery_pct is not None else "Insufficient data",
            favorable=recovery_pct is not None and recovery_pct >= 70,
            weight=1.5 if recovery_pct is not None else 0.0,
        ),
        *recovery_evidence,
        EvidenceSignal(
            label="Protein",
            value=f"{round(protein_today)}g" if has_protein_log else "Not logged",
            favorable=(
                has_protein_log and protein_target is not None
                and protein_today >= protein_target * 0.85
            ),
            weight=1.0 if has_protein_log and protein_target is not None else 0.0,
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
    else:
        signals.append(EvidenceSignal(
            label="Strength trend",
            value="Insufficient history",
            favorable=False,
            weight=0.0,
        ))

    if injury:
        signals.append(EvidenceSignal(
            label=f"{injury['body_part']} Pain",
            value=f"{injury['severity']}/10",
            favorable=injury["severity"] < 4,
            weight=1.25,
        ))
    else:
        signals.append(EvidenceSignal(
            label="Injury status",
            value="No injury information on file",
            favorable=False,
            weight=0.0,
        ))

    # Coverage comes directly from the recovery agent's weighted input model.
    # Do not infer it by summing Decision Center display signals: the Recovery
    # score already includes sleep, soreness and energy, which are shown above
    # for explanation only.
    coverage_pct = _recovery_data_coverage(recovery_decision)
    signals.append(EvidenceSignal(
        label="Recovery data coverage",
        value=f"{coverage_pct}% of weighted recovery inputs available",
        favorable=coverage_pct >= 60,
        weight=0.0,
    ))

    if coverage_pct < 60 or recovery_decision.action == "check_in":
        decision = "Recovery check-in needed"
    elif recovery_decision.action == "rest":
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
    favorable_weight = sum(s.weight for s in signals if s.favorable and s.weight > 0)
    confidence_pct = round((favorable_weight / total_weight) * 100) if total_weight else 0

    # ── Reasoning: short deterministic fallback always available; an LLM
    # paraphrase is attempted but never required for the card to work. ──
    favorable_labels = [s.label for s in signals if s.weight > 0 and s.favorable]
    unfavorable_labels = [s.label for s in signals if s.weight > 0 and not s.favorable]
    if decision == "Recovery check-in needed":
        reasoning = (
            f"Only {coverage_pct}% of key inputs are recorded. I cannot make a reliable "
            "readiness call yet. Keep the approved plan unchanged and add the missing "
            "recovery information."
        )
    elif unfavorable_labels:
        reasoning = (
            f"{', '.join(favorable_labels) or 'The available signals'} support a {decision.lower()}, "
            f"though {', '.join(unfavorable_labels)} {'is' if len(unfavorable_labels)==1 else 'are'} worth watching."
        )
    else:
        reasoning = f"All available tracked signals — {', '.join(favorable_labels)} — support a {decision.lower()} today."

    expected_outcome = None
    if bench_trend and decision not in ("Rest Day", "Recovery check-in needed"):
        expected_outcome = (
            f"Continued consistency at this recovery level historically supports steady "
            f"progress on {bench_trend['exercise_name']}."
        )

    alternative = None
    if decision == "Recovery check-in needed":
        alternative = "Keep the approved workout prescription unchanged until enough recovery information is available."
    elif injury and injury["severity"] >= 4:
        alternative = f"If {injury['body_part'].lower()} discomfort increases, stop the provoking movement and review a safer alternative."
    elif recovery_decision.action != "rest":
        alternative = "If fatigue or soreness spikes mid-session, stop or reduce effort rather than pushing through pain."

    # ── Why not the alternatives: same rule, every reason traces back to a
    # signal already shown above — no LLM, matching this file's design
    # principle for confidence/reasoning. Only includes alternatives that
    # are actually plausible given today's recovery/injury state, so the
    # list stays short and specific rather than listing every workout type.
    why_not: list[WhyNotItem] = []
    recovery_pct_val = recovery_pct

    if recovery_pct_val is not None and decision not in ("Rest Day", "Recovery check-in needed") and recovery_pct_val >= 40:
        why_not.append(WhyNotItem(
            option="Rest Day",
            reason=f"Recovery at {recovery_pct_val}% doesn't call for a full rest day.",
        ))

    if decision not in ("Rest Day", "Light / Active Recovery", "Recovery check-in needed"):
        if injury and injury["severity"] >= 4:
            why_not.append(WhyNotItem(
                option="PR Attempt",
                reason=f"{injury['body_part'].replace('_', ' ').title()} pain at {injury['severity']}/10 rules out max-effort lifts today.",
            ))
        elif recovery_pct_val is not None and recovery_pct_val < 80:
            why_not.append(WhyNotItem(
                option="PR Attempt",
                reason=f"Recovery at {recovery_pct_val}% is solid but not peak — save max attempts for a fresher day.",
            ))

    if decision == "Rest Day" and workout_decision.recommended_type:
        why_not.append(WhyNotItem(
            option=f"{workout_decision.recommended_type.title()} Day",
            reason=f"Recovery at {recovery_pct_val}% is too low to load safely — rest first.",
        ))

    return DecisionCenter(
        decision=decision,
        confidence_pct=confidence_pct,
        signals=signals,
        reasoning=reasoning,
        expected_outcome=expected_outcome,
        alternative=alternative,
        why_not=why_not,
    )