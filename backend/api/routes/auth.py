"""
backend/api/routes/auth.py — NeuroFit AI Authentication
"""
import asyncio
import logging
from fastapi import APIRouter, HTTPException, status, Depends
from schemas.models import RegisterRequest, LoginRequest, TokenResponse
from core.security import create_access_token, get_current_user
from db.supabase_client import get_supabase

router = APIRouter(tags=["Authentication"])
logger = logging.getLogger(__name__)

_SUPABASE_TIMEOUT = 10


def _check_supabase_env():
    try:
        return get_supabase()
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth service not configured — check SUPABASE_URL and SUPABASE_SERVICE_KEY in backend/.env",
        ) from e


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest):
    sb = _check_supabase_env()

    # Step 1: Create user in Supabase Auth
    try:
        res = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(
                None,
                lambda: sb.auth.sign_up(
                    {"email": payload.email, "password": payload.password}
                ),
            ),
            timeout=_SUPABASE_TIMEOUT,
        )
    except asyncio.TimeoutError:
        raise HTTPException(503, "Auth service timed out. Check your Supabase project is active.")
    except Exception as e:
        err = str(e).lower()
        if "already registered" in err or "already exists" in err:
            raise HTTPException(400, "Email already registered. Please log in.")
        raise HTTPException(400, f"Registration failed: {e}")

    user = res.user

    # Supabase returns user=None when email confirmation is enabled.
    # In that case, try sign_in_with_password immediately to get the user object.
    # If that also fails, the account needs email confirmation — surface a clear message.
    if not user:
        try:
            login_res = await asyncio.wait_for(
                asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: sb.auth.sign_in_with_password(
                        {"email": payload.email, "password": payload.password}
                    ),
                ),
                timeout=_SUPABASE_TIMEOUT,
            )
            user = login_res.user
        except Exception:
            pass

    if not user:
        raise HTTPException(
            400,
            "Registration requires email confirmation. "
            "Please check your inbox and confirm your email, then log in. "
            "Or disable email confirmation in your Supabase project: "
            "Authentication → Providers → Email → toggle off 'Confirm email'."
        )

    # Step 2: Create profile row. This MUST succeed for the app to work —
    # every other table FK-references profiles.id. Log the error clearly
    # instead of silently swallowing it.
    try:
        await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(
                None,
                lambda: sb.table("profiles")
                .upsert({"id": user.id, "full_name": payload.full_name, "onboarding_complete": False})
                .execute(),
            ),
            timeout=_SUPABASE_TIMEOUT,
        )
    except asyncio.TimeoutError:
        logger.warning(f"Profile insert timed out for user {user.id} — will retry on first /profile/me call")
    except Exception as e:
        logger.error(f"Profile insert failed for user {user.id}: {e}")
        # Don't block registration — /profile/me auto-creates it on first call

    token = create_access_token({"sub": user.id, "email": user.email})
    return TokenResponse(access_token=token, user_id=user.id)


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest):
    sb = _check_supabase_env()

    try:
        res = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(
                None,
                lambda: sb.auth.sign_in_with_password(
                    {"email": payload.email, "password": payload.password}
                ),
            ),
            timeout=_SUPABASE_TIMEOUT,
        )
    except asyncio.TimeoutError:
        raise HTTPException(503, "Auth service timed out.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(401, "Invalid email or password.")

    user = res.user
    if not user:
        raise HTTPException(401, "Invalid credentials.")

    token = create_access_token({"sub": user.id, "email": user.email})
    return TokenResponse(access_token=token, user_id=user.id)


@router.get("/verify")
async def verify_token(current_user: dict = Depends(get_current_user)):
    return {"valid": True, "user_id": current_user["user_id"]}