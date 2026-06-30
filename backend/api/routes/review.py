"""
Review Routes — GET /api/review/weekly, GET /api/review/monthly

Returns the AI-generated weekly and monthly coach reviews.

Weekly includes workout consistency, strength gains, nutrition adherence,
recovery score, highlights, needs attention, and a next-week strategy.

Monthly includes progress, strengths, weaknesses, and an actual rewritten
program (triggers run_program_rewriter and returns the resulting diff).

Query params:
  weeks_ago / months_ago: int (default 0 = current period, 1 = previous)
"""
import asyncio
from fastapi import APIRouter, Depends
from core.security import get_current_user
from agents.weekly_review_agent import generate_weekly_review
from agents.monthly_review_agent import generate_monthly_review
import logging

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Review"])


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

    try:
        review = await asyncio.to_thread(generate_weekly_review, user_id, weeks_ago)
    except Exception as e:
        logger.error(f"Weekly review failed for {user_id}: {e}")
        return {
            "error": "Could not generate weekly review",
            "detail": str(e),
        }

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