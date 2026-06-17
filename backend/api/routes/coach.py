"""
AI Coach route — chat endpoint backed by the LangGraph coach_agent.
main.py mounts this at prefix="/api/coach".
"""
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

    # Save user message
    save_conversation_message(user_id, payload.session_id, "user", payload.content)

    profile, agent_state = get_full_user_context(user_id)

    try:
        result = await run_coach(
            user_message=payload.content,
            user_id=user_id,
            user_profile=profile,
            agent_state=agent_state,
        )
    except Exception as e:
        raise HTTPException(500, f"AI Coach error: {str(e)}")

    # Persist the agent's updated fatigue/spinal-load state
    upsert_agent_state(user_id, result["updated_agent_state"])

    # Save assistant reply
    save_conversation_message(user_id, payload.session_id, "assistant", result["reply"])

    return ChatResponse(
        reply=result["reply"],
        guardrails_triggered=result["guardrails_triggered"],
        emergency=result["emergency"],
        cns_fatigue_score=result["cns_fatigue_score"],
        workout_blocks=result["workout_blocks"],
        new_prs=[],
        motivation_message=None,
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
