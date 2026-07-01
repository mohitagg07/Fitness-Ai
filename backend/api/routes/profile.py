"""
FIX: Removed prefix="/profile" from APIRouter.
main.py already mounts this at prefix="/api/profile".
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from datetime import datetime, timezone
from schemas.models import ProfileCreate, ProfileUpdate, InjuryCreate, PRCreate
from core.security import get_current_user
from db.supabase_client import get_supabase
from typing import List
import uuid

# ✅ NO prefix here — main.py sets prefix="/api/profile"
router = APIRouter(tags=["Profile"])

AVATAR_BUCKET = "avatars"
ALLOWED_AVATAR_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
MAX_AVATAR_BYTES = 5 * 1024 * 1024  # 5MB


@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    sb = get_supabase()
    user_id = current_user["user_id"]

    profile_res = sb.table("profiles").select("*").eq("id", user_id).execute()
    injuries_res = sb.table("injury_profiles").select("*").eq("user_id", user_id).execute()
    prs_res = sb.table("personal_records").select("*").eq("user_id", user_id).execute()

    return {
        "profile": profile_res.data[0] if profile_res.data else {},
        "injuries": injuries_res.data or [],
        "personal_records": prs_res.data or [],
    }


@router.put("/me")
async def update_me(
    payload: ProfileUpdate,
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(400, "No fields to update")
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = (
        sb.table("profiles")
        .update(data)
        .eq("id", current_user["user_id"])
        .execute()
    )
    return res.data[0] if res.data else {}


@router.post("/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """
    Uploads a profile photo to Supabase Storage (bucket: 'avatars') and
    saves the resulting public URL on the user's profile row.

    Requires a public 'avatars' bucket to exist in the Supabase project
    (Storage → New Bucket → name "avatars" → Public bucket = ON).
    """
    if file.content_type not in ALLOWED_AVATAR_TYPES:
        raise HTTPException(400, "Avatar must be a JPEG, PNG, or WEBP image")

    body = await file.read()
    if len(body) > MAX_AVATAR_BYTES:
        raise HTTPException(400, "Avatar must be smaller than 5MB")

    sb = get_supabase()
    user_id = current_user["user_id"]
    ext = ALLOWED_AVATAR_TYPES[file.content_type]
    # Unique path per upload so CDN/client caches never serve a stale photo
    path = f"{user_id}/{uuid.uuid4().hex}.{ext}"

    try:
        sb.storage.from_(AVATAR_BUCKET).upload(
            path,
            body,
            {"content-type": file.content_type, "upsert": "true"},
        )
    except Exception as e:
        raise HTTPException(502, f"Avatar upload failed: {e}")

    public_url = sb.storage.from_(AVATAR_BUCKET).get_public_url(path)

    res = (
        sb.table("profiles")
        .update({"avatar_url": public_url, "updated_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", user_id)
        .execute()
    )
    return {"avatar_url": public_url, "profile": res.data[0] if res.data else {}}


@router.post("/onboard", status_code=201)
async def onboard(
    payload: ProfileCreate,
    current_user: dict = Depends(get_current_user)
):
    """Full onboarding — upserts profile and marks onboarding_complete=True."""
    sb = get_supabase()
    user_id = current_user["user_id"]
    data = payload.model_dump()
    data["id"] = user_id
    data["onboarding_complete"] = True
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = sb.table("profiles").upsert(data, on_conflict="id").execute()
    return res.data[0] if res.data else {}


@router.post("/injuries", status_code=201)
async def add_injury(
    payload: InjuryCreate,
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    data = payload.model_dump()
    data["user_id"] = current_user["user_id"]
    res = sb.table("injury_profiles").insert(data).execute()
    return res.data[0]


@router.delete("/injuries/{injury_id}")
async def delete_injury(
    injury_id: str,
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    sb.table("injury_profiles").delete().eq("id", injury_id).eq("user_id", current_user["user_id"]).execute()
    return {"deleted": injury_id}


@router.post("/prs")
async def upsert_pr(
    payload: PRCreate,
    current_user: dict = Depends(get_current_user)
):
    sb = get_supabase()
    data = payload.model_dump()
    data["user_id"] = current_user["user_id"]
    if data.get("achieved_at"):
        data["achieved_at"] = str(data["achieved_at"])
    res = sb.table("personal_records").upsert(
        data, on_conflict="user_id,exercise_name,reps"
    ).execute()
    return res.data[0] if res.data else {}


@router.get("/prs")
async def get_prs(current_user: dict = Depends(get_current_user)):
    sb = get_supabase()
    res = (
        sb.table("personal_records")
        .select("*")
        .eq("user_id", current_user["user_id"])
        .order("achieved_at", desc=True)
        .execute()
    )
    return res.data