"""
Notifications Route — VYRN

  GET    /api/notifications              → list today's + recent notifications
  POST   /api/notifications/generate      → run the generator now (on-demand,
                                             also called nightly by the
                                             scheduler in production)
  PATCH  /api/notifications/{id}/read     → mark one as read
  POST   /api/notifications/read-all      → mark all as read
"""
import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException

from core.security import get_current_user
from db.supabase_client import get_supabase
from services.notifications import generate_notifications_for_user, save_notifications

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Notifications"])


@router.get("/")
async def list_notifications(
    limit: int = 20,
    current_user: dict = Depends(get_current_user),
):
    sb = get_supabase()
    try:
        res = (
            sb.table("notifications")
            .select("*")
            .eq("user_id", current_user["user_id"])
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        rows = res.data or []
        unread_count = sum(1 for r in rows if not r.get("read"))
        return {"notifications": rows, "unread_count": unread_count}
    except Exception as e:
        raise HTTPException(500, f"Could not load notifications: {e}")


@router.post("/generate")
async def generate_notifications(
    current_user: dict = Depends(get_current_user),
):
    """
    Runs the intelligent notification generator now for the current user
    and persists any new ones. Safe to call repeatedly — save_notifications
    skips duplicates for the same type+day.
    """
    user_id = current_user["user_id"]
    try:
        generated = await asyncio.to_thread(generate_notifications_for_user, user_id)
        saved = await asyncio.to_thread(save_notifications, user_id, generated)
        return {"generated": len(generated), "saved": saved}
    except Exception as e:
        logger.exception(f"generate_notifications failed for {user_id}: {e}")
        raise HTTPException(500, f"Notification generation failed: {e}")


@router.patch("/{notification_id}/read")
async def mark_read(
    notification_id: str,
    current_user: dict = Depends(get_current_user),
):
    sb = get_supabase()
    try:
        sb.table("notifications").update({"read": True}).eq(
            "id", notification_id
        ).eq("user_id", current_user["user_id"]).execute()
        return {"updated": True}
    except Exception as e:
        raise HTTPException(500, f"Failed to mark notification read: {e}")


@router.post("/read-all")
async def mark_all_read(
    current_user: dict = Depends(get_current_user),
):
    sb = get_supabase()
    try:
        sb.table("notifications").update({"read": True}).eq(
            "user_id", current_user["user_id"]
        ).eq("read", False).execute()
        return {"updated": True}
    except Exception as e:
        raise HTTPException(500, f"Failed to mark all read: {e}")