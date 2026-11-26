"""
VYRN — Authentication routes.

Email confirmation is enforced by Supabase. When Supabase returns a user
without a session, the account exists but is not yet allowed into VYRN:
the app receives a verification-pending response and no VYRN access token.
"""
import asyncio
import logging

from fastapi import APIRouter, HTTPException, Response, status

from schemas.models import (
    RegisterRequest,
    RegisterResponse,
    LoginRequest,
    TokenResponse,
)
from core.config import get_settings
from core.security import create_access_token
from db.supabase_client import get_supabase

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Authentication"])

# Keep this below the mobile auth request timeout. A timeout in run_in_executor
# cannot stop the underlying network thread, so avoid an unnecessarily short
# limit that can make a successful signup look like a failed one.
_SUPABASE_TIMEOUT = 25
_settings = get_settings()


def _check_supabase_env():
    """Raise a clear 503 if required Supabase environment variables are missing."""
    try:
        return get_supabase()
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth service not configured. Contact support.",
        ) from exc


@router.post(
    "/register",
    response_model=RegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register(payload: RegisterRequest, response: Response):
    sb = _check_supabase_env()
    email = payload.email.strip().lower()
    full_name = payload.full_name.strip()

    try:
        res = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(
                None,
                lambda: sb.auth.sign_up(
                    {
                        "email": email,
                        "password": payload.password,
                        "options": {
                            "email_redirect_to": _settings.auth_email_redirect_url,
                            "data": {"full_name": full_name},
                        },
                    }
                ),
            ),
            timeout=_SUPABASE_TIMEOUT,
        )
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Supabase signup timed out. Your account may still have been created; "
                "check your inbox before trying again."
            ),
        ) from exc
    except Exception as exc:
        message = str(exc).lower()
        if "already registered" in message or "already exists" in message:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "This email is already registered. Sign in, or check your inbox "
                    "for an earlier confirmation email."
                ),
            ) from exc
        logger.exception("Supabase signup failed")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Registration could not be completed. Please check your details and try again.",
        ) from exc

    user = getattr(res, "user", None)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Registration could not be completed. Supabase returned no user.",
        )

    # Create the profile row now so FK-backed app features have a profile as
    # soon as the user verifies and signs in. This uses the backend service key.
    try:
        await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(
                None,
                lambda: sb.table("profiles")
                .upsert(
                    {"id": user.id, "full_name": full_name},
                    on_conflict="id",
                )
                .execute(),
            ),
            timeout=_SUPABASE_TIMEOUT,
        )
    except asyncio.TimeoutError:
        logger.warning("Profile upsert timed out for new user %s", user.id)
    except Exception:
        logger.exception("Profile upsert failed for new user %s", user.id)

    # Supabase returns a user but NO session when Confirm email is enabled.
    # Never mint our own API token in that state: doing so would bypass the
    # email-verification requirement enforced by Supabase's password login.
    if getattr(res, "session", None) is None:
        response.status_code = status.HTTP_202_ACCEPTED
        return RegisterResponse(
            verification_required=True,
            message=(
                "We sent a confirmation link to your email. Open it on the phone "
                "where VYRN is installed. Once VYRN opens and confirms your address, "
                "return here and sign in."
            ),
            user_id=str(user.id),
        )

    token = create_access_token({"sub": user.id, "email": email})
    return RegisterResponse(
        verification_required=False,
        message="Your account is ready.",
        access_token=token,
        user_id=str(user.id),
    )


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest):
    sb = _check_supabase_env()
    email = payload.email.strip().lower()

    try:
        res = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(
                None,
                lambda: sb.auth.sign_in_with_password(
                    {"email": email, "password": payload.password}
                ),
            ),
            timeout=_SUPABASE_TIMEOUT,
        )
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication timed out. Please try again.",
        ) from exc
    except Exception as exc:
        message = str(exc).lower().replace("_", " ")
        if "email not confirmed" in message or "email is not confirmed" in message:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Please confirm your email address using the link we sent before signing in.",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        ) from exc

    user = getattr(res, "user", None)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    token = create_access_token({"sub": user.id, "email": user.email or email})
    return TokenResponse(access_token=token, user_id=str(user.id))
