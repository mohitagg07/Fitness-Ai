"""
Admin Route — VYRN

Manual triggers for background jobs and strategy engine.
Useful for testing the automation layer end-to-end, and as an ops
escape hatch if a scheduled run was missed.

Routes:
  POST /api/admin/run-jobs-now          — fire all 5 nightly jobs immediately
  POST /api/admin/run-strategy/{user_id} — run the strategy engine for one user
  GET  /api/admin/strategy-history      — recent strategy decisions
"""
import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException
from core.security import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Admin"])


@router.post("/run-jobs-now")
async def run_jobs_now(
    current_user: dict = Depends(get_current_user),
):
    """
    Runs all five background jobs (pattern detection, memory cleanup,
    weekly review, morning brief prep, notification generation) once,
    immediately, for ALL active users. Returns a per-job status dict.
    """
    try:
        from services.scheduler import run_all_jobs_now
        results = await asyncio.to_thread(run_all_jobs_now)
        return {"triggered": True, "results": results}
    except Exception as e:
        logger.exception(f"run_jobs_now failed: {e}")
        raise HTTPException(500, f"Job trigger failed: {e}")


@router.post("/run-strategy")
async def run_strategy_for_me(
    current_user: dict = Depends(get_current_user),
    rewrite_program: bool = True,
):
    """
    Run the Adaptive Training Strategy Engine for the calling user.
    Returns the chosen block, rationale, predicted outcome, and key signals.
    Setting rewrite_program=false skips the program rewrite (useful for
    preview / dry-run mode).
    """
    user_id = current_user["user_id"]
    try:
        from agents.training_strategy_engine import run_strategy_engine
        result = await asyncio.to_thread(run_strategy_engine, user_id, rewrite_program)
        return result
    except Exception as e:
        logger.exception(f"run_strategy failed for {user_id}: {e}")
        raise HTTPException(500, f"Strategy engine failed: {e}")


@router.get("/strategy-history")
async def strategy_history(
    limit: int = 10,
    current_user: dict = Depends(get_current_user),
):
    """Recent strategy decisions for the calling user."""
    from db.supabase_client import get_supabase
    sb = get_supabase()
    try:
        res = (
            sb.table("training_strategies")
            .select("*")
            .eq("user_id", current_user["user_id"])
            .order("decided_at", desc=True)
            .limit(limit)
            .execute()
        )
        return {"strategies": res.data or []}
    except Exception as e:
        raise HTTPException(500, f"Could not load strategy history: {e}")


@router.get("/cns-load")
async def get_cns_load(
    current_user: dict = Depends(get_current_user),
):
    """
    Returns the current CNS Load breakdown for the calling user:
      score (0-100), label (Low/Medium/High/Very High), components.
    Useful for debugging and for the Decision Center card.
    """
    from db.supabase_client import get_full_user_context
    from agents.recovery_agent import run_recovery_agent, compute_cns_load
    from services.agent_state_store import get_agent_state

    user_id = current_user["user_id"]
    try:
        profile, agent_state = get_full_user_context(user_id)
        recovery = run_recovery_agent(
            user_id,
            sleep_hours=profile.get("sleep_hours"),
        )
        return {
            "recovery_pct": recovery.__dict__.get("score_pct", recovery.recovery_score * 10),
            "cns_load":     recovery.__dict__.get("cns_load", {}),
            "sub_scores":   recovery.__dict__.get("sub_scores", {}),
            "action":       recovery.action,
            "message":      recovery.message,
        }
    except Exception as e:
        logger.exception(f"get_cns_load failed for {user_id}: {e}")
        raise HTTPException(500, f"CNS load check failed: {e}")
