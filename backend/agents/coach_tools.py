"""Read-only, user-scoped tools available to the VYRN Coach agent.

Every database query is scoped to the authenticated user ID captured by the
factory. The language model never receives a user_id argument and cannot
select another user's records. Mutating actions deliberately live in separate
authenticated API routes and are not exposed to this tool registry.
"""
from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from typing import Any

from langchain_core.tools import StructuredTool

from db.supabase_client import get_supabase

logger = logging.getLogger(__name__)


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


def _unavailable(tool_name: str) -> str:
    return _json({
        "available": False,
        "tool": tool_name,
        "message": "This data is not available right now. Do not infer or invent it.",
    })


def build_coach_tools(user_id: str, profile: dict | None = None) -> list[StructuredTool]:
    """Build the read-only tool registry for one authenticated athlete."""
    safe_profile = profile if isinstance(profile, dict) else {}

    def get_recent_workouts(days: int = 30, limit: int = 8) -> str:
        """Retrieve recent completed and in-progress workout sessions for this athlete.

        Use when the question depends on recent training frequency, workout
        types, session volume or duration. days must be 1–90; limit 1–20.
        """
        days = max(1, min(int(days), 90))
        limit = max(1, min(int(limit), 20))
        try:
            client = get_supabase()
            result = (
                client.table("workout_sessions")
                .select("id, session_date, workout_type, day_label, status, completed, total_volume_kg, duration_minutes")
                .eq("user_id", user_id)
                .gte("session_date", str(date.today() - timedelta(days=days)))
                .order("session_date", desc=True)
                .limit(limit)
                .execute()
            )
            rows = result.data or []
            session_ids = [row.get("id") for row in rows if row.get("id")]
            exercise_logs = []
            if session_ids:
                log_result = (
                    client.table("exercise_logs")
                    .select("session_id, exercise_name, weight_kg, reps, rpe, is_warmup, logged_at")
                    .eq("user_id", user_id)
                    .in_("session_id", session_ids)
                    .order("logged_at", desc=False)
                    .execute()
                )
                exercise_logs = log_result.data or []
            return _json({
                "available": True,
                "window_days": days,
                "count": len(rows),
                "sessions": rows,
                "exercise_logs": exercise_logs,
            })
        except Exception as exc:
            logger.warning("Coach workout-history tool unavailable (%s)", type(exc).__name__)
            return _unavailable("get_recent_workouts")

    def get_nutrition_today() -> str:
        """Retrieve today's logged calories, protein, carbohydrates, fats and water.

        Use for nutrition or protein questions. An empty log is not evidence
        that the athlete consumed zero; report that no meals were logged.
        """
        try:
            result = (
                get_supabase().table("nutrition_logs")
                .select("meal_name, calories, protein_g, carbs_g, fat_g, water_ml, log_date")
                .eq("user_id", user_id)
                .eq("log_date", str(date.today()))
                .order("id", desc=False)
                .execute()
            )
            rows = result.data or []
            keys = ("calories", "protein_g", "carbs_g", "fat_g", "water_ml")
            totals = {
                key: round(sum(float(row.get(key) or 0) for row in rows), 1)
                for key in keys
            }
            return _json({
                "available": True,
                "date": str(date.today()),
                "logged": bool(rows),
                "meal_count": len(rows),
                "totals": totals if rows else None,
                "meals": rows[:20],
            })
        except Exception as exc:
            logger.warning("Coach nutrition tool unavailable (%s)", type(exc).__name__)
            return _unavailable("get_nutrition_today")

    def get_recovery_checkins(days: int = 7) -> str:
        """Retrieve recent athlete-reported sleep, soreness and energy check-ins.

        Use when the athlete asks about fatigue, recovery or training readiness.
        days must be 1–30. These are self-reported check-ins, not clinical data.
        """
        days = max(1, min(int(days), 30))
        try:
            result = (
                get_supabase().table("recovery_checkins")
                .select("local_date, sleep_hours, soreness_level, energy_level, notes")
                .eq("user_id", user_id)
                .gte("local_date", str(date.today() - timedelta(days=days)))
                .order("local_date", desc=True)
                .limit(days)
                .execute()
            )
            rows = result.data or []
            return _json({
                "available": True,
                "count": len(rows),
                "checkins": rows,
                "source_type": "athlete_reported",
            })
        except Exception as exc:
            logger.warning("Coach recovery tool unavailable (%s)", type(exc).__name__)
            return _unavailable("get_recovery_checkins")

    def get_weight_trend(days: int = 30) -> str:
        """Retrieve actual body-weight entries and their observed trend.

        Use for weight or body-composition progress questions. days must be
        7–90. Do not extrapolate beyond the returned measurements.
        """
        days = max(7, min(int(days), 90))
        try:
            result = (
                get_supabase().table("progress_metrics")
                .select("weight_kg, recorded_date")
                .eq("user_id", user_id)
                .not_.is_("weight_kg", "null")
                .gte("recorded_date", str(date.today() - timedelta(days=days)))
                .order("recorded_date", desc=False)
                .limit(100)
                .execute()
            )
            rows = [row for row in (result.data or []) if row.get("weight_kg") is not None]
            if not rows:
                return _json({
                    "available": True,
                    "has_data": False,
                    "message": "No body-weight entries were logged in this window.",
                    "window_days": days,
                })
            first = float(rows[0]["weight_kg"])
            latest = float(rows[-1]["weight_kg"])
            return _json({
                "available": True,
                "has_data": True,
                "window_days": days,
                "entry_count": len(rows),
                "first_entry": rows[0],
                "latest_entry": rows[-1],
                "change_kg": round(latest - first, 2),
                "entries": rows,
            })
        except Exception as exc:
            logger.warning("Coach weight-trend tool unavailable (%s)", type(exc).__name__)
            return _unavailable("get_weight_trend")

    def get_profile_constraints() -> str:
        """Retrieve relevant saved profile constraints for workout or meal planning.

        Use before making a personalised plan. Missing fields remain null or
        empty; do not fill them with defaults.
        """
        keys = (
            "goal", "experience_level", "gym_or_home", "equipment",
            "workout_days_per_week", "injuries", "food_preference",
            "allergies", "food_restrictions", "sleep_hours",
            "age", "height_cm", "weight_kg", "gender",
            "workout_time_preference",
        )
        return _json({
            key: safe_profile.get(key)
            for key in keys
        })

    def search_fitness_evidence(query: str, limit: int = 3) -> str:
        """Search VYRN's curated source-linked fitness knowledge base.

        Use for training, activity, sleep, hydration or sports-nutrition
        questions that require supporting evidence. Returns only retrieved
        passages and their stored source metadata.
        """
        from agents.fitness_knowledge import retrieve_fitness_knowledge

        clean_query = str(query or "").strip()[:500]
        if len(clean_query) < 3:
            return _json({"available": False, "message": "Provide a more specific search query."})
        limit = max(1, min(int(limit), 4))
        try:
            documents = retrieve_fitness_knowledge(clean_query, top_k=limit)
            return _json({
                "available": True,
                "count": len(documents),
                "documents": [
                    {
                        "title": item.get("title"),
                        "category": item.get("category"),
                        "content": item.get("content"),
                        "url": item.get("url") if str(item.get("url") or "").startswith("https://") else None,
                    }
                    for item in documents
                ],
            })
        except Exception as exc:
            logger.warning("Coach evidence-search tool unavailable (%s)", type(exc).__name__)
            return _unavailable("search_fitness_evidence")

    return [
        StructuredTool.from_function(
            get_recent_workouts,
            name="get_recent_workouts",
            description=get_recent_workouts.__doc__ or "",
        ),
        StructuredTool.from_function(
            get_nutrition_today,
            name="get_nutrition_today",
            description=get_nutrition_today.__doc__ or "",
        ),
        StructuredTool.from_function(
            get_recovery_checkins,
            name="get_recovery_checkins",
            description=get_recovery_checkins.__doc__ or "",
        ),
        StructuredTool.from_function(
            get_weight_trend,
            name="get_weight_trend",
            description=get_weight_trend.__doc__ or "",
        ),
        StructuredTool.from_function(
            get_profile_constraints,
            name="get_profile_constraints",
            description=get_profile_constraints.__doc__ or "",
        ),
        StructuredTool.from_function(
            search_fitness_evidence,
            name="search_fitness_evidence",
            description=search_fitness_evidence.__doc__ or "",
        ),
    ]
