from fastapi import APIRouter, Depends, HTTPException
from schemas.models import ChatMessage, ChatResponse
from core.security import get_current_user
from db.supabase_client import get_supabase
from agents.coach_agent import run_coach
from services.pr_validator import validate_logged_weight

router = APIRouter(prefix="/coach", tags=["AI Coach"])


async def _load_user_context(user_id: str) -> tuple[dict, dict]:
    """Load user profile + injuries + PRs + agent state from Supabase."""
    sb = get_supabase()

    profile_res = sb.table("profiles").select("*").eq("id", user_id).single().execute()
    injuries_res = sb.table("injury_profiles").select("*").eq("user_id", user_id).execute()
    prs_res = sb.table("personal_records").select("*").eq("user_id", user_id).execute()
    state_res = sb.table("agent_states").select("*").eq("user_id", user_id).execute()

    profile = profile_res.data or {}
    profile["injuries"] = injuries_res.data or []
    profile["personal_records"] = {
        row["exercise_name"]: row["weight_kg"]
        for row in (prs_res.data or [])
    }

    agent_state = state_res.data[0] if state_res.data else {
        "user_id": user_id,
        "cns_fatigue_score": 0,
        "accumulated_spinal_load": 0,
        "last_session_date": None,
        "active_muscle_groups": [],
        "last_logged_rpe": 5.0,
        "current_phase": profile.get("goal", "maintain"),
    }

    return profile, agent_state


async def _save_agent_state(user_id: str, updated_state: dict):
    """Persist updated agent state back to Supabase."""
    sb = get_supabase()
    updated_state["user_id"] = user_id
    updated_state["updated_at"] = "now()"
    sb.table("agent_states").upsert(updated_state, on_conflict="user_id").execute()


async def _save_conversation(user_id: str, session_id: str | None, role: str, content: str):
    sb = get_supabase()
    sb.table("ai_conversations").insert({
        "user_id": user_id,
        "session_id": session_id,
        "role": role,
        "content": content,
    }).execute()


@router.post("/chat", response_model=ChatResponse)
async def chat(payload: ChatMessage, current_user: dict = Depends(get_current_user)):
    """
    Main AI coach endpoint. Accepts natural language input.
    Examples:
    - "Give me today's chest workout"
    - "I deadlifted 150kg x 3 with straps, felt like RPE 9"
    - "I have shoulder pain today"
    - "Only 30 minutes today, what should I do?"
    """
    uid = current_user["user_id"]
    user_profile, agent_state = await _load_user_context(uid)

    # Save user message to history
    await _save_conversation(uid, payload.session_id, "user", payload.content)

    # Run the LangGraph coach
    result = await run_coach(
        user_message=payload.content,
        user_id=uid,
        user_profile=user_profile,
        agent_state=agent_state,
    )

    # Validate any logged weights against PRs (anti-hallucination)
    prs = user_profile.get("personal_records", {})
    new_prs = []
    for log in result.get("parsed_logs", []):
        validation = validate_logged_weight(
            log.get("exercise_name", ""),
            log.get("weight_kg", 0),
            prs,
        )
        if validation.get("pr_broken"):
            new_prs.append(validation)
            # Auto-update PR in DB
            sb = get_supabase()
            sb.table("personal_records").upsert({
                "user_id": uid,
                "exercise_name": log["exercise_name"],
                "weight_kg": log["weight_kg"],
                "reps": log.get("reps_completed", 1),
            }, on_conflict="user_id,exercise_name,reps").execute()

    # Save agent state
    if result.get("updated_agent_state"):
        await _save_agent_state(uid, result["updated_agent_state"])

    # Save assistant reply to history
    await _save_conversation(uid, payload.session_id, "assistant", result["reply"])

    return ChatResponse(
        reply=result["reply"],
        guardrails_triggered=result["guardrails_triggered"],
        emergency=result["emergency"],
        cns_fatigue_score=result["cns_fatigue_score"],
        workout_blocks=result["workout_blocks"],
    )


@router.get("/history")
async def get_history(limit: int = 20, current_user: dict = Depends(get_current_user)):
    sb = get_supabase()
    res = (
        sb.table("ai_conversations")
        .select("*")
        .eq("user_id", current_user["user_id"])
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data
