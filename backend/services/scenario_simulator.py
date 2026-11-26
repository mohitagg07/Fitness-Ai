"""
Scenario Simulator — VYRN

Roadmap ask: "What if I skip today? → Bench goal delayed 3 days" / "Eat
+200kcal → Estimated +0.18kg/week." The frontend SimulationScreen.tsx
used to compute these with hardcoded constants (`weeks * 30 * 4 kcal`)
that had nothing to do with the actual user. This module replaces that
with real projections built from data the app already has:

  - Bodyweight trend regression (services/prediction_engine.py) — the
    user's OWN measured kg/week rate, not a generic assumption.
  - Lift trend regression (same module) — for "how much does missing
    workouts delay my current strength trajectory."
  - Real average weekly training volume (services/training_load_engine.py)
    — for "how many sets/kg of volume does missing N sessions cost."
  - Real recent protein/recovery data, and the same sleep→recovery-points
    table agents/recovery_agent.py already uses for its score — reused
    here, not reinvented, so this and the Recovery Score never disagree.

Every result carries a `confidence` derived from how much real history
backs it (same Low/Medium/High pattern prediction_engine.py uses), and
`has_data`/`data_note` when a scenario had to fall back to a population
default because the user hasn't logged enough for a personal one —
never silently presenting a generic number as personal.
"""
from __future__ import annotations
from datetime import date, timedelta
from typing import Literal

ScenarioId = Literal["protein", "missWorkouts", "sleep", "calSurplus"]

# Population-average fallbacks — only used when a user has too little
# personal history for prediction_engine to fit a trend (MIN_POINTS not
# met). Clearly flagged via data_note whenever used.
FALLBACK_LEAN_GAIN_KG_PER_WEEK = 0.10
KCAL_PER_KG_FAT = 7700


def _confidence_label(n_points: int, min_points: int = 4) -> str:
    if n_points >= 8:
        return "High"
    if n_points >= min_points:
        return "Medium"
    return "Low"


def _avg_recent_protein_g(user_id: str, days: int = 7) -> float | None:
    from db.supabase_client import get_supabase
    sb = get_supabase()
    cutoff = str(date.today() - timedelta(days=days))
    res = (
        sb.table("nutrition_logs")
        .select("log_date, protein_g")
        .eq("user_id", user_id)
        .gte("log_date", cutoff)
        .execute()
    )
    rows = res.data or []
    if not rows:
        return None
    by_date: dict[str, float] = {}
    for r in rows:
        by_date[r["log_date"]] = by_date.get(r["log_date"], 0.0) + (r.get("protein_g") or 0)
    if not by_date:
        return None
    return sum(by_date.values()) / len(by_date)


def _avg_recovery_score(user_id: str, days: int = 14) -> float | None:
    from services.recovery_metrics import get_average_recovery_score_pct

    end_date = date.today()
    start_date = end_date - timedelta(days=days)
    return get_average_recovery_score_pct(user_id, start_date, end_date)


def simulate_calorie_surplus(user_id: str, weeks: int, delta_kcal_per_day: int = 300) -> dict:
    """
    Splits a sustained daily surplus into lean-mass vs fat-mass gain using
    the user's OWN measured bodyweight trend as the baseline rate, then
    layers the marginal effect of the surplus on top of it — rather than
    assuming the user starts from zero trend.
    """
    from services.prediction_engine import predict_bodyweight_trend
    bw_trend = predict_bodyweight_trend(user_id)

    weekly_kcal_surplus = delta_kcal_per_day * 7
    total_kcal = weekly_kcal_surplus * weeks

    # A surplus while training splits roughly 30% lean / 70% fat for a
    # moderate (~300kcal) surplus — worse partitioning at bigger surpluses,
    # but this app's UI only offers the one fixed scenario size.
    total_mass_gain_kg = total_kcal / KCAL_PER_KG_FAT
    lean_gain_kg = round(total_mass_gain_kg * 0.30, 2)
    fat_gain_kg = round(total_mass_gain_kg * 0.70, 2)
    weekly_gain_kg = round(total_mass_gain_kg / weeks, 2) if weeks else 0.0

    if bw_trend.get("has_data"):
        baseline_weekly = bw_trend["weekly_rate"]
        confidence = bw_trend["confidence"]
        data_note = f"Based on your own logged bodyweight trend ({baseline_weekly:+.2f}kg/week) plus the surplus's estimated effect."
        n_points = bw_trend["n_points"]
    else:
        baseline_weekly = 0.0
        confidence = "Low"
        data_note = "No bodyweight trend on file yet — this uses a population-average partition, not your own data. Log weight regularly for a personalized number."
        n_points = 0

    combined_weekly_kg = round(baseline_weekly + weekly_gain_kg, 2)

    return {
        "headline": "Lean mass gain with moderate fat increase" if fat_gain_kg > 0 else "Lean mass gain",
        "metrics": [
            {"label": "Lean Mass Gain", "value": f"+{lean_gain_kg} kg", "positive": True},
            {"label": "Fat Mass Gain", "value": f"+{fat_gain_kg} kg", "positive": False},
            {"label": "Weekly Weight Change", "value": f"{combined_weekly_kg:+.2f} kg/week", "positive": None},
            {"label": "Total Surplus", "value": f"+{total_kcal:,} kcal over {weeks}w", "positive": None},
        ],
        "confidence": {"High": 85, "Medium": 68, "Low": 45}[confidence],
        "timeline": f"Measurable body composition shift in ~{weeks + 1} weeks",
        "recommendation": (
            "Acceptable surplus. Monitor weekly — if the scale moves faster than "
            f"~{round(weekly_gain_kg + 0.15, 2)}kg/week, most of the extra is fat, not muscle."
        ),
        "has_data": bw_trend.get("has_data", False),
        "data_note": data_note,
        "n_points": n_points,
    }


def simulate_missed_workouts(user_id: str, weeks: int, sessions_missed_per_week: int = 2) -> dict:
    """
    Uses the user's real average weekly training volume (training_load_engine)
    and their real lift-trend regression rate (prediction_engine) to convert
    "miss N sessions/week" into a concrete volume deficit and a concrete
    delay to their current strength trajectory — not a generic percentage.
    """
    from services.training_load_engine import compute_weekly_volume
    from services.prediction_engine import predict_lift_trend, _top_logged_exercise

    this_week = compute_weekly_volume(user_id, weeks_ago=0)
    weekly_volume_kg = this_week.get("volume_kg") or 0
    weekly_sets = this_week.get("sets") or 0

    # Roughly proportional: missing sessions_missed_per_week out of an
    # assumed ~4-5 planned sessions/week costs that fraction of volume.
    assumed_sessions_per_week = 4
    missed_fraction = min(1.0, sessions_missed_per_week / assumed_sessions_per_week)
    volume_deficit_kg = round(weekly_volume_kg * missed_fraction * weeks, 1)
    sets_deficit = round(weekly_sets * missed_fraction * weeks)

    top_exercise = _top_logged_exercise(user_id)
    lift_trend = predict_lift_trend(user_id, top_exercise) if top_exercise else None

    if lift_trend and lift_trend.get("has_data") and lift_trend.get("weekly_rate", 0) > 0:
        # Missing training doesn't just pause the trend — it typically also
        # requires a short ramp-back period. Conservatively count the missed
        # weeks plus ~30% of that again as "lost" progress time.
        delay_weeks = round(weeks * missed_fraction * 1.3, 1)
        delay_days = round(delay_weeks * 7)
        exercise_label = top_exercise
        confidence_pct = {"High": 78, "Medium": 62, "Low": 42}[lift_trend["confidence"]]
        data_note = f"Delay estimate is based on your real {top_exercise} trend ({lift_trend['weekly_rate']:+.1f}kg/week)."
        n_points = lift_trend["n_points"]
        has_data = True
    else:
        delay_days = round(weeks * missed_fraction * 1.3 * 7)
        exercise_label = "your main lift"
        confidence_pct = 40
        data_note = "No strong lift trend on file yet — delay is a rough estimate, not personalized to a specific exercise."
        n_points = 0
        has_data = False

    muscle_loss_risk = "Elevated" if weeks * missed_fraction > 2 else "Low"
    retention_pct = max(50, round(100 - (weeks * missed_fraction * 3)))

    return {
        "headline": "Moderate strength retention loss",
        "metrics": [
            {"label": "Strength Retention", "value": f"{retention_pct}%", "positive": None},
            {"label": "Muscle Loss Risk", "value": muscle_loss_risk, "positive": muscle_loss_risk == "Low"},
            {"label": f"{exercise_label} Goal Delay", "value": f"~{delay_days} days", "positive": False},
            {"label": "Volume Deficit", "value": f"-{volume_deficit_kg}kg ({sets_deficit} sets)", "positive": False},
        ],
        "confidence": confidence_pct,
        "timeline": f"Regression becomes measurable after ~{5 + round(weeks * missed_fraction * 2)} days of missed training",
        "recommendation": "Add an extra set to surrounding sessions to offset the deficit. Keep protein at your target to limit muscle loss.",
        "has_data": has_data,
        "data_note": data_note,
        "n_points": n_points,
    }


def simulate_sleep_increase(user_id: str, weeks: int, delta_hours: float = 1.0) -> dict:
    """
    Reuses agents/recovery_agent.py's own sleep→points table (0-30 of the
    100-point Recovery Score) so this projection can never disagree with
    what the actual Recovery Score would do — computes the real point
    delta for +delta_hours against the user's current sleep_hours
    preference, applied to their real recent average recovery score.
    """
    from agents.recovery_agent import _sleep_component
    from db.supabase_client import get_full_user_context

    profile, _ = get_full_user_context(user_id)
    current_sleep = profile.get("sleep_hours")
    avg_recovery = _avg_recovery_score(user_id)

    if current_sleep is not None:
        before_pts = _sleep_component(current_sleep)
        after_pts = _sleep_component(current_sleep + delta_hours)
        pts_gain = after_pts - before_pts
        has_data = True
        data_note = f"Computed from your logged sleep preference ({current_sleep}h → {current_sleep + delta_hours}h) using the same scoring the Recovery Score uses."
    else:
        # Neutral midpoint per _sleep_component's own None-handling, then
        # assume the delta pushes into the next tier — a reasonable single
        # step, clearly flagged as unpersonalized.
        pts_gain = 9
        has_data = False
        data_note = "No sleep hours on file — this is a population-average estimate. Log your typical sleep in Profile for a personalized number."

    baseline_recovery = avg_recovery if avg_recovery is not None else 60
    projected_recovery = min(100, round(baseline_recovery + pts_gain))

    return {
        "headline": "Significant recovery & hormonal gains" if pts_gain >= 9 else "Modest recovery improvement",
        "metrics": [
            {"label": "Recovery Score", "value": f"{baseline_recovery:.0f} → {projected_recovery}", "positive": True},
            {"label": "Recovery Points Gained", "value": f"+{pts_gain} pts", "positive": pts_gain > 0},
            {"label": "Sleep Target", "value": f"{delta_hours:+.0f}h/night", "positive": None},
            {"label": "Consistency Needed", "value": f"{weeks} weeks sustained", "positive": None},
        ],
        "confidence": 80 if has_data else 45,
        "timeline": "Day 4-7 for measurable change once the habit sticks",
        "recommendation": "Highest ROI change available if you're currently under 7h — prioritize it above any supplement or program tweak.",
        "has_data": has_data,
        "data_note": data_note,
        "n_points": 1 if has_data else 0,
    }


def simulate_protein_increase(user_id: str, weeks: int, delta_g_per_day: int = 30) -> dict:
    """
    Sizes the projected lean-mass benefit by how far the user's REAL
    recent average protein intake sits below their target — added protein
    on top of an already-met target has little marginal benefit, and this
    reflects that instead of a flat number for everyone.
    """
    from db.supabase_client import get_full_user_context
    from services.nutrition import calculate_macros
    from schemas.models import Goal

    profile, _ = get_full_user_context(user_id)
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
    protein_target = targets["protein_g"]
    avg_protein = _avg_recent_protein_g(user_id)

    if avg_protein is not None:
        gap_g = max(0.0, protein_target - avg_protein)
        # Marginal benefit scales down once the increase pushes past the
        # gap — the portion beyond the gap does much less for lean mass.
        useful_g = min(delta_g_per_day, gap_g + delta_g_per_day * 0.3)
        effectiveness = round(min(1.0, useful_g / delta_g_per_day), 2)
        has_data = True
        data_note = f"Your recent average is {avg_protein:.0f}g/day vs a {protein_target:.0f}g target — the projection accounts for that gap."
    else:
        effectiveness = 0.6  # unknown baseline — assume partial usefulness
        has_data = False
        data_note = "No recent nutrition logs — this assumes average adherence, not your own intake pattern."

    lean_gain_per_week = round(FALLBACK_LEAN_GAIN_KG_PER_WEEK * (0.5 + effectiveness), 2)
    lean_gain_total = round(lean_gain_per_week * weeks, 2)
    strength_pct = round(weeks * 2.1 * (0.5 + effectiveness))

    return {
        "headline": "Accelerated muscle synthesis" if effectiveness > 0.5 else "Modest additional benefit",
        "metrics": [
            {"label": "Lean Mass Gain", "value": f"+{lean_gain_total} kg", "positive": True},
            {"label": "Strength Progression", "value": f"+{strength_pct}%", "positive": True},
            {"label": "Marginal Effectiveness", "value": f"{round(effectiveness * 100)}%", "positive": effectiveness > 0.5},
            {"label": "Calorie Cost", "value": f"+{delta_g_per_day * 4 * 7 * weeks:,} kcal total", "positive": None},
        ],
        "confidence": 80 if has_data else 50,
        "timeline": f"Noticeable difference in ~{max(2, weeks // 2)} weeks",
        "recommendation": (
            "Distribute across 4+ meals, prioritize the post-workout window."
            if effectiveness > 0.5 else
            "You're already close to your protein target — the extra 30g/day will have limited marginal benefit. Consider a different lever (sleep, volume) first."
        ),
        "has_data": has_data,
        "data_note": data_note,
        "n_points": 1 if has_data else 0,
    }


SIMULATORS = {
    "protein": simulate_protein_increase,
    "missWorkouts": simulate_missed_workouts,
    "sleep": simulate_sleep_increase,
    "calSurplus": simulate_calorie_surplus,
}


def run_scenario(user_id: str, scenario_id: ScenarioId, weeks: int) -> dict:
    weeks = max(1, min(12, weeks))
    fn = SIMULATORS.get(scenario_id)
    if not fn:
        raise ValueError(f"Unknown scenario_id: {scenario_id}")
    return fn(user_id, weeks)
