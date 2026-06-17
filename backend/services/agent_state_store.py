"""
Agent State Store — single source of truth for the persisted AgentState row.
Every agent (coach, nutrition, workout, progress, recovery) reads and writes
through this module so fatigue/streak/phase data never drifts out of sync.
"""
from db.supabase_client import get_supabase
from schemas.models import AgentState


def get_agent_state(user_id: str) -> dict:
    sb = get_supabase()
    res = sb.table("agent_states").select("*").eq("user_id", user_id).execute()
    if res.data:
        return res.data[0]
    # First touch — create the default row
    default = AgentState(user_id=user_id).model_dump()
    default.pop("user_id")
    default["user_id"] = user_id
    created = sb.table("agent_states").upsert(default, on_conflict="user_id").execute()
    return created.data[0] if created.data else default


def save_agent_state(user_id: str, state: dict) -> dict:
    sb = get_supabase()
    data = {**state, "user_id": user_id, "updated_at": "now()"}
    # Strip fields that aren't real columns (e.g. accidental extras from agent_state dict)
    allowed = {
        "user_id", "cns_fatigue_score", "accumulated_spinal_load", "last_session_date",
        "active_muscle_groups", "last_logged_rpe", "current_phase",
        "consecutive_high_rpe_days", "weekly_session_count", "workout_streak",
        "protein_streak", "total_workouts", "updated_at",
    }
    data = {k: v for k, v in data.items() if k in allowed}
    res = sb.table("agent_states").upsert(data, on_conflict="user_id").execute()
    return res.data[0] if res.data else data


def get_full_user_context(user_id: str) -> dict:
    """
    Assembles the profile + injuries + PRs + agent_state bundle that every
    agent needs as context — one call instead of four scattered queries.
    """
    sb = get_supabase()
    profile_res = sb.table("profiles").select("*").eq("id", user_id).execute()
    injuries_res = sb.table("injury_profiles").select("*").eq("user_id", user_id).execute()
    prs_res = sb.table("personal_records").select("*").eq("user_id", user_id).execute()

    profile = profile_res.data[0] if profile_res.data else {}
    prs = {p["exercise_name"]: p["weight_kg"] for p in (prs_res.data or [])}

    return {
        **profile,
        "injuries": injuries_res.data or [],
        "personal_records": prs,
        "agent_state": get_agent_state(user_id),
    }
