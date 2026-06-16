"""
FIX: Removed prefix="/auth" from APIRouter.
main.py already mounts this at prefix="/api/auth".
Having prefix="/auth" here too caused /api/auth/auth/register → 404.
"""
from fastapi import APIRouter, HTTPException, status
from schemas.models import RegisterRequest, LoginRequest, TokenResponse
from core.security import create_access_token
from db.supabase_client import get_supabase

# ✅ NO prefix here — main.py sets prefix="/api/auth"
router = APIRouter(tags=["Authentication"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest):
    sb = get_supabase()
    try:
        res = sb.auth.sign_up({"email": payload.email, "password": payload.password})
        user = res.user
        if not user:
            raise HTTPException(400, "Registration failed — no user returned")

        # Create profile stub in public.profiles
        sb.table("profiles").insert({
            "id": user.id,
            "full_name": payload.full_name,
        }).execute()

        token = create_access_token({"sub": user.id, "email": user.email})
        return TokenResponse(access_token=token, user_id=user.id)

    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        if "already registered" in error_msg.lower() or "already exists" in error_msg.lower():
            raise HTTPException(400, "Email already registered. Please log in.")
        raise HTTPException(400, f"Registration failed: {error_msg}")


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest):
    sb = get_supabase()
    try:
        res = sb.auth.sign_in_with_password({"email": payload.email, "password": payload.password})
        user = res.user
        if not user:
            raise HTTPException(401, "Invalid credentials")
        token = create_access_token({"sub": user.id, "email": user.email})
        return TokenResponse(access_token=token, user_id=user.id)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(401, "Invalid email or password")