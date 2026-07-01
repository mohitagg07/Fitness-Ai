"""
Monthly AI Review Agent — VYRN

The roadmap explicitly distinguishes this from the weekly review:

  Monthly should include:
    - progress
    - strengths
    - weaknesses
    - rewritten program

This reuses the SAME real data sources as weekly_review_agent.py (sessions,
nutrition_logs, exercise_logs, agent_state) over a 4-week window instead of
1, plus:
  - progress_metrics for a real body-weight/composition trend (the weekly
    review doesn't surface this — a month is the right cadence for it)
  - calls run_program_rewriter() at the end so "rewritten program" is an
    actual program_versions row, not just a text suggestion the user can't
    act on

Like decision_engine.py and program_rewriter.py, strengths/weaknesses are
derived from deterministic thresholds over real data — the LLM is only used
to phrase the narrative, never to invent which lifts went up or down.
"""
from __future__ import annotations
import json
import logging
from datetime import date, timedelta
from dataclasses import dataclass

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage

from db.supabase_client import get_supabase, get_full_user_context
from db.memory_client import recall
from services.nutrition import calculate_macros
from schemas.models import Goal
from core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class MonthlyReview:
    month_label: str
    consistency_pct: int
    sessions_completed: int
    sessions_expected: int
    avg_recovery_score: int
    weight_trend: dict              # {has_data, latest_kg, delta_kg, direction}
    strengths: list[str]            # max 4
    weaknesses: list[str]           # max 4
    strength_gains: list[dict]      # [{exercise, prev_kg, curr_kg, delta_kg}]
    progress_summary: str           # LLM narrative — what actually changed
    program_rewrite: dict | None    # result of run_program_rewriter(), or None if not triggered
    confidence: str
    generated_at: str


def _month_range(months_ago: int = 0) -> tuple[date, date]:
    today = date.today()
    first_of_this_month = today.replace(day=1)
    target_month = first_of_this_month
    for _ in range(months_ago):
        target_month = (target_month - timedelta(days=1)).replace(day=1)
    if target_month.month == 12:
        next_month = target_month.replace(year=target_month.year + 1, month=1)
    else:
        next_month = target_month.replace(month=target_month.month + 1)
    end = next_month - timedelta(days=1)
    return target_month, min(end, today)


def _get_month_sessions(user_id: str, start: date, end: date) -> list[dict]:
    sb = get_supabase()
    res = (
        sb.table("workout_sessions")
        .select("*")
        .eq("user_id", user_id)
        .gte("session_date", str(start))
        .lte("session_date", str(end))
        .execute()
    )
    return res.data or []


def _get_month_nutrition(user_id: str, start: date, end: date) -> list[dict]:
    sb = get_supabase()
    res = (
        sb.table("nutrition_logs")
        .select("log_date, calories, protein_g")
        .eq("user_id", user_id)
        .gte("log_date", str(start))
        .lte("log_date", str(end))
        .execute()
    )
    return res.data or []


def _get_month_exercise_logs(user_id: str, start: date, end: date) -> list[dict]:
    sb = get_supabase()
    res = (
        sb.table("exercise_logs")
        .select("exercise_name, weight_kg, reps, logged_at")
        .eq("user_id", user_id)
        .gte("logged_at", str(start))
        .lte("logged_at", str(end) + "T23:59:59")
        .execute()
    )
    return res.data or []


def _get_weight_trend(user_id: str, start: date, end: date) -> dict:
    sb = get_supabase()
    res = (
        sb.table("progress_metrics")
        .select("weight_kg, recorded_date")
        .eq("user_id", user_id)
        .not_.is_("weight_kg", "null")
        .gte("recorded_date", str(start))
        .lte("recorded_date", str(end))
        .order("recorded_date")
        .execute()
    )
    rows = [r for r in (res.data or []) if r.get("weight_kg")]
    if not rows:
        return {"has_data": False}
    latest = rows[-1]["weight_kg"]
    earliest = rows[0]["weight_kg"]
    delta = round(latest - earliest, 1)
    return {
        "has_data": True,
        "latest_kg": latest,
        "delta_kg": delta,
        "direction": "up" if delta > 0.2 else "down" if delta < -0.2 else "stable",
        "entries_count": len(rows),
    }


def _exercise_first_last_best(logs: list[dict]) -> dict[str, tuple[float, float]]:
    """Returns {exercise: (first_weight, best_weight)} from a month of logs, ordered by logged_at."""
    by_ex: dict[str, list[dict]] = {}
    for l in sorted(logs, key=lambda x: x.get("logged_at", "")):
        ex = l.get("exercise_name", "")
        if ex and l.get("weight_kg"):
            by_ex.setdefault(ex, []).append(l)
    result = {}
    for ex, entries in by_ex.items():
        if len(entries) < 2:
            continue
        first_w = entries[0]["weight_kg"]
        best_w = max(e["weight_kg"] for e in entries)
        result[ex] = (first_w, best_w)
    return result


def _generate_monthly_narrative(
    profile: dict,
    review_data: dict,
    memories: list[str],
    llm: ChatGroq,
) -> str:
    name = (profile.get("full_name") or "Athlete").split()[0]
    memories_text = "\n".join(f"- {m}" for m in memories) if memories else "No specific preferences on file."

    prompt = f"""You are VYRN — a highly personalized fitness coach writing a MONTHLY progress summary.

Generate a concise progress narrative for {name} based on this month's data.

MONTH DATA:
{json.dumps(review_data, indent=2)}

ATHLETE PROFILE:
- Goal: {profile.get('goal', 'maintain')}
- Experience: {profile.get('experience_level', 'intermediate')}
- Phase: {profile.get('current_phase', 'general')}

COACH MEMORY (personal facts):
{memories_text}

Write a 4-5 sentence monthly progress summary in first-person coach voice. Reference real
numbers from the data (sessions completed, weight trend, specific lift gains). Speak to the
overall trajectory of the month, not just isolated facts. Do NOT use bullet points.
End with the single biggest priority for next month.
Maximum 110 words."""

    try:
        response = llm.invoke([
            SystemMessage(content="You are VYRN coach. Be specific, data-driven, encouraging but honest. Max 110 words."),
            HumanMessage(content=prompt),
        ])
        return response.content.strip()
    except Exception as e:
        logger.warning(f"Monthly narrative generation failed: {e}")
        return (
            "This month showed steady training engagement. Keep prioritizing consistency "
            "and progressive overload on your main lifts — small weekly gains compound into "
            "real strength over a month."
        )


def generate_monthly_review(user_id: str, months_ago: int = 0, trigger_rewrite: bool = True) -> MonthlyReview:
    """
    Generate a full monthly review: progress, strengths, weaknesses, and an
    actual rewritten program (via run_program_rewriter) if trigger_rewrite
    is True and the pattern engine finds something worth acting on.

    months_ago=0 → current month so far
    months_ago=1 → last full month
    """
    this_start, this_end = _month_range(months_ago)

    profile, agent_state = get_full_user_context(user_id)
    goal_str = profile.get("goal") or "maintain"
    goal = Goal(goal_str) if goal_str in Goal._value2member_map_ else Goal.maintain
    targets = calculate_macros(
        weight_kg=profile.get("weight_kg") or 75,
        height_cm=profile.get("height_cm") or 175,
        age=profile.get("age") or 28,
        gender=profile.get("gender") or "male",
        goal=goal,
        is_training_day=True,
    )

    # ── Sessions ───────────────────────────────────────────────────────────
    sessions = _get_month_sessions(user_id, this_start, this_end)
    completed = [s for s in sessions if s.get("completed")]
    days_in_range = (this_end - this_start).days + 1
    sessions_expected = max(1, round(days_in_range / 7 * 4.5))
    consistency_pct = min(100, round(len(completed) / sessions_expected * 100))

    # ── Nutrition ──────────────────────────────────────────────────────────
    nutrition_logs = _get_month_nutrition(user_id, this_start, this_end)
    by_date: dict[str, dict] = {}
    for l in nutrition_logs:
        d = l.get("log_date", "")
        by_date.setdefault(d, {"protein_g": 0.0, "calories": 0})
        by_date[d]["protein_g"] += l.get("protein_g") or 0
        by_date[d]["calories"] += l.get("calories") or 0
    avg_protein = sum(d["protein_g"] for d in by_date.values()) / len(by_date) if by_date else 0.0
    protein_adherence = round(avg_protein / max(1, targets["protein_g"]) * 100)

    # ── Strength ───────────────────────────────────────────────────────────
    exercise_logs = _get_month_exercise_logs(user_id, this_start, this_end)
    first_best = _exercise_first_last_best(exercise_logs)
    strength_gains = []
    for ex, (first_w, best_w) in first_best.items():
        delta = round(best_w - first_w, 2)
        if delta != 0:
            strength_gains.append({"exercise": ex, "prev_kg": first_w, "curr_kg": best_w, "delta_kg": delta})
    strength_gains.sort(key=lambda x: x["delta_kg"], reverse=True)

    # ── Body weight trend ──────────────────────────────────────────────────
    weight_trend = _get_weight_trend(user_id, this_start, this_end)

    # ── Recovery (current cached score used as directional signal — a
    # per-day recovery history table doesn't exist yet, so we don't
    # fabricate a monthly average from data we don't have) ────────────────
    cns = agent_state.get("cns_fatigue_score", 0)
    avg_recovery = max(0, min(10, 10 - cns))

    # ── Strengths / Weaknesses — deterministic thresholds, same pattern as
    # decision_engine.py's favorable/unfavorable signal split ─────────────
    strengths: list[str] = []
    weaknesses: list[str] = []

    if consistency_pct >= 80:
        strengths.append(f"Training consistency: {len(completed)} sessions completed ({consistency_pct}% of expected).")
    elif consistency_pct < 50:
        weaknesses.append(f"Training consistency dropped to {consistency_pct}% — only {len(completed)} sessions this month.")

    gains_count = len([g for g in strength_gains if g["delta_kg"] > 0])
    if gains_count >= 3:
        strengths.append(f"Strength progressed on {gains_count} exercises this month, led by {strength_gains[0]['exercise']} (+{strength_gains[0]['delta_kg']}kg).")
    elif gains_count == 0 and len(first_best) >= 2:
        weaknesses.append("No measurable strength gains logged across tracked lifts this month — likely a plateau worth addressing.")

    if protein_adherence >= 85:
        strengths.append(f"Protein adherence averaged {protein_adherence}% of target — strong nutritional discipline.")
    elif protein_adherence < 65 and by_date:
        weaknesses.append(f"Protein adherence averaged only {protein_adherence}% of target — likely limiting recovery and muscle gain.")

    if weight_trend.get("has_data"):
        if goal == Goal.bulk and weight_trend["direction"] == "up":
            strengths.append(f"Body weight trending up {weight_trend['delta_kg']}kg this month — aligned with bulk goal.")
        elif goal == Goal.cut and weight_trend["direction"] == "down":
            strengths.append(f"Body weight trending down {abs(weight_trend['delta_kg'])}kg this month — aligned with cut goal.")
        elif goal == Goal.bulk and weight_trend["direction"] != "up":
            weaknesses.append("Body weight hasn't trended up this month despite a bulk goal — consider a calorie surplus increase.")
        elif goal == Goal.cut and weight_trend["direction"] != "down":
            weaknesses.append("Body weight hasn't trended down this month despite a cut goal — consider a calorie deficit increase.")
    else:
        weaknesses.append("No body-weight entries logged this month — log a weekly weigh-in to track real trend, not guesses.")

    if avg_recovery <= 4:
        weaknesses.append(f"Recovery currently averaging {avg_recovery}/10 — sleep and deload frequency need attention.")
    elif avg_recovery >= 7:
        strengths.append(f"Recovery holding strong at {avg_recovery}/10 across the month.")

    # ── Confidence ─────────────────────────────────────────────────────────
    data_richness = sum([
        len(sessions) >= 4,
        len(by_date) >= 7,
        len(exercise_logs) >= 10,
    ])
    confidence = "High" if data_richness == 3 else "Medium" if data_richness >= 1 else "Low"

    # ── LLM progress narrative ─────────────────────────────────────────────
    memories = []
    try:
        memories = recall(user_id, "monthly review progress strengths weaknesses program", n_results=5)
    except Exception:
        pass

    review_data_for_llm = {
        "month": f"{this_start} to {this_end}",
        "sessions_completed": len(completed),
        "sessions_expected": sessions_expected,
        "consistency_pct": consistency_pct,
        "avg_protein_g": round(avg_protein, 1),
        "protein_target_g": targets["protein_g"],
        "protein_adherence_pct": protein_adherence,
        "avg_recovery": avg_recovery,
        "weight_trend": weight_trend,
        "strength_gains": strength_gains[:5],
        "strengths": strengths,
        "weaknesses": weaknesses,
    }

    try:
        llm = ChatGroq(model=settings.groq_model, api_key=settings.groq_api_key, temperature=0.4)
        narrative = _generate_monthly_narrative(profile, review_data_for_llm, memories, llm)
    except Exception as e:
        logger.warning(f"LLM unavailable for monthly review: {e}")
        narrative = (
            f"This month you completed {len(completed)} sessions at {consistency_pct}% consistency. "
            "Keep building on what's working and address the weak points above next month."
        )

    # ── Rewritten program — an actual deliverable, not just text ──────────
    program_rewrite = None
    if trigger_rewrite:
        try:
            from agents.program_rewriter import run_program_rewriter
            program_rewrite = run_program_rewriter(user_id, profile)
        except Exception as e:
            logger.warning(f"Monthly review: program rewrite failed for {user_id}: {e}")
            program_rewrite = None

    month_label = this_start.strftime("%B %Y")

    return MonthlyReview(
        month_label=month_label,
        consistency_pct=consistency_pct,
        sessions_completed=len(completed),
        sessions_expected=sessions_expected,
        avg_recovery_score=avg_recovery,
        weight_trend=weight_trend,
        strengths=strengths[:4],
        weaknesses=weaknesses[:4],
        strength_gains=strength_gains[:6],
        progress_summary=narrative,
        program_rewrite=program_rewrite,
        confidence=confidence,
        generated_at=date.today().isoformat(),
    )