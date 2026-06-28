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


@router.post("/regenerate-workout", response_model=ChatResponse)
async def regenerate_workout(
    current_user: dict = Depends(get_current_user)
):
    """
    "Regenerate" action button on WorkoutCard. Deliberately NOT a separate
    template/codepath from /chat — it runs the exact same run_coach()
    pipeline (same profile injection, same weight caps from real PRs, same
    fatigue-aware system prompt, same guardrails) with an explicit
    instruction to produce a *different* plan than whatever was last
    generated. This guarantees the regenerated workout is just as
    profile-aware as a normal chat-requested one, never a canned fallback.
    """
    user_id = current_user["user_id"]
    profile, agent_state = await asyncio.to_thread(get_full_user_context, user_id)
    prior_messages = await asyncio.to_thread(_load_prior_messages, user_id, 10)

    regenerate_prompt = (
        "Regenerate today's workout. Give me a different exercise selection "
        "than whatever you last suggested — same training goal and fatigue "
        "constraints, but vary the exercises, order, or rep scheme so this "
        "feels like a genuinely new plan, not the same one repeated."
    )

    try:
        result = await run_coach(
            user_message=regenerate_prompt,
            user_id=user_id,
            user_profile=profile,
            agent_state=agent_state,
            prior_messages=prior_messages,
        )
    except Exception as e:
        raise HTTPException(500, f"AI Coach error: {str(e)}")

    try:
        await asyncio.to_thread(save_conversation_message, user_id, None, "user", regenerate_prompt)
        await asyncio.to_thread(upsert_agent_state, user_id, result["updated_agent_state"])
        await asyncio.to_thread(save_conversation_message, user_id, None, "assistant", result["reply"])
        await asyncio.to_thread(_log_timeline_event, user_id, "workout_generated", "Workout regenerated")
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Failed to persist regenerated workout for {user_id}: {e}")

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


@router.get("/timeline")
async def get_timeline(
    limit: int = 15,
    current_user: dict = Depends(get_current_user)
):
    """
    Compact feed of recent AI decisions for the Dashboard's "AI Timeline"
    card. Reads ai_timeline_events, which agents/routes write to directly
    as each decision happens (see _log_timeline_event in workouts.py and
    the write here in regenerate_workout) — this endpoint only reads, it
    never invents events that didn't actually happen.
    """
    sb = get_supabase()
    res = (
        sb.table("ai_timeline_events")
        .select("event_type, message, created_at")
        .eq("user_id", current_user["user_id"])
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return {"events": res.data or []}


@router.get("/memory")
async def get_coach_memory(
    current_user: dict = Depends(get_current_user)
):
    """
    Backs the "Coach Memory Panel." Deliberately built ONLY from data that
    genuinely exists and is genuinely used elsewhere in the app — never
    invented placeholder preferences:
      - goal / experience_level / workout_time_preference / equipment come
        straight from `profiles`, the same row /profile/me returns and
        onboarding writes to.
      - injuries come from `injury_profiles`, the same table the Profile
        screen and the coach's safety-guardrail system both read.
      - freeform facts come from recall_all() against the real ChromaDB
        user-memory collection the coach agent's recall_memory_node
        queries on every chat turn — so what's shown here is exactly what
        the coach actually has access to, not a separate display-only copy.
    """
    user_id = current_user["user_id"]
    profile, _ = await asyncio.to_thread(get_full_user_context, user_id)

    sb = get_supabase()
    injuries_res = await asyncio.to_thread(
        lambda: sb.table("injury_profiles").select("body_part, issue_type, severity").eq("user_id", user_id).execute()
    )
    injuries = injuries_res.data or []

    try:
        from db.memory_client import recall_all
        freeform_memories = await asyncio.to_thread(recall_all, user_id)
    except Exception:
        freeform_memories = []

    return {
        "known_preferences": {
            "goal": profile.get("goal"),
            "experience_level": profile.get("experience_level"),
            "workout_time_preference": profile.get("workout_time_preference"),
            "equipment": profile.get("equipment") or [],
            "food_preference": profile.get("food_preference"),
        },
        "injuries": [
            {
                "body_part": i.get("body_part"),
                "issue_type": i.get("issue_type"),
                "severity": i.get("severity"),
            }
            for i in injuries
        ],
        "freeform_memories": freeform_memories,
    }