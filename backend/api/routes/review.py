"""
Weekly Review Route — GET /api/review/weekly

Returns the AI-generated weekly coach review.
Includes workout consistency, strength gains, nutrition adherence,
recovery score, highlights, needs attention, and a personalized
next-week strategy narrative.

Query params:
  weeks_ago: int (default 0 = current week, 1 = last week)
"""
import asyncio
from fastapi import APIRouter, Depends
from core.security import get_current_user
from agents.weekly_review_agent import generate_weekly_review
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
