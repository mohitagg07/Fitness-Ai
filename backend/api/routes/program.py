"""
Program Rewriter + Program Evolution Routes — VYRN

Backs:
  - GET  /api/program/versions   → ProgramEvolution UI (version chip row)
  - POST /api/program/rewrite    → trigger adaptive rewrite on demand
  - GET  /api/program/latest     → what changed in the most recent version
"""
import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException

from core.security import get_current_user
from db.supabase_client import get_supabase, get_full_user_context
from agents.program_rewriter import run_program_rewriter

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Program Evolution"])


@router.get("/versions")
async def list_versions(
    limit: int = 10,
    current_user: dict = Depends(get_current_user),
):
    """
    Return program version history for the Program Evolution UI.
    Each version has a version_number, trigger, explanation, and changes list.
    """
    sb = get_supabase()
    try:
        res = (
            sb.table("program_versions")
            .select("id, version_number, trigger, explanation, changes, created_at")
            .eq("user_id", current_user["user_id"])
            .order("version_number", desc=True)
            .limit(limit)
            .execute()
        )
        return {"versions": res.data or []}
    except Exception as e:
        raise HTTPException(500, f"Could not load program versions: {e}")


@router.post("/rewrite")
async def trigger_rewrite(
    current_user: dict = Depends(get_current_user),
):
    """
    Run the adaptive program rewriter now. Returns the rewrite result.
    Safe to call multiple times — if no rewrite is needed it returns
    rewrite_triggered=False without writing anything.
    """
    user_id = current_user["user_id"]
    try:
        profile, _ = await asyncio.to_thread(get_full_user_context, user_id)
        result = await asyncio.to_thread(run_program_rewriter, user_id, profile)
        return result
    except Exception as e:
        raise HTTPException(500, f"Program rewriter error: {e}")


@router.get("/latest")
async def get_latest_version(
    current_user: dict = Depends(get_current_user),
):
    """What changed in the most recent program version, for the dashboard card."""
    sb = get_supabase()
    try:
        res = (
            sb.table("program_versions")
            .select("version_number, trigger, explanation, changes, created_at")
            .eq("user_id", current_user["user_id"])
            .order("version_number", desc=True)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0] if rows else {"version_number": 0, "trigger": None, "explanation": None, "changes": []}
    except Exception as e:
        raise HTTPException(500, f"Could not load latest version: {e}")
