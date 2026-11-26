from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

import logging

from core.config import get_settings, validate_secret_key
from db.supabase_client import get_supabase

logger = logging.getLogger(__name__)

settings = get_settings()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    # datetime.utcnow() is deprecated (naive, no tzinfo) and scheduled for
    # removal. Using timezone-aware now(timezone.utc) is the correct
    # replacement and avoids any ambiguity in how the exp claim's instant
    # is computed.
    signing_key = validate_secret_key(settings.secret_key)
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, signing_key, algorithm=settings.algorithm)


# In-process cache of user_ids already confirmed to have a profiles row.
# Ten tables (ai_conversations, agent_states, workout_sessions, exercise_logs,
# personal_records, injury_profiles, workout_plans, nutrition_logs, and more)
# all carry a foreign key against profiles.id, not auth.users.id. A user can
# hold a perfectly valid JWT — they exist in Supabase Auth, login succeeds —
# while having zero row in profiles, because that row was previously only
# created by POST /profile/onboard. Any route that inserts into one of those
# ten tables before onboarding completes (or for a user created directly in
# the Supabase dashboard, bypassing /auth/register entirely) hits a foreign
# key violation. This has now surfaced twice from two different routes
# (coach.py's ai_conversations insert, then workouts.py's workout_sessions
# insert) — patching each call site individually doesn't scale to the other
# eight tables or to routes not yet written. Centralizing the guarantee here,
# in the one dependency every authenticated route already uses, closes the
# entire bug class at once.
#
# This cache is intentionally process-local and unbounded for the lifetime
# of one server process — it only ever stores user_ids already confirmed to
# have a row, so a stale positive is harmless (the row still exists; it was
# never deleted by the app), and a cold cache after a restart just means the
# first request per user re-checks once, which is cheap.
_profiles_confirmed: set[str] = set()


class _OrphanedSessionError(Exception):
    """Raised internally when a JWT's user_id has no matching row in
    auth.users — i.e. the token is cryptographically valid but points at a
    user that doesn't exist in the current database. Caught by
    get_current_user() and converted into a clean 401 with a specific,
    actionable message rather than letting it surface as a generic 500
    on whichever route happens to write data first."""
    def __init__(self, user_id: str):
        self.user_id = user_id
        super().__init__(f"No auth.users row for {user_id}")


async def _ensure_profile_exists(user_id: str) -> None:
    if user_id in _profiles_confirmed:
        return
    # Imported lazily to avoid a circular import (db.supabase_client doesn't
    # import core.security, but core is conventionally lower-level than db).
    import asyncio
    from db.supabase_client import get_supabase

    def _check_and_create():
        sb = get_supabase()
        existing = (
            sb.table("profiles").select("id").eq("id", user_id).maybe_single().execute()
        )
        if existing and existing.data:
            return
        try:
            sb.table("profiles").insert(
                {"id": user_id, "onboarding_complete": False}
            ).execute()
        except Exception as e:
            err_str = str(e)
            if "profiles_id_fkey" in err_str or (
                "not present in table" in err_str and "users" in err_str
            ):
                # The insert failed because profiles.id -> auth.users.id has
                # no match — meaning this JWT's user_id was never created in
                # the CURRENT database, not just missing a profile row. This
                # happens when a Supabase project gets reset/recreated while
                # a browser or device still has an old token cached in
                # localStorage/SecureStore — the JWT signature still
                # verifies fine (same secret_key), but the user it points at
                # is gone. Surfacing this distinctly (rather than letting it
                # fall through to a generic "Could not auto-create" warning,
                # which then cascades into separate confusing 500s on every
                # other route that tries to write data) lets the client
                # catch ORPHANED_SESSION specifically and force a clean
                # logout instead of repeatedly retrying writes that can
                # never succeed for this token.
                raise _OrphanedSessionError(user_id)
            # Anything else is most likely a race with a concurrent request
            # for the same user already having inserted the row between our
            # SELECT and INSERT — harmless, the row exists either way.

    try:
        await asyncio.to_thread(_check_and_create)
        _profiles_confirmed.add(user_id)
    except _OrphanedSessionError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="ORPHANED_SESSION: This session no longer matches a valid account. Please log out and log back in.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception as e:
        # Don't block the request over a failed existence check — if
        # Supabase is genuinely unreachable, every DB call on this request
        # will fail anyway and surface its own clear error. We only want to
        # avoid silently letting a *known-missing* profile reach an insert.
        import logging
        logging.getLogger(__name__).warning(
            f"Could not verify/create profiles row for {user_id}: {e}"
        )


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        signing_key = validate_secret_key(settings.secret_key)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication is not configured securely. Contact support.",
        ) from exc

    try:
        payload = jwt.decode(
            token, signing_key, algorithms=[settings.algorithm]
        )
        user_id: str = payload.get("sub")
        if not user_id:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    await _ensure_profile_exists(user_id)
    return {"user_id": user_id, "email": payload.get("email")}


def require_admin_user(
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Require a database-backed admin role for global administrative actions.

    The role is read with the backend service key, which deliberately bypasses
    Postgres RLS. This dependency therefore performs an explicit user-id filter
    and fails closed when the role column/migration is unavailable.
    """
    user_id = current_user.get("user_id")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authenticated user.",
        )

    try:
        result = (
            get_supabase()
            .table("profiles")
            .select("app_role")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
    except Exception as exc:
        code = getattr(exc, "code", None)
        message = str(exc).lower()
        if code == "42703" or "app_role" in message and (
            "column" in message or "schema cache" in message
        ):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "Admin authorization is not configured yet. "
                    "Apply MIGRATION_v6_security_roles.sql in Supabase."
                ),
            ) from exc
        logger.exception("Could not verify admin role for user %s", user_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin authorization could not be verified. Try again later.",
        ) from exc

    profile = result.data if result else None
    if not profile or profile.get("app_role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access is required.",
        )

    return current_user
