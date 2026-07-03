"""
Prediction Engine — VYRN

The roadmap explicitly asked for a REAL prediction engine — "NOT fake AI,
use trend regression" — as opposed to an LLM guessing a number. This
module is exactly that: ordinary least-squares linear regression over
real logged history (bodyweight from progress_metrics, a lift's best set
from exercise_logs), computed in plain Python (no numpy dependency needed
for a single-variable regression).

Design constraints, because this is the second prediction feature in the
codebase and the first one (PredictionCard.tsx / GET /review/weekly)
deliberately does NOT show ETA-style projections — its own comments call
that "the kind of fabricated number the rest of this app goes out of its
way to avoid." The difference here is that this module is exactly the
thing that comment was contrasting against: a disclosed, reproducible
regression over real data, not an invented one. To stay honest under that
same standard, this module:

  1. Requires a minimum number of data points (MIN_POINTS) before
     projecting anything — a 2-point "trend" is a guess, not a trend.
  2. Reports R² alongside the projection and labels confidence Low/Medium/
     High from it — so a noisy trend is visibly noisy, not hidden behind
     false precision.
  3. Never extrapolates beyond MAX_PROJECTION_WEEKS — a regression line
     drawn 6 months out from 6 weeks of data is exactly the kind of
     confident-sounding nonsense this app's own design philosophy warns
     against.
  4. Returns has_data: false with an explanation rather than a null/zero
     projection when there isn't enough signal — same pattern every other
     analytics endpoint in this codebase uses.
"""
from __future__ import annotations
from datetime import date, timedelta

MIN_POINTS = 4
MAX_PROJECTION_WEEKS = 12


def _linreg(xs: list[float], ys: list[float]) -> tuple[float, float, float]:
    """Ordinary least squares. Returns (slope, intercept, r_squared).
    Pure Python — this is a single-variable fit, not worth a numpy dep."""
    n = len(xs)
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    ss_xy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    ss_xx = sum((x - mean_x) ** 2 for x in xs)
    if ss_xx == 0:
        return 0.0, mean_y, 0.0
    slope = ss_xy / ss_xx
    intercept = mean_y - slope * mean_x
    predicted = [slope * x + intercept for x in xs]
    ss_res = sum((y - p) ** 2 for y, p in zip(ys, predicted))
    ss_tot = sum((y - mean_y) ** 2 for y in ys)
    r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0.0
    return slope, intercept, r_squared


def _confidence_from_r2(r_squared: float, n_points: int) -> str:
    if r_squared >= 0.6 and n_points >= 6:
        return "High"
    if r_squared >= 0.3 and n_points >= 4:
        return "Medium"
    return "Low"


def _project_series(points: list[tuple[date, float]], unit_label: str) -> dict:
    """points: [(date, value), ...] ascending by date. Fits a line against
    days-since-first-point, and reports both the weekly rate of change and
    a bounded forward projection."""
    if len(points) < MIN_POINTS:
        return {
            "has_data": False,
            "reason": f"Need at least {MIN_POINTS} logged points — currently {len(points)}.",
        }

    first_date = points[0][0]
    xs = [(d - first_date).days for d, _ in points]
    ys = [v for _, v in points]
    slope_per_day, intercept, r_squared = _linreg(xs, ys)
    weekly_rate = round(slope_per_day * 7, 2)
    confidence = _confidence_from_r2(r_squared, len(points))

    today_x = (date.today() - first_date).days
    current_projected = round(slope_per_day * today_x + intercept, 1)
    last_actual = ys[-1]

    projections = []
    for weeks_out in (4, 8, 12):
        if weeks_out > MAX_PROJECTION_WEEKS:
            continue
        future_x = today_x + weeks_out * 7
        value = round(slope_per_day * future_x + intercept, 1)
        projections.append({"weeks": weeks_out, "value": value, "unit": unit_label})

    return {
        "has_data": True,
        "n_points": len(points),
        "weekly_rate": weekly_rate,
        "unit": unit_label,
        "r_squared": round(r_squared, 2),
        "confidence": confidence,
        "last_actual": last_actual,
        "last_actual_date": str(points[-1][0]),
        "projections": projections,
    }


def predict_bodyweight_trend(user_id: str, days: int = 56) -> dict:
    """Regression over progress_metrics.weight_kg — real logged bodyweight,
    not an estimate."""
    from db.supabase_client import get_supabase
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
    rows = res.data or []
    points = []
    for r in rows:
        try:
            points.append((date.fromisoformat(r["recorded_date"][:10]), float(r["weight_kg"])))
        except Exception:
            continue
    return _project_series(points, "kg")


def predict_lift_trend(user_id: str, exercise_name: str, days: int = 84) -> dict:
    """Regression over the heaviest set per week for a given lift, from
    exercise_logs — same real-history source strength charts already use."""
    from db.supabase_client import get_supabase
    sb = get_supabase()
    cutoff = str(date.today() - timedelta(days=days))
    res = (
        sb.table("exercise_logs")
        .select("weight_kg, logged_at")
        .eq("user_id", user_id)
        .ilike("exercise_name", f"%{exercise_name}%")
        .gte("logged_at", cutoff)
        .order("logged_at")
        .execute()
    )
    rows = res.data or []
    # Collapse to weekly bests so a single heavy/light day doesn't dominate
    # the fit the way every raw set would.
    weekly_best: dict[str, float] = {}
    for r in rows:
        try:
            d = date.fromisoformat(r["logged_at"][:10])
        except Exception:
            continue
        week_key = str(d - timedelta(days=d.weekday()))  # Monday of that week
        w = r.get("weight_kg") or 0
        weekly_best[week_key] = max(weekly_best.get(week_key, 0), w)

    points = sorted((date.fromisoformat(k), v) for k, v in weekly_best.items())
    return _project_series(points, "kg")


def _top_logged_exercise(user_id: str) -> str | None:
    """Picks the exercise with the most logged sets in the last 90 days —
    the lift with enough signal to actually fit a trend against, rather
    than guessing "Bench Press" and finding nothing."""
    from db.supabase_client import get_supabase
    sb = get_supabase()
    cutoff = str(date.today() - timedelta(days=90))
    res = (
        sb.table("exercise_logs")
        .select("exercise_name")
        .eq("user_id", user_id)
        .gte("logged_at", cutoff)
        .execute()
    )
    rows = res.data or []
    if not rows:
        return None
    counts: dict[str, int] = {}
    for r in rows:
        name = r.get("exercise_name")
        if name:
            counts[name] = counts.get(name, 0) + 1
    return max(counts.items(), key=lambda kv: kv[1])[0] if counts else None


def run_prediction_engine(user_id: str) -> dict:
    """Aggregate entry point — bodyweight trend + the user's most-logged
    lift's trend, each honestly gated on data quality."""
    top_exercise = _top_logged_exercise(user_id)
    lift_trend = predict_lift_trend(user_id, top_exercise) if top_exercise else {"has_data": False, "reason": "No exercise history yet."}
    return {
        "bodyweight": predict_bodyweight_trend(user_id),
        "lift": {"exercise_name": top_exercise, **lift_trend} if top_exercise else lift_trend,
    }
