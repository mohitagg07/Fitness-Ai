"""
Decision History — VYRN

Persists every decision the decision_engine.py makes to Supabase and
exposes them for the DecisionScreen.

Previously DecisionScreen showed only hardcoded mock data while the real
decision engine ran on every dashboard load but never wrote to DB. This
route closes that gap:
  - POST /api/decisions/save  — called by decision_engine at the end of
                                build_decision_center()
  - GET  /api/decisions/       — feeds DecisionScreen with real history
  - POST /api/decisions/{id}/outcome — lets the user mark a decision
                                       correct/incorrect after the fact
"""
import asyncio
import logging
from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.security import get_current_user
from db.supabase_client import get_supabase
from agents.decision_engine import build_decision_center

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Decision History"])


class OutcomeUpdate(BaseModel):
    outcome: str          # "correct" | "incorrect" | "partial"
    outcome_note: Optional[str] = None


@router.get("/")
async def list_decisions(
    limit: int = 20,
    current_user: dict = Depends(get_current_user),
):
    """
    Return the user's decision history from ai_decisions.
    Newest first. Used by DecisionScreen.
    """
    sb = get_supabase()
    try:
        res = (
            sb.table("ai_decisions")
            .select("*")
            .eq("user_id", current_user["user_id"])
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return {"decisions": res.data or []}
    except Exception as e:
        raise HTTPException(500, f"Could not load decision history: {e}")


@router.post("/save")
async def save_today_decision(
    current_user: dict = Depends(get_current_user),
):
    """
    Build today's decision (same as the Dashboard card) and persist it.
    Idempotent — if a decision for today already exists, returns it.
    """
    user_id = current_user["user_id"]
    sb = get_supabase()

    # Idempotency: one decision per day per user
    today = str(date.today())
    existing = (
        sb.table("ai_decisions")
        .select("id, decision, confidence_pct")
        .eq("user_id", user_id)
        .eq("decision_date", today)
        .limit(1)
        .execute()
    )
    if existing.data:
        return {"saved": False, "existing": existing.data[0], "reason": "already_saved_today"}

    # Build the decision from the real engine
    from db.supabase_client import get_full_user_context
    try:
        profile, _ = await asyncio.to_thread(get_full_user_context, user_id)
        center = await asyncio.to_thread(build_decision_center, user_id, profile)
    except Exception as e:
        raise HTTPException(500, f"Decision engine error: {e}")

    # Persist
    row = {
        "user_id": user_id,
        "decision_date": today,
        "decision": center.decision,
        "confidence_pct": center.confidence_pct,
        "reasoning": center.reasoning,
        "expected_outcome": center.expected_outcome,
        "alternative": center.alternative,
        "signals": [
            {
                "label": s.label,
                "value": s.value,
                "favorable": s.favorable,
            }
            for s in center.signals
        ],
        "outcome": "pending",
        "outcome_note": None,
    }
    try:
        res = sb.table("ai_decisions").insert(row).execute()
        saved = res.data[0] if res.data else row
        return {"saved": True, "decision": saved}
    except Exception as e:
        raise HTTPException(500, f"Failed to persist decision: {e}")


@router.post("/{decision_id}/outcome")
async def update_outcome(
    decision_id: str,
    payload: OutcomeUpdate,
    current_user: dict = Depends(get_current_user),
):
    """
    Let the user mark a past decision as correct/incorrect/partial.
    This drives the AI Accuracy % the Decision History screen displays.
    """
    sb = get_supabase()
    allowed = {"correct", "incorrect", "partial", "pending"}
    if payload.outcome not in allowed:
        raise HTTPException(400, f"outcome must be one of: {', '.join(allowed)}")

    try:
        sb.table("ai_decisions").update({
            "outcome": payload.outcome,
            "outcome_note": payload.outcome_note,
        }).eq("id", decision_id).eq("user_id", current_user["user_id"]).execute()
        return {"updated": True}
    except Exception as e:
        raise HTTPException(500, f"Failed to update outcome: {e}")


@router.get("/accuracy")
async def get_accuracy(
    current_user: dict = Depends(get_current_user),
):
    """
    Overall AI accuracy: % of resolved decisions marked 'correct'.
    Only counts decisions where outcome != 'pending'.
    """
    sb = get_supabase()
    try:
        res = (
            sb.table("ai_decisions")
            .select("outcome")
            .eq("user_id", current_user["user_id"])
            .neq("outcome", "pending")
            .execute()
        )
        rows = res.data or []
        if not rows:
            return {"accuracy_pct": None, "total_resolved": 0}
        correct = sum(1 for r in rows if r["outcome"] == "correct")
        return {
            "accuracy_pct": round((correct / len(rows)) * 100),
            "total_resolved": len(rows),
            "correct": correct,
        }
    except Exception as e:
        raise HTTPException(500, f"Could not compute accuracy: {e}")
