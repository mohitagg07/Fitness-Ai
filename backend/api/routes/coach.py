"""
AI Coach route — chat endpoint backed by the LangGraph coach_agent.
main.py mounts this at prefix="/api/coach".
"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException
from schemas.models import ChatMessage, ChatResponse
from core.security import get_current_user
from db.supabase_client import (
    get_supabase,
    get_full_user_context,
    upsert_agent_state,
    save_conversation_message,
)
from agents.coach_agent import run_coach

router = APIRouter(tags=["AI Coach"])


@router.post("/chat", response_model=ChatResponse)
async def chat(
    payload: ChatMessage,
    current_user: dict = Depends(get_current_user)
):
    user_id = current_user["user_id"]

    profile, agent_state = await asyncio.to_thread(get_full_user_context, user_id)

    # Fetch last 10 conversation turns so coach has real session memory
    # and responds based on this user's history, not generically.
    try:
        sb = get_supabase()
        history_res = (
            sb.table("ai_conversations")
            .select("role,content")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(10)
            .execute()
        )
        prior_messages = list(reversed(history_res.data or []))
    except Exception:
        prior_messages = []

    try:
        result = await run_coach(
            user_message=payload.content,
            user_id=user_id,
            user_profile=profile,
            agent_state=agent_state,
            prior_messages=prior_messages,
        )
    except Exception as e:
        raise HTTPException(500, f"AI Coach error: {str(e)}")

    try:
        await asyncio.to_thread(save_conversation_message, user_id, payload.session_id, "user", payload.content)
        await asyncio.to_thread(upsert_agent_state, user_id, result["updated_agent_state"])
        await asyncio.to_thread(save_conversation_message, user_id, payload.session_id, "assistant", result["reply"])
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Failed to persist coach conversation for user {user_id}: {e}")

    return ChatResponse(
        reply=result["reply"],
        guardrails_triggered=result["guardrails_triggered"],
        emergency=result["emergency"],
        cns_fatigue_score=result["cns_fatigue_score"],
        workout_blocks=result["workout_blocks"],
        new_prs=[],
        motivation_message=None,
        structured_decision=result.get("structured_decision"),
    )


@router.get("/history")
async def get_history(
    limit: int = 20,
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    res = (
        sb.table("ai_conversations")
        .select("role,content,created_at")
        .eq("user_id", current_user["user_id"])
        .order("created_at", desc=False)
        .limit(limit)
        .execute()
    )
    return res.data