"""
Consistency Agent — VYRN

Answers one question, on purpose: "Have I actually been consistent lately?"

This intentionally does NOT try to be another chart. It collapses workout
adherence, nutrition adherence, and recovery/fatigue trend into a single
0-100 score plus one human sentence, e.g.:

    "You've been consistent this week."
    "Your recovery and nutrition have slipped, which is probably why
     progress has stalled."

Design principles (from real user feedback on why people quit trackers):
  1. One score, not five charts. The breakdown is still available for
     anyone who wants to dig in, but the headline is a single number and
     a single sentence.
  2. Missing a day is not a failure. A 7-day rolling window with a
     realistic (not perfect) target means one missed session or one
     unlogged meal barely moves the needle. Language never uses words
     like "failed", "broken streak", or "reset to zero".
  3. New/returning users are never shown a harsh score. Fewer than
     MIN_DAYS_FOR_SCORE days of history returns an encouraging "building
     your baseline" state instead of judging an empty history as 0%.
  4. The score explains itself. When it's low, the message names which
     pillar(s) slipped instead of just reporting a number — mirroring
     "your recovery and nutrition have slipped" rather than "62%".
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from db.supabase_client import get_supabase
from services.agent_state_store import get_agent_state

WINDOW_DAYS = 7
MIN_DAYS_FOR_SCORE = 3           # need at least this many days of any activity to score at all
GRACE_MISSED_DAYS = 2            # missing this many days (or fewer) never reads as "slipping"

# Weighted pillars — workout adherence matters most, then nutrition, then recovery.
WEIGHTS = {"workout": 0.40, "nutrition": 0.35, "recovery": 0.25}


@dataclass
class PillarScore:
    label: str
    pct: int                      # 0-100
    status: str                   # "favorable" | "slipping" | "no_data"
    detail: str


@dataclass
class ConsistencyResult:
    status: str                   # "new" | "scored"
    score: int                    # 0-100, meaningless when status == "new"
    trend: str                    # "up" | "steady" | "down" | "unknown"
    headline: str                 # the one sentence the UI leads with
    pillars: list[PillarScore] = field(default_factory=list)
    mood_summary: str | None = None


def _window(days: int) -> str:
    return str(date.today() - timedelta(days=days))


def _workout_pillar(user_id: str) -> tuple[PillarScore, int]:
    """Returns the pillar plus a raw count of sessions logged (any, complete or not)."""
    sb = get_supabase()
    res = (
        sb.table("workout_sessions")
        .select("session_date, completed")
        .eq("user_id", user_id)
        .gte("session_date", _window(WINDOW_DAYS))
        .execute()
    )
    sessions = res.data or []
    completed = [s for s in sessions if s.get("completed")]

    # Expected sessions this week — read from the active plan if present,
    # otherwise fall back to a reasonable default rather than demanding
    # perfection against an unknown target.
    plan_res = (
        sb.table("workout_plans")
        .select("schedule")
        .eq("user_id", user_id)
        .eq("is_active", True)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    expected = 4
    if plan_res.data:
        schedule = plan_res.data[0].get("schedule") or {}
        non_rest = [v for v in schedule.values() if v and str(v).lower() != "rest"]
        if non_rest:
            expected = len(non_rest)

    pct = min(100, round(len(completed) / max(1, expected) * 100))
    missed = max(0, expected - len(completed))

    if missed <= GRACE_MISSED_DAYS:
        status = "favorable"
        detail = f"{len(completed)}/{expected} planned sessions this week — right on track."
    else:
        status = "slipping"
        detail = f"{len(completed)}/{expected} planned sessions this week."

    return PillarScore("Workouts", pct, status, detail), len(sessions)


def _nutrition_pillar(user_id: str, protein_target_g: float) -> tuple[PillarScore, int]:
    sb = get_supabase()
    res = (
        sb.table("nutrition_logs")
        .select("log_date, protein_g")
        .eq("user_id", user_id)
        .gte("log_date", _window(WINDOW_DAYS))
        .execute()
    )
    logs = res.data or []
    by_day: dict[str, float] = {}
    for l in logs:
        d = str(l.get("log_date"))
        by_day[d] = by_day.get(d, 0.0) + (l.get("protein_g") or 0.0)

    days_logged = len(by_day)
    if days_logged == 0:
        return PillarScore(
            "Nutrition", 0, "no_data",
            "No food logged this week — hard to say either way."
        ), 0

    target = protein_target_g or 160.0
    days_on_target = sum(1 for total in by_day.values() if total >= target * 0.75)
    pct = min(100, round(days_on_target / WINDOW_DAYS * 100))
    missed = WINDOW_DAYS - days_on_target

    if missed <= GRACE_MISSED_DAYS + 1:
        status = "favorable"
        detail = f"Protein target hit on {days_on_target}/{WINDOW_DAYS} days."
    else:
        status = "slipping"
        detail = f"Protein target hit on only {days_on_target}/{WINDOW_DAYS} days."

    return PillarScore("Nutrition", pct, status, detail), days_logged


def _recovery_pillar(user_id: str) -> PillarScore:
    state = get_agent_state(user_id)
    cns_fatigue = state.get("cns_fatigue_score", 0) or 0
    consecutive_high_rpe = state.get("consecutive_high_rpe_days", 0) or 0

    pct = max(0, min(100, round((10 - cns_fatigue) / 10 * 100)))
    if cns_fatigue <= 5 and consecutive_high_rpe <= 2:
        status = "favorable"
        detail = "CNS fatigue and RPE trend are in a healthy range."
    else:
        status = "slipping"
        detail = "CNS fatigue has been elevated — recovery is lagging behind training."

    return PillarScore("Recovery", pct, status, detail)


def _mood_summary(user_id: str) -> str | None:
    """Mood is optional, session-level, and purely descriptive — it never
    moves the score itself since logging it is not required."""
    sb = get_supabase()
    res = (
        sb.table("workout_sessions")
        .select("mood")
        .eq("user_id", user_id)
        .gte("session_date", _window(WINDOW_DAYS))
        .not_.is_("mood", "null")
        .execute()
    )
    moods = [r["mood"] for r in (res.data or []) if r.get("mood")]
    if not moods:
        return None
    order = ["bad", "okay", "good", "great"]
    counts = {m: moods.count(m) for m in set(moods)}
    top = max(counts, key=lambda m: (counts[m], order.index(m) if m in order else -1))
    return top


def _headline(score: int, pillars: list[PillarScore]) -> str:
    slipping = [p for p in pillars if p.status == "slipping"]
    no_data = [p for p in pillars if p.status == "no_data"]

    if score >= 80 and not slipping:
        return "You've been consistent this week. Keep this rhythm going."

    if score >= 65 and len(slipping) <= 1:
        if slipping:
            return f"Solid week overall — {slipping[0].label.lower()} is the one thing worth nudging."
        return "Solid week overall — nothing urgent to fix."

    if slipping:
        names = " and ".join(p.label.lower() for p in slipping)
        return (
            f"Your {names} have slipped this week, which is probably why "
            f"progress has stalled. Pick one thing to fix today — not everything at once."
        )

    if no_data and not slipping:
        names = " and ".join(p.label.lower() for p in no_data)
        return f"Training looks fine, but {names} hasn't been logged — turn that on to get a fuller picture."

    return "A quieter week. One session or one logged meal today is enough to get back in rhythm."


def run_consistency_agent(user_id: str, protein_target_g: float = 160.0) -> ConsistencyResult:
    state = get_agent_state(user_id)
    total_workouts = state.get("total_workouts", 0) or 0

    workout_pillar, sessions_seen = _workout_pillar(user_id)
    nutrition_pillar, nutrition_days_seen = _nutrition_pillar(user_id, protein_target_g)
    recovery_pillar = _recovery_pillar(user_id)

    # A brand-new or long-dormant user shouldn't see a harsh 0% — there's
    # no meaningful signal yet, so don't pretend there is one.
    if total_workouts < MIN_DAYS_FOR_SCORE and sessions_seen == 0 and nutrition_days_seen == 0:
        return ConsistencyResult(
            status="new",
            score=0,
            trend="unknown",
            headline="Still building your baseline — log a couple more days and this will start meaning something.",
            pillars=[workout_pillar, nutrition_pillar, recovery_pillar],
            mood_summary=None,
        )

    pillars = [workout_pillar, nutrition_pillar, recovery_pillar]
    scored = [p for p in pillars if p.status != "no_data"]
    if scored:
        weight_map = {"Workouts": "workout", "Nutrition": "nutrition", "Recovery": "recovery"}
        total_weight = sum(WEIGHTS[weight_map[p.label]] for p in scored)
        score = round(sum(p.pct * WEIGHTS[weight_map[p.label]] for p in scored) / total_weight)
    else:
        score = 0

    headline = _headline(score, pillars)
    mood = _mood_summary(user_id)

    return ConsistencyResult(
        status="scored",
        score=score,
        trend="unknown",   # left for a future release once 2-week history comparison is wired up
        headline=headline,
        pillars=pillars,
        mood_summary=mood,
    )
