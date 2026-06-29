"""
backend/api/routes/auth.py
VYRN — Authentication routes

Fix applied: sb.auth calls now run inside asyncio.wait_for() so a Supabase
network hang surfaces as a clean 503 instead of a raw timeout traceback that
was being caught by the broad `except Exception` and re-raised as a
confusing 400 "Registration failed: The read operation timed out".
"""
import asyncio
from fastapi import APIRouter, HTTPException, status
from schemas.models import RegisterRequest, LoginRequest, TokenResponse
from core.security import create_access_token
from db.supabase_client import get_supabase

router = APIRouter(tags=["Authentication"])

# Seconds to wait for Supabase before giving up cleanly
_SUPABASE_TIMEOUT = 10


def _check_supabase_env():
    """Raise a clear 503 if .env vars are missing."""
    try:
        return get_supabase()
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth service not configured. Contact support.",
        ) from e


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register(payload: RegisterRequest):
    sb = _check_supabase_env()

    # Run blocking Supabase call in thread pool with a timeout
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
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth service timed out. Check your Supabase project is active and SUPABASE_URL is reachable.",
        )
    except Exception as e:
        err = str(e).lower()
        if "already registered" in err or "already exists" in err:
            raise HTTPException(400, "Email already registered. Please log in.")
        raise HTTPException(400, f"Registration failed: {e}")

    user = res.user
    if not user:
        raise HTTPException(400, "Registration failed — no user returned from Supabase.")

    # Create profile stub — also wrapped so a DB timeout is surfaced cleanly
    try:
        await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(
                None,
                lambda: sb.table("profiles")
                .insert({"id": user.id, "full_name": payload.full_name})
                .execute(),
            ),
            timeout=_SUPABASE_TIMEOUT,
        )
    except asyncio.TimeoutError:
        # Auth succeeded — don't block the user, profile can be created on first login
        pass
    except Exception:
        pass  # Same — non-fatal

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
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth service timed out. Check your network or Supabase project status.",
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(401, "Invalid email or password.")

    user = res.user
    if not user:
        raise HTTPException(401, "Invalid credentials.")

    token = create_access_token({"sub": user.id, "email": user.email})
    return TokenResponse(access_token=token, user_id=user.id)