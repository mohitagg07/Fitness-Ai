"""
FIX: Removed prefix="/coach" from APIRouter.
main.py already mounts this at prefix="/api/coach".
"""
from fastapi import APIRouter, Depends, HTTPException
from schemas.models import ChatMessage, ChatResponse
from core.security import get_current_user
from db.supabase_client import get_supabase
from agents.coach_agent import run_coach

# ✅ NO prefix here — main.py sets prefix="/api/coach"
router = APIRouter(tags=["AI Coach"])


@router.post("/chat", response_model=ChatResponse)
async def chat(
    payload: ChatMessage,
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    user_id = current_user["user_id"]

    # Save user message
    sb.table("ai_conversations").insert({
        "user_id": user_id,
        "session_id": payload.session_id,
        "role": "user",
        "content": payload.content,
    }).execute()

    try:
        result = await run_coach(user_id=user_id, message=payload.content)
    except Exception as e:
        raise HTTPException(500, f"AI Coach error: {str(e)}")

    # Save assistant reply
    sb.table("ai_conversations").insert({
        "user_id": user_id,
        "session_id": payload.session_id,
        "role": "assistant",
        "content": result.get("reply", ""),
    }).execute()

    return ChatResponse(**result)


@router.get("/history")
async def get_history(
    limit: int = 20,
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    res = (
        sb.table("ai_conversations")
        .select("*")
        .eq("user_id", current_user["user_id"])
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return list(reversed(res.data))