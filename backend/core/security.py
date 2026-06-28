from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from core.config import get_settings

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

# If SECRET_KEY is missing from .env, this falls back to a known constant
# string. That fallback is stable across restarts on its own (it doesn't
# explain a token being invalidated mid-session by itself), but it means
# anyone who later actually sets SECRET_KEY in .env — or regenerates it —
# silently invalidates every token issued under the old value, logging out
# every signed-in user on the next request they make. Surfacing this at
# startup makes that footgun visible instead of only showing up later as an
# unexplained "why did the app log me out" symptom.
if settings.secret_key == "dev-secret-key-change-in-production":
    import logging
    logging.getLogger(__name__).warning(
        "SECRET_KEY is not set in .env — using the insecure default. "
        "Every existing login token will be invalidated the moment you set "
        "a real SECRET_KEY (or it changes for any other reason), forcing "
        "all signed-in users to log in again. Set SECRET_KEY in backend/.env "
        "now and keep it stable to avoid this."
    )


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    # datetime.utcnow() is deprecated (naive, no tzinfo) and scheduled for
    # removal. Using timezone-aware now(timezone.utc) is the correct
    # replacement and avoids any ambiguity in how the exp claim's instant
    # is computed.
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)


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
        payload = jwt.decode(
            token, settings.secret_key, algorithms=[settings.algorithm]
        )
        user_id: str = payload.get("sub")
        if not user_id:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    await _ensure_profile_exists(user_id)
    return {"user_id": user_id, "email": payload.get("email")}