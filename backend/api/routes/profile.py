from fastapi import APIRouter, Depends, HTTPException
from schemas.models import ProfileCreate, InjuryCreate, PRCreate
from core.security import get_current_user
from db.supabase_client import get_supabase
from typing import List

router = APIRouter(prefix="/profile", tags=["Profile"])


@router.get("/me", response_model=dict)
async def get_profile(current_user: dict = Depends(get_current_user)):
    sb = get_supabase()
    uid = current_user["user_id"]

    profile = sb.table("profiles").select("*").eq("id", uid).single().execute()
    injuries = sb.table("injury_profiles").select("*").eq("user_id", uid).execute()
    prs = sb.table("personal_records").select("*").eq("user_id", uid).execute()

    return {
        "profile": profile.data,
        "injuries": injuries.data,
        "personal_records": prs.data,
    }


@router.put("/me", response_model=dict)
async def update_profile(payload: ProfileCreate, current_user: dict = Depends(get_current_user)):
    sb = get_supabase()
    uid = current_user["user_id"]
    data = payload.model_dump()
    data["updated_at"] = "now()"
    res = sb.table("profiles").update(data).eq("id", uid).execute()
    return res.data[0] if res.data else {}


@router.post("/injuries", response_model=dict, status_code=201)
async def add_injury(payload: InjuryCreate, current_user: dict = Depends(get_current_user)):
    sb = get_supabase()
    data = payload.model_dump()
    data["user_id"] = current_user["user_id"]
    res = sb.table("injury_profiles").insert(data).execute()
    return res.data[0]


@router.delete("/injuries/{injury_id}")
async def delete_injury(injury_id: str, current_user: dict = Depends(get_current_user)):
    sb = get_supabase()
    sb.table("injury_profiles").delete().eq("id", injury_id).eq("user_id", current_user["user_id"]).execute()
    return {"deleted": injury_id}


@router.post("/prs", response_model=dict, status_code=201)
async def upsert_pr(payload: PRCreate, current_user: dict = Depends(get_current_user)):
    sb = get_supabase()
    data = payload.model_dump()
    data["user_id"] = current_user["user_id"]
    # Upsert — updates if exercise + reps combo already exists
    res = sb.table("personal_records").upsert(data, on_conflict="user_id,exercise_name,reps").execute()
    return res.data[0]


@router.get("/prs", response_model=List[dict])
async def get_prs(current_user: dict = Depends(get_current_user)):
    sb = get_supabase()
    res = sb.table("personal_records").select("*").eq("user_id", current_user["user_id"]).execute()
    return res.data