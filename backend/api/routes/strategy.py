"""
Training Strategy Route — VYRN

GET  /api/strategy/current   — run the strategy engine and return the result
                                (or return a cached decision from today if
                                one already exists — avoids duplicate LLM calls)
GET  /api/strategy/history   — list past strategy decisions for this user
"""
import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException
from core.security import get_current_user
from db.supabase_client import get_supabase

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Training Strategy"])


@router.get("/current")
async def get_current_strategy(
    force_refresh: bool = False,
    rewrite_program: bool = False,   # False by default — safe for GET
    current_user: dict = Depends(get_current_user),
):
    """
    Returns the active training strategy for the calling user.
    Checks for a cached decision from today before running the engine,
    so multiple front-end calls on the same day are free.

    Query params:
      force_refresh=true   — re-run the engine even if today's cache exists
      rewrite_program=true — also rewrite the active workout plan (expensive)
    """
    user_id = current_user["user_id"]
    from datetime import date
    today = str(date.today())

    if not force_refresh:
        sb = get_supabase()
        try:
            cached = (
                sb.table("training_strategies")
                .select("*")
                .eq("user_id", user_id)
                .eq("decided_at", today)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if cached.data:
                row = cached.data[0]
                return {
                    "block":             row["block"],
                    "block_label":       row["block_label"],
                    "rationale":         row["rationale"],
                    "predicted_outcome": row["predicted_outcome"],
                    "confidence":        row["confidence"],
                    "signals": {
                        "recovery_pct": row.get("recovery_pct"),
                        "cns_label":    row.get("cns_label"),
                        "goal":         row.get("goal"),
                    },
                    "cached": True,
                    "rewrite_result": None,
                }
        except Exception:
            pass   # cache miss → fall through to engine

    try:
        from agents.training_strategy_engine import run_strategy_engine
        result = await asyncio.to_thread(run_strategy_engine, user_id, rewrite_program)
        result["cached"] = False
        return result
    except Exception as e:
        logger.exception(f"get_current_strategy failed for {user_id}: {e}")
        raise HTTPException(500, f"Strategy engine failed: {e}")


@router.get("/history")
async def strategy_history(
    limit: int = 20,
    current_user: dict = Depends(get_current_user),
):
    """List the last N strategy decisions for this user."""
    sb = get_supabase()
    try:
        res = (
            sb.table("training_strategies")
            .select("id, decided_at, block, block_label, rationale, predicted_outcome, confidence, recovery_pct, cns_label, goal")
            .eq("user_id", current_user["user_id"])
            .order("decided_at", desc=True)
            .limit(limit)
            .execute()
        )
        return {"strategies": res.data or []}
    except Exception as e:
        raise HTTPException(500, f"Could not load strategy history: {e}")
