"""
Notifications Route — VYRN

  GET    /api/notifications              → list today's + recent notifications
  POST   /api/notifications/generate      → run the generator now (on-demand,
                                             also called nightly by the
                                             scheduler in production) and
                                             push any newly-saved ones to
                                             the user's device(s)
  PATCH  /api/notifications/{id}/read     → mark one as read
  POST   /api/notifications/read-all      → mark all as read
  POST   /api/notifications/push-token    → register this device's Expo push
                                             token so the scheduler's nightly
                                             job (and the on-demand generate
                                             above) can actually deliver a
                                             push instead of only writing a
                                             row the user has to go find
  DELETE /api/notifications/push-token    → unregister a device token (logout)
"""
import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.security import get_current_user
from db.supabase_client import get_supabase
from services.notifications import generate_notifications_for_user, save_notifications
from services.push import register_token, unregister_token, send_push_for_notifications

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Notifications"])


class PushTokenIn(BaseModel):
    token: str
    platform: str | None = None


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
        # Push only the newly-saved ones — save_notifications already
        # de-duplicates by type+day, so re-calling this endpoint (e.g. the
        # user pulls to refresh) never re-pushes something already sent.
        pushed = 0
        if saved:
            pushed = await asyncio.to_thread(send_push_for_notifications, user_id, saved)
        return {"generated": len(generated), "saved": saved, "pushed": pushed}
    except Exception as e:
        logger.exception(f"generate_notifications failed for {user_id}: {e}")
        raise HTTPException(500, f"Notification generation failed: {e}")


@router.post("/push-token")
async def add_push_token(
    body: PushTokenIn,
    current_user: dict = Depends(get_current_user),
):
    """
    Registers (or refreshes) this device's Expo push token. Call on every
    app foreground/login — it's a cheap upsert, not a one-time thing,
    since Expo can rotate a token and a stale one would silently stop
    receiving pushes.
    """
    try:
        row = await asyncio.to_thread(register_token, current_user["user_id"], body.token, body.platform)
        return {"registered": True, "token": row.get("token")}
    except Exception as e:
        logger.exception(f"add_push_token failed for {current_user['user_id']}: {e}")
        raise HTTPException(500, f"Could not register push token: {e}")


@router.delete("/push-token")
async def remove_push_token(
    body: PushTokenIn,
    current_user: dict = Depends(get_current_user),
):
    """Unregisters a device token — call on logout so a shared/reset device
    doesn't keep receiving a previous user's pushes."""
    try:
        await asyncio.to_thread(unregister_token, current_user["user_id"], body.token)
        return {"unregistered": True}
    except Exception as e:
        raise HTTPException(500, f"Could not unregister push token: {e}")


@router.patch("/{notification_id}/read")
async def mark_read(
    notification_id: str,
    current_user: dict = Depends(get_current_user),
):
    sb = get_supabase()
    try:
        res = (
            sb.table("notifications")
            .update({"read": True})
            .eq("id", notification_id)
            .eq("user_id", current_user["user_id"])
            .select("id, read")
            .execute()
        )
        if not res.data:
            raise HTTPException(404, "Notification not found")
        return {"updated": True, "notification": res.data[0]}
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