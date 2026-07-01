"""
Pattern Detection Engine — VYRN

Runs nightly (or on-demand) to detect:
  - Strength plateaus (no new PR in N weeks for a given exercise)
  - Missed workout patterns (consistently skipping certain days)
  - Recovery decline trend (score dropping for 5+ consecutive days)
  - Under-eating patterns (protein/calories below target for 3+ days)
  - PR opportunities (recovery high + strength trending up)

Returns a list of PatternInsight objects the dashboard/mission uses for
proactive alerts and the Weekly AI Review uses for narrative generation.
"""
from __future__ import annotations
from datetime import date, timedelta
from dataclasses import dataclass, field
from typing import Literal
from db.supabase_client import get_supabase
from services.agent_state_store import get_agent_state


@dataclass
class PatternInsight:
    category: Literal[
        "plateau", "missed_workout", "recovery_decline",
        "under_eating", "pr_opportunity", "protein_deficit",
        "great_streak", "volume_increase"
    ]
    severity: Literal["info", "warning", "critical"]
    title: str
    detail: str
    recommendation: str
    confidence: Literal["Low", "Medium", "High"]
    data: dict = field(default_factory=dict)


def _get_recent_sessions(user_id: str, days: int) -> list[dict]:
    sb = get_supabase()
    cutoff = str(date.today() - timedelta(days=days))
    res = (
        sb.table("workout_sessions")
        .select("session_date, completed, workout_type, day_label, total_volume_kg")
        .eq("user_id", user_id)
        .gte("session_date", cutoff)
        .order("session_date")
        .execute()
    )
    return res.data or []


def _get_exercise_bests(user_id: str, exercise: str, weeks: int) -> list[dict]:
    """Get the max weight logged per week for a given exercise."""
    sb = get_supabase()
    cutoff = str(date.today() - timedelta(weeks=weeks))
    res = (
        sb.table("exercise_logs")
        .select("weight_kg, reps, logged_at")
        .eq("user_id", user_id)
        .ilike("exercise_name", f"%{exercise}%")
        .gte("logged_at", cutoff)
        .order("logged_at")
        .execute()
    )
    return res.data or []


def _get_nutrition_recent(user_id: str, days: int) -> list[dict]:
    sb = get_supabase()
    cutoff = str(date.today() - timedelta(days=days))
    res = (
        sb.table("nutrition_logs")
        .select("log_date, calories, protein_g")
        .eq("user_id", user_id)
        .gte("log_date", cutoff)
        .order("log_date")
        .execute()
    )
    return res.data or []


def _get_prs(user_id: str) -> dict:
    """Returns dict of exercise -> {weight_kg, reps, set_at}"""
    sb = get_supabase()
    res = (
        sb.table("personal_records")
        .select("exercise_name, weight_kg, reps, set_at")
        .eq("user_id", user_id)
        .execute()
    )
    return {r["exercise_name"]: r for r in (res.data or [])}


def detect_strength_plateaus(user_id: str, weeks: int = 4) -> list[PatternInsight]:
    """Detect if a key lift hasn't improved in N weeks."""
    insights = []
    prs = _get_prs(user_id)

    for exercise, pr_data in prs.items():
        set_at_str = pr_data.get("set_at", "")
        if not set_at_str:
            continue
        try:
            set_at = date.fromisoformat(set_at_str[:10])
        except Exception:
            continue

        days_since_pr = (date.today() - set_at).days
        if days_since_pr >= weeks * 7:
            logs = _get_exercise_bests(user_id, exercise, weeks=weeks)
            if len(logs) >= 3:
                recent_weights = [l.get("weight_kg", 0) for l in logs[-3:]]
                variation = max(recent_weights) - min(recent_weights)
                if variation < 2.5:
                    insights.append(PatternInsight(
                        category="plateau",
                        severity="warning",
                        title=f"{exercise} plateau detected",
                        detail=f"No new PR in {days_since_pr} days. Last {weeks} weeks: weight variation < 2.5kg.",
                        recommendation=f"Try a deload week, then increase intensity by 5% or change rep scheme (e.g. 5×5 → 4×6).",
                        confidence="High" if days_since_pr > 21 else "Medium",
                        data={"exercise": exercise, "days_since_pr": days_since_pr, "recent_weights": recent_weights}
                    ))
    return insights


def detect_missed_workout_patterns(user_id: str) -> list[PatternInsight]:
    """Detect if certain days are consistently skipped."""
    sessions = _get_recent_sessions(user_id, days=28)
    insights = []

    if len(sessions) < 4:
        return insights

    # Count missed (not completed) vs completed by day of week
    day_stats: dict[str, dict] = {}
    for s in sessions:
        try:
            d = date.fromisoformat(s["session_date"])
            day_name = d.strftime("%A")
        except Exception:
            continue
        if day_name not in day_stats:
            day_stats[day_name] = {"completed": 0, "missed": 0}
        if s.get("completed"):
            day_stats[day_name]["completed"] += 1
        else:
            day_stats[day_name]["missed"] += 1

    for day, stats in day_stats.items():
        total = stats["completed"] + stats["missed"]
        if total >= 2 and stats["missed"] >= 2 and stats["missed"] > stats["completed"]:
            insights.append(PatternInsight(
                category="missed_workout",
                severity="info",
                title=f"Consistently skipping {day}s",
                detail=f"Missed {stats['missed']} of {total} planned {day} sessions in the last 4 weeks.",
                recommendation=f"Consider moving your {day} workout to a different day that fits your schedule better.",
                confidence="Medium",
                data={"day": day, "missed": stats["missed"], "completed": stats["completed"]}
            ))
    return insights


def detect_recovery_decline(user_id: str) -> list[PatternInsight]:
    """Detect if CNS fatigue has been high for 5+ consecutive days."""
    agent_state = get_agent_state(user_id)
    cns = agent_state.get("cns_fatigue_score", 0)
    high_rpe_days = agent_state.get("consecutive_high_rpe_days", 0)

    insights = []
    if cns >= 7 and high_rpe_days >= 4:
        insights.append(PatternInsight(
            category="recovery_decline",
            severity="critical",
            title="Recovery declining for multiple days",
            detail=f"CNS fatigue at {cns}/10. High RPE sessions for {high_rpe_days} consecutive days.",
            recommendation="Take 1-2 full rest days. Increase sleep to 8h. Consider a deload week if this continues.",
            confidence="High",
            data={"cns_fatigue": cns, "high_rpe_days": high_rpe_days}
        ))
    elif cns >= 5 and high_rpe_days >= 3:
        insights.append(PatternInsight(
            category="recovery_decline",
            severity="warning",
            title="Recovery needs attention",
            detail=f"CNS fatigue at {cns}/10 with {high_rpe_days} high-intensity days in a row.",
            recommendation="Reduce tomorrow's volume by 30% and prioritize 7-8h sleep tonight.",
            confidence="Medium",
            data={"cns_fatigue": cns, "high_rpe_days": high_rpe_days}
        ))
    return insights


def detect_nutrition_patterns(user_id: str, protein_target_g: float) -> list[PatternInsight]:
    """Detect under-eating patterns over the last 7 days."""
    logs = _get_nutrition_recent(user_id, days=7)
    insights = []

    if len(logs) < 3:
        return insights

    # Group by date and sum
    by_date: dict[str, dict] = {}
    for l in logs:
        d = l.get("log_date", "")
        if d not in by_date:
            by_date[d] = {"protein_g": 0.0, "calories": 0}
        by_date[d]["protein_g"] += l.get("protein_g") or 0
        by_date[d]["calories"] += l.get("calories") or 0

    if len(by_date) < 3:
        return insights

    days_below_protein = sum(
        1 for d in by_date.values()
        if d["protein_g"] < protein_target_g * 0.8
    )
    avg_protein = sum(d["protein_g"] for d in by_date.values()) / len(by_date)
    deficit_g = protein_target_g - avg_protein

    if days_below_protein >= 4:
        insights.append(PatternInsight(
            category="protein_deficit",
            severity="warning",
            title="Protein below target most days",
            detail=f"Averaged {avg_protein:.0f}g protein — {deficit_g:.0f}g below target for {days_below_protein} of last {len(by_date)} days.",
            recommendation=f"Add one high-protein snack daily (e.g. Greek yogurt + whey = ~40g). This alone will close most of the gap.",
            confidence="High",
            data={"avg_protein": avg_protein, "target": protein_target_g, "days_below": days_below_protein}
        ))
    return insights


def detect_pr_opportunity(user_id: str) -> list[PatternInsight]:
    """Flag if recovery is high + recent trend is upward = good PR attempt day."""
    agent_state = get_agent_state(user_id)
    cns = agent_state.get("cns_fatigue_score", 0)
    streak = agent_state.get("workout_streak", 0)

    insights = []
    if cns <= 2 and streak >= 3:
        prs = _get_prs(user_id)
        if prs:
            top_exercises = list(prs.keys())[:2]
            ex_list = " and ".join(top_exercises)
            insights.append(PatternInsight(
                category="pr_opportunity",
                severity="info",
                title="PR opportunity today",
                detail=f"CNS fatigue is very low ({cns}/10) and you're on a {streak}-day streak.",
                recommendation=f"This is an ideal day to attempt a new max on {ex_list}. Go for it.",
                confidence="Medium",
                data={"cns_fatigue": cns, "streak": streak}
            ))
    return insights


def run_pattern_engine(user_id: str, protein_target_g: float = 160.0) -> list[PatternInsight]:
    """
    Run all detectors and return a consolidated, de-duplicated list of insights.
    Sorted by severity: critical first, then warning, then info.
    """
    all_insights: list[PatternInsight] = []

    try:
        all_insights += detect_strength_plateaus(user_id)
    except Exception:
        pass
    try:
        all_insights += detect_missed_workout_patterns(user_id)
    except Exception:
        pass
    try:
        all_insights += detect_recovery_decline(user_id)
    except Exception:
        pass
    try:
        all_insights += detect_nutrition_patterns(user_id, protein_target_g)
    except Exception:
        pass
    try:
        all_insights += detect_pr_opportunity(user_id)
    except Exception:
        pass

    severity_order = {"critical": 0, "warning": 1, "info": 2}
    all_insights.sort(key=lambda i: severity_order.get(i.severity, 3))
    return all_insights
