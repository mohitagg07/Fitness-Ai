"""
AI Coach route — chat endpoint backed by the LangGraph coach_agent.
main.py mounts this at prefix="/api/coach".

CHANGE: Injects prior_messages from conversation history into run_coach()
so the LLM has genuine session continuity without the user re-explaining context.
"""
import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from schemas.models import ChatMessage, ChatResponse

logger = logging.getLogger(__name__)
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


def _persist_coach_plan(user_id: str, blocks: dict) -> None:
    """
    Write a one-day workout_plans row so the dashboard shows the coach-
    generated workout type instead of "NO PLAN TODAY".

    The plan uses today's weekday key only — schedule = { "mon": type } etc.
    is_active is set to True and any previous row is deactivated first so
    the workout_agent always picks the most recent coach decision.
    """
    from datetime import date as _date
    from db.supabase_client import get_supabase as _get_sb

    DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    today_key = DAY_KEYS[_date.today().weekday()]

    # Derive a human-readable workout type from the blocks payload.
    # WorkoutCard has { type, intensity, duration_min, exercises: [...] }
    workout_type: str = (
        blocks.get("type")
        or blocks.get("workout_type")
        or "Training"
    )

    sb = _get_sb()
    # Deactivate any existing active plan for this user
    sb.table("workout_plans")       .update({"is_active": False})       .eq("user_id", user_id)       .eq("is_active", True)       .execute()

    # FIX: this insert was previously guaranteed to fail on every call —
    # it wrote a "source" column that doesn't exist in workout_plans, and
    # never provided "name", which the table defines as NOT NULL with no
    # default. Both problems caused Postgrest to reject the insert. Because
    # the caller (coach.py chat()/regenerate_workout()) wraps this in a
    # broad try/except that only logs, the failure was invisible — the
    # coach would generate a full workout plan, the chat card would show
    # it correctly, and the dashboard would still say "NO PLAN YET" because
    # workout_plans was never actually written. Now matches the real schema:
    # name (required), schedule, is_active. created_at has a DB default,
    # so it isn't set explicitly here either.
    display_name = workout_type.replace("_", " ").title()
    sb.table("workout_plans").insert({
        "user_id": user_id,
        "name": f"{display_name} — Coach Generated",
        "is_active": True,
        "schedule": {today_key: workout_type},
    }).execute()


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
        logger.exception(f"run_coach failed for user {user_id}: {e}")
        return JSONResponse(
            status_code=500,
            content={"detail": "VYRN couldn't process that right now. Please try again."},
        )

    try:
        await asyncio.to_thread(save_conversation_message, user_id, payload.session_id, "user", payload.content)
        await asyncio.to_thread(upsert_agent_state, user_id, result["updated_agent_state"])
        await asyncio.to_thread(save_conversation_message, user_id, payload.session_id, "assistant", result["reply"])

        # ── Persist generated workout to workout_plans so the dashboard
        # shows the type instead of "NO PLAN TODAY" ─────────────────────
        # When the coach generates a WorkoutCard the reply contains a type
        # (e.g. "Push", "Full Body"). Write that into workout_plans as the
        # today-only active schedule so workout_agent picks it up on the
        # next /mission/today or /dashboard/summary call.
        blocks = result.get("workout_blocks")
        if blocks:
            await asyncio.to_thread(_persist_coach_plan, user_id, blocks)
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
    try:
        sb = get_supabase()
        res = (
            sb.table("ai_conversations")
            .select("*")
            .eq("user_id", current_user["user_id"])
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return list(reversed(res.data or []))
    except Exception as e:
        logger.exception(f"get_history failed: {e}")
        return JSONResponse(status_code=500, content={"detail": "Could not load chat history."})


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
        logger.exception(f"regenerate_workout run_coach failed for {user_id}: {e}")
        return JSONResponse(
            status_code=500,
            content={"detail": "Couldn't regenerate workout right now. Please try again."},
        )

    try:
        await asyncio.to_thread(save_conversation_message, user_id, None, "user", regenerate_prompt)
        await asyncio.to_thread(upsert_agent_state, user_id, result["updated_agent_state"])
        await asyncio.to_thread(save_conversation_message, user_id, None, "assistant", result["reply"])
        await asyncio.to_thread(_log_timeline_event, user_id, "workout_generated", "Workout regenerated")
        regen_blocks = result.get("workout_blocks")
        if regen_blocks:
            await asyncio.to_thread(_persist_coach_plan, user_id, regen_blocks)
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

@router.get("/coach-timeline")
async def get_coach_timeline(
    current_user: dict = Depends(get_current_user),
):
    """
    Coach Timeline — assembles a chronological feed from:
      - personal_records (PRs achieved)
      - workout_sessions (milestones: streak starts, completions)
      - ai_timeline_events (AI decisions, rewrite triggers)
      - program_versions (program changes)

    Everything comes from tables that already exist and are already
    written to — this is assembly, not invention.
    Returned newest-first; the frontend reverses it for the timeline UI.
    """
    user_id = current_user["user_id"]
    sb = get_supabase()
    events = []

    # 1. PRs
    try:
        pr_res = (
            sb.table("personal_records")
            .select("exercise_name, weight_kg, reps, achieved_at")
            .eq("user_id", user_id)
            .order("achieved_at", desc=True)
            .limit(30)
            .execute()
        )
        for r in (pr_res.data or []):
            events.append({
                "type": "pr",
                "icon": "trophy",
                "color": "#FFD700",
                "title": f"PR — {r['exercise_name']}",
                "detail": f"{r['weight_kg']}kg × {r['reps']} reps",
                "date": r.get("achieved_at", ""),
            })
    except Exception:
        pass

    # 2. AI timeline events (decisions, rewrite triggers)
    try:
        tl_res = (
            sb.table("ai_timeline_events")
            .select("event_type, message, created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(30)
            .execute()
        )
        icon_map = {
            "workout_generated": ("barbell", "#FF9500"),
            "workout_completed": ("checkmark-circle", "#16EC06"),
            "recovery_changed": ("heart", "#FF2D55"),
            "nutrition_updated": ("nutrition", "#34C759"),
            "report_ready": ("document-text", "#5AC8FA"),
            "program_rewrite": ("git-branch", "#BF5AF2"),
        }
        for r in (tl_res.data or []):
            icon, color = icon_map.get(r.get("event_type", ""), ("flash", "#AEAEB2"))
            events.append({
                "type": r.get("event_type", "event"),
                "icon": icon,
                "color": color,
                "title": r.get("message", "AI Event"),
                "detail": None,
                "date": r.get("created_at", "")[:10],
            })
    except Exception:
        pass

    # 3. Program versions
    try:
        pv_res = (
            sb.table("program_versions")
            .select("version_number, trigger, explanation, created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(10)
            .execute()
        )
        for r in (pv_res.data or []):
            events.append({
                "type": "program_rewrite",
                "icon": "git-branch",
                "color": "#BF5AF2",
                "title": f"Program v{r['version_number']} — {r.get('trigger', 'rewrite').replace('_', ' ').title()}",
                "detail": r.get("explanation", "")[:100] + "…" if r.get("explanation") else None,
                "date": r.get("created_at", "")[:10],
            })
    except Exception:
        pass

    # Sort all events newest-first by date string (ISO format sorts correctly)
    events.sort(key=lambda e: e.get("date", ""), reverse=True)

    return {"timeline": events[:50]}


def _log_timeline_event(user_id: str, event_type: str, message: str):
    """Helper used by other routes/agents to append to ai_timeline_events."""
    try:
        sb = get_supabase()
        sb.table("ai_timeline_events").insert({
            "user_id": user_id,
            "event_type": event_type,
            "message": message,
        }).execute()
    except Exception as e:
        logger.error(f"Timeline event log failed for {user_id}: {e}")