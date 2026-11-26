"""Shared queries and normalization for user-entered recovery measurements.

The database stores recovery scores on a 0-100 scale. Review agents use a
0-10 display scale, while scenario projections use the original percentage.
Missing measurements remain None; CNS fatigue is not a substitute for a
measured recovery history.
"""
from __future__ import annotations

import math
from datetime import date

from db.supabase_client import get_supabase


def average_recovery_score_pct(rows: list[dict]) -> float | None:
    """Average valid 0-100 recovery entries; ignore null or malformed rows."""
    scores: list[float] = []
    for row in rows:
        value = row.get("recovery_score")
        if value is None:
            continue
        try:
            score = float(value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(score) and 0 <= score <= 100:
            scores.append(score)
    return round(sum(scores) / len(scores), 1) if scores else None


def get_average_recovery_score_pct(
    user_id: str,
    start_date: date,
    end_date: date,
) -> float | None:
    """Fetch a user's measured recovery scores for an inclusive date range."""
    if end_date < start_date:
        raise ValueError("end_date must be on or after start_date")

    result = (
        get_supabase()
        .table("progress_metrics")
        .select("recovery_score")
        .eq("user_id", user_id)
        .gte("recorded_date", str(start_date))
        .lte("recorded_date", str(end_date))
        .not_.is_("recovery_score", "null")
        .execute()
    )
    return average_recovery_score_pct(result.data or [])
