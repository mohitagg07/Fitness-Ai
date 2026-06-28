"""
AI Coach route — chat endpoint backed by the LangGraph coach_agent.
main.py mounts this at prefix="/api/coach".

CHANGE: Injects prior_messages from conversation history into run_coach()
so the LLM has genuine session continuity without the user re-explaining context.
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


def _load_prior_messages(user_id: str, limit: int = 10) -> list:
    """Load recent conversation turns to inject as context for the LLM."""
    try:
        sb = get_supabase()
        res = (
            sb.table("ai_conversations")
            .select("role,content")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        # Reverse so oldest-first, which is the natural conversation order
        return list(reversed(res.data or []))
    except Exception:
        return []


@router.post("/chat", response_model=ChatResponse)
async def chat(
    payload: ChatMessage,
    current_user: dict = Depends(get_current_user)
):
    user_id = current_user["user_id"]

    profile, agent_state = await asyncio.to_thread(get_full_user_context, user_id)

    # Load prior conversation for context injection
    prior_messages = await asyncio.to_thread(_load_prior_messages, user_id, 10)

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
        .select("*")
        .eq("user_id", current_user["user_id"])
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return list(reversed(res.data))
