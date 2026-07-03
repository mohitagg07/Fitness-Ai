"""
Push Delivery — VYRN

The missing piece in the "AI notifies user" story. services/notifications.py
already builds real, data-driven notification payloads and save_notifications()
persists them to the `notifications` table — but until this module, nothing
ever left the server. A user only saw a notification if they opened the app
and pulled the in-app list, which defeats the entire point of a proactive
coach: the whole roadmap ask was "the AI notifies the user", not "the AI
waits by the door."

This module sends those same payloads to the user's device(s) via the Expo
Push API (https://exp.host/--/api/v2/push/send), which is the standard
delivery mechanism for Expo/React Native apps and requires no APNs/FCM
credentials of our own — Expo's push service handles that translation.

Design choices:
  - Batches of 100 messages per request (Expo's documented limit).
  - A user can have multiple device tokens (phone + tablet, reinstall);
    every token on file gets the push.
  - DeviceNotRegistered errors mean the token is dead (uninstalled, or
    replaced by a new install) — those rows are deleted so future sends
    don't keep paying for a dead token.
  - Never raises out to the caller: a push failure must not break
    notification generation or the nightly scheduler job. Errors are
    logged and swallowed, same pattern as the rest of scheduler.py.
"""
from __future__ import annotations
import logging
import httpx

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
BATCH_SIZE = 100


def _get_tokens_for_user(user_id: str) -> list[dict]:
    from db.supabase_client import get_supabase
    sb = get_supabase()
    try:
        res = (
            sb.table("push_tokens")
            .select("id, token, platform")
            .eq("user_id", user_id)
            .execute()
        )
        return res.data or []
    except Exception as e:
        logger.warning(f"push: failed to load tokens for {user_id}: {e}")
        return []


def _delete_dead_token(token_id: str) -> None:
    from db.supabase_client import get_supabase
    sb = get_supabase()
    try:
        sb.table("push_tokens").delete().eq("id", token_id).execute()
    except Exception as e:
        logger.warning(f"push: failed to delete dead token {token_id}: {e}")


def register_token(user_id: str, token: str, platform: str | None = None) -> dict:
    """Upserts a device's Expo push token for a user. Safe to call on every
    app open — re-registering the same token just refreshes updated_at."""
    from datetime import datetime, timezone
    from db.supabase_client import get_supabase
    sb = get_supabase()
    row = {
        "user_id": user_id,
        "token": token,
        "platform": platform,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    res = sb.table("push_tokens").upsert(row, on_conflict="token").execute()
    return (res.data or [row])[0]


def unregister_token(user_id: str, token: str) -> None:
    """Removes a device token — call on logout so a signed-out device stops
    receiving pushes meant for whoever logs in next on that device."""
    from db.supabase_client import get_supabase
    sb = get_supabase()
    sb.table("push_tokens").delete().eq("user_id", user_id).eq("token", token).execute()


def send_push_for_notifications(user_id: str, notifications: list[dict]) -> int:
    """
    Sends each already-generated notification dict (the same shape
    save_notifications() persists: type/title/body/priority/cta/data) to
    every device on file for this user. Returns count of receipts sent
    (not necessarily delivered — Expo returns delivery receipts async,
    which this project doesn't poll for, matching its scope elsewhere:
    fire real content, don't build a receipt-reconciliation pipeline for
    a personal project's push layer).
    """
    if not notifications:
        return 0

    tokens = _get_tokens_for_user(user_id)
    if not tokens:
        return 0

    messages = []
    for t in tokens:
        for n in notifications:
            messages.append({
                "to": t["token"],
                "title": n["title"],
                "body": n["body"],
                "priority": "high" if n.get("priority") == "high" else "default",
                "data": {"cta": n.get("cta"), "type": n.get("type"), **(n.get("data") or {})},
                "_token_id": t["id"],  # stripped before sending, used to map dead-token cleanup
            })

    sent = 0
    for i in range(0, len(messages), BATCH_SIZE):
        batch = messages[i:i + BATCH_SIZE]
        payload = [{k: v for k, v in m.items() if k != "_token_id"} for m in batch]
        try:
            resp = httpx.post(
                EXPO_PUSH_URL,
                json=payload,
                headers={
                    "Accept": "application/json",
                    "Accept-Encoding": "gzip, deflate",
                    "Content-Type": "application/json",
                },
                timeout=10.0,
            )
            resp.raise_for_status()
            tickets = resp.json().get("data", [])
            for ticket, msg in zip(tickets, batch):
                if ticket.get("status") == "error":
                    err_type = (ticket.get("details") or {}).get("error")
                    logger.warning(f"push: send failed for token {msg['to'][:20]}...: {ticket.get('message')}")
                    if err_type == "DeviceNotRegistered":
                        _delete_dead_token(msg["_token_id"])
                else:
                    sent += 1
        except Exception as e:
            logger.warning(f"push: batch send failed ({len(batch)} messages): {e}")

    return sent
