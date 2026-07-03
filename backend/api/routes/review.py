"""
Review Routes — GET /api/review/weekly, GET /api/review/monthly

Returns the AI-generated weekly and monthly coach reviews.

Weekly includes workout consistency, strength gains, nutrition adherence,
recovery score, highlights, needs attention, and a next-week strategy.

Monthly includes progress, strengths, weaknesses, and an actual rewritten
program (triggers run_program_rewriter and returns the resulting diff).

Query params:
  weeks_ago / months_ago: int (default 0 = current period, 1 = previous)

PERF: GET /weekly used to call generate_weekly_review() — a full LLM
narrative generation — on every single request, including every dashboard
load that mounts PredictionCard. The nightly scheduler's job_weekly_review()
already upserts into weekly_reviews_cache and its own docstring says this
route "falls back to live generation if no cache exists" — but the route
never actually checked the cache table, so that comment described intended
behavior that was never wired up. This was the main source of "dashboard
feels slow": a multi-second synchronous Groq call on every page load, for
data that only changes once a day at most.
Fixed with a standard cache-aside read: check weekly_reviews_cache for this
week_label first; on a hit, return it instantly with no LLM call; on a
miss, generate live (as before) and warm the cache so the *next* load this
week is instant too, without waiting for Sunday's scheduled job.
"""
import asyncio
from datetime import date, timedelta
from fastapi import APIRouter, Depends
from core.security import get_current_user
from agents.weekly_review_agent import generate_weekly_review, _week_range
from agents.monthly_review_agent import generate_monthly_review
from db.supabase_client import get_supabase
import logging

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Review"])


def _read_weekly_cache(user_id: str, week_label: str) -> dict | None:
    try:
        sb = get_supabase()
        res = (
            sb.table("weekly_reviews_cache")
            .select("payload, generated_at")
            .eq("user_id", user_id)
            .eq("week_label", week_label)
            .limit(1)
            .execute()
        )
        if res.data:
            row = res.data[0]
            return {**row["payload"], "week_label": week_label, "generated_at": row["generated_at"]}
    except Exception as e:
        # Missing table / connectivity issue — fall through to live generation
        # rather than failing the whole request over a cache-layer problem.
        logger.warning(f"weekly_reviews_cache read failed, falling back to live: {e}")
    return None


def _write_weekly_cache(user_id: str, week_label: str, review) -> None:
    try:
        sb = get_supabase()
        sb.table("weekly_reviews_cache").upsert({
            "user_id": user_id,
            "week_label": week_label,
            "payload": {
                "consistency_pct": review.consistency_pct,
                "sessions_completed": review.sessions_completed,
                "sessions_planned": review.sessions_planned,
                "avg_recovery_score": review.avg_recovery_score,
                "avg_protein_g": review.avg_protein_g,
                "protein_target_g": review.protein_target_g,
                "protein_adherence_pct": review.protein_adherence_pct,
                "avg_calories": review.avg_calories,
                "calories_target": review.calories_target,
                "calories_adherence_pct": review.calories_adherence_pct,
                "best_lift": review.best_lift,
                "strength_gains": review.strength_gains,
                "highlights": review.highlights,
                "needs_attention": review.needs_attention,
                "next_week_strategy": review.next_week_strategy,
                "confidence": review.confidence,
            },
            "generated_at": review.generated_at,
        }, on_conflict="user_id,week_label").execute()
    except Exception as e:
        # Cache write failing shouldn't fail a request that already has its
        # (live-generated) answer — just means the next load pays again.
        logger.warning(f"weekly_reviews_cache write failed for {user_id}: {e}")


@router.get("/weekly")
async def get_weekly_review(
    weeks_ago: int = 0,
    current_user: dict = Depends(get_current_user),
):
    """
    Returns the full weekly AI coach review.
    Call on Sundays to get last week's review (weeks_ago=1),
    or any time to see the current week so far (weeks_ago=0).
    """
    user_id = current_user["user_id"]
    start, end = _week_range(weeks_ago)
    week_label = f"{start.strftime('%b %d')} – {end.strftime('%b %d, %Y')}"

    cached = await asyncio.to_thread(_read_weekly_cache, user_id, week_label)
    if cached is not None:
        return cached

    try:
        review = await asyncio.to_thread(generate_weekly_review, user_id, weeks_ago)
    except Exception as e:
        logger.error(f"Weekly review failed for {user_id}: {e}")
        return {
            "error": "Could not generate weekly review",
            "detail": str(e),
        }

    await asyncio.to_thread(_write_weekly_cache, user_id, week_label, review)

    return {
        "week_label": review.week_label,
        "consistency_pct": review.consistency_pct,
        "sessions_completed": review.sessions_completed,
        "sessions_planned": review.sessions_planned,
        "avg_recovery_score": review.avg_recovery_score,
        "avg_protein_g": review.avg_protein_g,
        "protein_target_g": review.protein_target_g,
        "protein_adherence_pct": review.protein_adherence_pct,
        "avg_calories": review.avg_calories,
        "calories_target": review.calories_target,
        "calories_adherence_pct": review.calories_adherence_pct,
        "best_lift": review.best_lift,
        "strength_gains": review.strength_gains,
        "highlights": review.highlights,
        "needs_attention": review.needs_attention,
        "next_week_strategy": review.next_week_strategy,
        "confidence": review.confidence,
        "generated_at": review.generated_at,
    }


@router.get("/monthly")
async def get_monthly_review(
    months_ago: int = 0,
    trigger_rewrite: bool = True,
    current_user: dict = Depends(get_current_user),
):
    """
    Returns the full monthly AI coach review: progress, strengths,
    weaknesses, and (if trigger_rewrite=True) an actual rewritten training
    block via the adaptive program rewriter.

    months_ago=0 → current month so far
    months_ago=1 → last full calendar month

    Set trigger_rewrite=false to read the review without writing a new
    program_versions row — useful for a "preview" call before the user
    confirms they want their program rewritten.
    """
    user_id = current_user["user_id"]

    try:
        review = await asyncio.to_thread(
            generate_monthly_review, user_id, months_ago, trigger_rewrite
        )
    except Exception as e:
        logger.error(f"Monthly review failed for {user_id}: {e}")
        return {
            "error": "Could not generate monthly review",
            "detail": str(e),
        }

    return {
        "month_label": review.month_label,
        "consistency_pct": review.consistency_pct,
        "sessions_completed": review.sessions_completed,
        "sessions_expected": review.sessions_expected,
        "avg_recovery_score": review.avg_recovery_score,
        "weight_trend": review.weight_trend,
        "strengths": review.strengths,
        "weaknesses": review.weaknesses,
        "strength_gains": review.strength_gains,
        "progress_summary": review.progress_summary,
        "program_rewrite": review.program_rewrite,
        "confidence": review.confidence,
        "generated_at": review.generated_at,
    }