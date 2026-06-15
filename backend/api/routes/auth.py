from fastapi import APIRouter, HTTPException, status
from schemas.models import RegisterRequest, LoginRequest, TokenResponse
from core.security import create_access_token, hash_password, verify_password
from db.supabase_client import get_supabase

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest):
    sb = get_supabase()
    try:
        res = sb.auth.sign_up({"email": payload.email, "password": payload.password})
        user = res.user
        if not user:
            raise HTTPException(400, "Registration failed")

        # Create profile stub
        sb.table("profiles").insert({
            "id": user.id,
            "full_name": payload.full_name,
        }).execute()

        token = create_access_token({"sub": user.id, "email": user.email})
        return TokenResponse(access_token=token, user_id=user.id)
    except Exception as e:
        raise HTTPException(400, str(e))


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
    except Exception as e:
        raise HTTPException(401, "Invalid email or password")
