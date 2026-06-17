"""
Progress Agent — watches weight trend over time and proactively recommends
calorie adjustments instead of waiting for the user to notice a stall.

"Weight loss has stalled for 10 days. Reducing calories by 150."
"""
from datetime import date, timedelta
from schemas.models import Goal, ProgressDecision
from db.supabase_client import get_supabase

# How many days of no meaningful change counts as "stalled"
STALL_WINDOW_DAYS = 10
# Minimum kg change over the window to NOT count as stalled
STALL_THRESHOLD_KG = 0.3
# Calorie adjustment step when a stall is detected
ADJUSTMENT_KCAL = 150


def _recent_weights(user_id: str, days: int) -> list[dict]:
    sb = get_supabase()
    cutoff = str(date.today() - timedelta(days=days))
    res = (
        sb.table("progress_metrics")
        .select("recorded_date, weight_kg")
        .eq("user_id", user_id)
        .gte("recorded_date", cutoff)
        .not_.is_("weight_kg", "null")
        .order("recorded_date")
        .execute()
    )
    return res.data or []


def run_progress_agent(user_id: str, goal: Goal) -> ProgressDecision:
    weights = _recent_weights(user_id, STALL_WINDOW_DAYS)

    if len(weights) < 2:
        return ProgressDecision(
            message="Log your weight a few more days this week — I need at least two points to spot a trend.",
            stalled=False,
            suggested_calorie_adjustment=0,
        )

    first = weights[0]["weight_kg"]
    last = weights[-1]["weight_kg"]
    delta = last - first

    # Direction the goal actually wants
    wants_loss = goal == Goal.cut
    wants_gain = goal == Goal.bulk

    stalled = False
    if wants_loss and delta > -STALL_THRESHOLD_KG:
        stalled = True
    elif wants_gain and delta < STALL_THRESHOLD_KG:
        stalled = True
    # recomp/maintain: stall isn't really "bad," so never auto-adjust for them

    if not stalled:
        if wants_loss:
            message = f"Weight loss is on track ({abs(delta):.1f}kg down over {STALL_WINDOW_DAYS} days). Keep current targets."
        elif wants_gain:
            message = f"Weight gain is on track (+{delta:.1f}kg over {STALL_WINDOW_DAYS} days). Keep current targets."
        else:
            message = "Weight is holding steady, which is exactly the goal for maintenance/recomp."
        return ProgressDecision(message=message, stalled=False, suggested_calorie_adjustment=0)

    if wants_loss:
        message = (
            f"Weight loss has stalled for {STALL_WINDOW_DAYS} days. "
            f"Reducing calories by {ADJUSTMENT_KCAL} to restart progress."
        )
        adjustment = -ADJUSTMENT_KCAL
    else:
        message = (
            f"Weight gain has stalled for {STALL_WINDOW_DAYS} days. "
            f"Adding {ADJUSTMENT_KCAL} calories to restart progress."
        )
        adjustment = ADJUSTMENT_KCAL

    return ProgressDecision(message=message, stalled=True, suggested_calorie_adjustment=adjustment)
