"""
Background Job Scheduler — VYRN

Implements the automation layer described in the roadmap:

  Scheduler
    │
    ▼
  Night (run nightly, ~2 AM server time)
    │
    ├── Pattern Detection   — run_pattern_engine() for every active user,
    │                          persisted so the morning brief and dashboard
    │                          don't recompute from scratch on every request.
    ├── Habit Intelligence   — build_habit_profile() for every active user,
    │                          cached so workout_agent.py can read a live
    │                          "avoided days / late days / weekend nutrition
    │                          dip" profile cheaply when rescheduling.
    ├── Weekly Review        — on Sundays, generate_weekly_review() for every
    │                          active user and cache it so the Sunday-morning
    │                          open of the app is instant, not a cold LLM call.
    ├── Memory Cleanup       — prune ai_conversations rows older than the
    │                          retention window so the table doesn't grow
    │                          unbounded; long-term facts already live in
    │                          the separate memory_client store and are
    │                          untouched by this.
    └── Morning Brief Prep   — pre-compute tomorrow's dashboard mission so
                                the very first request of the day is fast.

This scheduler is started only by backend/worker.py as a dedicated
background process. It must not be started from a FastAPI/Uvicorn lifespan:
multiple API workers or replicas would each execute every global job.

"Active user" = anyone with a workout_sessions or nutrition_logs row in the
last 30 days. Running every agent for every signed-up-but-inactive user
would waste LLM calls and DB reads for no one who'll see the result.
"""
from __future__ import annotations
import logging
from datetime import date, timedelta

logger = logging.getLogger(__name__)


def _get_active_user_ids(days: int = 30) -> list[str]:
    from db.supabase_client import get_supabase
    sb = get_supabase()
    cutoff = str(date.today() - timedelta(days=days))
    user_ids: set[str] = set()
    try:
        sessions = (
            sb.table("workout_sessions")
            .select("user_id")
            .gte("session_date", cutoff)
            .execute()
        )
        user_ids.update(r["user_id"] for r in (sessions.data or []) if r.get("user_id"))
    except Exception as e:
        logger.warning(f"_get_active_user_ids: workout_sessions query failed: {e}")
    try:
        nutrition = (
            sb.table("nutrition_logs")
            .select("user_id")
            .gte("log_date", cutoff)
            .execute()
        )
        user_ids.update(r["user_id"] for r in (nutrition.data or []) if r.get("user_id"))
    except Exception as e:
        logger.warning(f"_get_active_user_ids: nutrition_logs query failed: {e}")
    return list(user_ids)


# ─── Job 1: Nightly Pattern Detection ────────────────────────────────────────
def job_pattern_detection() -> None:
    """
    Runs run_pattern_engine() for every active user and caches the result in
    agent_state under "cached_patterns" + "cached_patterns_at" so the
    dashboard can read a pre-computed list instantly instead of running
    five DB-scanning detectors synchronously on every page load.
    """
    from agents.pattern_engine import run_pattern_engine
    from db.supabase_client import get_supabase, get_full_user_context, upsert_agent_state
    from services.nutrition import calculate_macros, is_training_day_for_user
    from schemas.models import Goal

    user_ids = _get_active_user_ids()
    logger.info(f"[scheduler] pattern_detection: {len(user_ids)} active users")
    processed = 0
    for user_id in user_ids:
        try:
            profile, agent_state = get_full_user_context(user_id)
            goal_str = profile.get("goal") or "maintain"
            goal = Goal(goal_str) if goal_str in Goal._value2member_map_ else Goal.maintain
            targets = calculate_macros(
                weight_kg=profile.get("weight_kg") or 75,
                height_cm=profile.get("height_cm") or 175,
                age=profile.get("age") or 28,
                gender=profile.get("gender") or "male",
                goal=goal,
                is_training_day=is_training_day_for_user(user_id),
            )
            insights = run_pattern_engine(user_id, protein_target_g=targets["protein_g"])
            upsert_agent_state(user_id, {
                **agent_state,
                "cached_patterns": [i.__dict__ if hasattr(i, "__dict__") else i for i in insights],
                "cached_patterns_at": str(date.today()),
            })
            processed += 1
        except Exception as e:
            logger.warning(f"[scheduler] pattern_detection failed for {user_id}: {e}")
    logger.info(f"[scheduler] pattern_detection: processed {processed}/{len(user_ids)} users")


# ─── Job 1b: Habit Intelligence ──────────────────────────────────────────────
def job_habit_intelligence() -> None:
    """
    Computes and caches agents/habit_engine.build_habit_profile() for every
    active user — the unified "avoided days / late days / weekend nutrition
    dip / typical schedule" profile that agents/workout_agent.py reads when
    rescheduling a missed session, so the habit signal actually feeds into
    a live decision instead of only sitting in a display card. Runs
    alongside pattern_detection (same 02:xx UTC window) but as its own job
    so a failure in one never blocks the other.
    """
    from agents.habit_engine import cache_habit_profile

    user_ids = _get_active_user_ids()
    logger.info(f"[scheduler] habit_intelligence: {len(user_ids)} active users")
    processed = 0
    for user_id in user_ids:
        try:
            cache_habit_profile(user_id)
            processed += 1
        except Exception as e:
            logger.warning(f"[scheduler] habit_intelligence failed for {user_id}: {e}")
    logger.info(f"[scheduler] habit_intelligence: processed {processed}/{len(user_ids)} users")


# ─── Job 2: Weekly Review (Sundays) ──────────────────────────────────────────
def job_weekly_review() -> None:
    """
    Generates and caches the weekly AI review for every active user. Only
    runs the expensive LLM-backed generate_weekly_review() call once per
    week per user (via the scheduler) instead of on every GET /review/weekly
    request — the route already falls back to live generation if no cache
    exists, so this is a pure performance/cost optimization, not a
    behavior change.
    """
    if date.today().weekday() != 6:  # 6 = Sunday
        logger.info("[scheduler] weekly_review: skipped, not Sunday")
        return

    from agents.weekly_review_agent import generate_weekly_review
    from db.supabase_client import get_supabase

    user_ids = _get_active_user_ids()
    logger.info(f"[scheduler] weekly_review: {len(user_ids)} active users")
    sb = get_supabase()
    processed = 0
    for user_id in user_ids:
        try:
            review = generate_weekly_review(user_id, weeks_ago=0)
            sb.table("weekly_reviews_cache").upsert({
                "user_id": user_id,
                "week_label": review.week_label,
                "payload": {
                    "consistency_pct": review.consistency_pct,
                    "sessions_completed": review.sessions_completed,
                    "sessions_planned": review.sessions_planned,
                    "avg_recovery_score": review.avg_recovery_score,
                    "avg_protein_g": review.avg_protein_g,
                    "protein_target_g": review.protein_target_g,
                    "protein_adherence_pct": review.protein_adherence_pct,
                    "avg_calories": review.avg_calories,
                    "calories_target": review.calories_target,
                    "calories_adherence_pct": review.calories_adherence_pct,
                    "best_lift": review.best_lift,
                    "strength_gains": review.strength_gains,
                    "highlights": review.highlights,
                    "needs_attention": review.needs_attention,
                    "next_week_strategy": review.next_week_strategy,
                    "confidence": review.confidence,
                },
                "generated_at": review.generated_at,
            }, on_conflict="user_id,week_label").execute()
            processed += 1
        except Exception as e:
            logger.warning(f"[scheduler] weekly_review failed for {user_id}: {e}")
    logger.info(f"[scheduler] weekly_review: processed {processed}/{len(user_ids)} users")


# ─── Job 3: Memory Cleanup ────────────────────────────────────────────────────
def job_memory_cleanup(retention_days: int = 90) -> None:
    """
    Prunes ai_conversations rows older than the retention window. Long-term
    durable facts ("user prefers morning workouts") already live in the
    separate vector memory store (db/memory_client.py) and are NOT touched —
    this only trims the raw chat-turn history table, which is purely for
    short-term conversational continuity (coach.py loads the last 10 turns).
    """
    from db.supabase_client import get_supabase
    sb = get_supabase()
    cutoff = str(date.today() - timedelta(days=retention_days))
    try:
        res = (
            sb.table("ai_conversations")
            .delete()
            .lt("created_at", cutoff)
            .execute()
        )
        deleted = len(res.data or [])
        logger.info(f"[scheduler] memory_cleanup: deleted {deleted} conversation rows older than {cutoff}")
    except Exception as e:
        logger.warning(f"[scheduler] memory_cleanup failed: {e}")


# ─── Job 4: Morning Brief Prep ────────────────────────────────────────────────
def job_morning_brief_prep() -> None:
    """
    Pre-computes tomorrow's dashboard "mission" payload for every active
    user so the first GET /api/mission/today of the day is fast. Reuses the
    exact same agent calls the live route uses (same workout/recovery/
    nutrition/progress agents) so the cached value can never disagree with
    what a live call would produce — it's a cache, not a parallel
    implementation.
    """
    import asyncio
    from db.supabase_client import get_supabase, get_full_user_context, upsert_agent_state
    from agents.nutrition_agent import run_nutrition_agent
    from agents.workout_agent import run_workout_agent
    from agents.recovery_agent import run_recovery_agent
    from schemas.models import Goal

    user_ids = _get_active_user_ids()
    logger.info(f"[scheduler] morning_brief_prep: {len(user_ids)} active users")
    processed = 0
    for user_id in user_ids:
        try:
            profile, agent_state = get_full_user_context(user_id)
            goal_str = profile.get("goal") or "maintain"
            goal = Goal(goal_str) if goal_str in Goal._value2member_map_ else Goal.maintain

            workout_decision = run_workout_agent(user_id, preferred_time=profile.get("workout_time_preference"))
            recovery_decision = run_recovery_agent(
                user_id,
                sleep_hours=profile.get("sleep_hours"),
                planned_workout_type=workout_decision.recommended_type,
            )
            nutrition_decision = run_nutrition_agent(
                user_id=user_id,
                weight_kg=profile.get("weight_kg") or 75,
                height_cm=profile.get("height_cm") or 175,
                age=profile.get("age") or 28,
                gender=profile.get("gender") or "male",
                goal=goal,
                food_preference=profile.get("food_preference"),
                is_training_day=is_training_day_for_user(user_id),
            )
            upsert_agent_state(user_id, {
                **agent_state,
                "cached_morning_brief": {
                    "workout_type": workout_decision.recommended_type,
                    "workout_message": workout_decision.message,
                    "recovery_score": recovery_decision.recovery_score,
                    "recovery_message": recovery_decision.message,
                    "nutrition_message": nutrition_decision.message,
                },
                "cached_morning_brief_at": str(date.today()),
            })
            processed += 1
        except Exception as e:
            logger.warning(f"[scheduler] morning_brief_prep failed for {user_id}: {e}")
    logger.info(f"[scheduler] morning_brief_prep: processed {processed}/{len(user_ids)} users")


# ─── Job 5: Notification Generation ──────────────────────────────────────────
def job_generate_notifications() -> None:
    """
    Generates, persists, AND PUSHES intelligent notifications for every
    active user — recovery-high pushes, missed-workout reschedule prompts,
    protein gap alerts, PR opportunity nudges. Runs after pattern_detection
    so it can reuse a warm understanding of what changed, though it calls
    the pattern engine itself rather than reading the cache to guarantee
    freshness.

    The push step is what makes this genuinely proactive: without it, a
    notification only exists as a DB row the user might stumble on by
    opening the app — indistinguishable from the AI not having noticed
    anything at all. send_push_for_notifications() silently no-ops per
    user if they have no push_tokens row yet (haven't granted permission
    on-device), so this is safe to run before every user has opted in.
    """
    from services.notifications import generate_notifications_for_user, save_notifications
    from services.push import send_push_for_notifications

    user_ids = _get_active_user_ids()
    logger.info(f"[scheduler] generate_notifications: {len(user_ids)} active users")
    total_saved = 0
    total_pushed = 0
    for user_id in user_ids:
        try:
            generated = generate_notifications_for_user(user_id)
            saved = save_notifications(user_id, generated)
            total_saved += len(saved)
            if saved:
                total_pushed += send_push_for_notifications(user_id, saved)
        except Exception as e:
            logger.warning(f"[scheduler] generate_notifications failed for {user_id}: {e}")
    logger.info(f"[scheduler] generate_notifications: saved {total_saved}, pushed {total_pushed}")


# ─── Job 6: Workout Reminders (Calendar Intelligence) ────────────────────────
def job_workout_reminders() -> None:
    """
    Runs frequently (every 15 min, not nightly like the jobs above) because
    a reminder is only useful delivered close to the actual moment — "train
    at 6 PM, remind at 5:15 PM" doesn't work on a once-a-night schedule.
    calendar_intelligence.check_reminder_due() does the real filtering (has
    this user got an established time pattern for today? are we in their
    45-minute-before window? have they already trained today?) so most
    calls here are a fast no-op for most users.
    """
    from services.calendar_intelligence import check_reminder_due
    from services.notifications import save_notifications
    from services.push import send_push_for_notifications
    from datetime import datetime

    now = datetime.utcnow()  # scheduler runs in UTC; see note on start_scheduler
    user_ids = _get_active_user_ids()
    fired = 0
    for user_id in user_ids:
        try:
            reminder = check_reminder_due(user_id, now.hour, now.minute)
            if not reminder:
                continue
            saved = save_notifications(user_id, [reminder])
            if saved:
                send_push_for_notifications(user_id, saved)
                fired += 1
        except Exception as e:
            logger.warning(f"[scheduler] workout_reminders failed for {user_id}: {e}")
    if fired:
        logger.info(f"[scheduler] workout_reminders: fired {fired} reminder(s)")


# ─── Scheduler bootstrap ──────────────────────────────────────────────────────
def start_scheduler():
    """
    Starts an in-process APScheduler BackgroundScheduler running all four
    nightly jobs. Returns the scheduler instance so main.py can shut it down
    cleanly on app exit. Raises ImportError if apscheduler isn't installed —
    main.py catches this and logs a warning, the API keeps running fine
    without scheduled automation (jobs can still be triggered manually via
    the /api/program/rewrite-style on-demand endpoints elsewhere).
    """
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger
    from apscheduler.triggers.interval import IntervalTrigger

    scheduler = BackgroundScheduler(timezone="UTC")

    # 02:00 UTC nightly — pattern detection (cheap, every user every night)
    scheduler.add_job(
        job_pattern_detection,
        CronTrigger(hour=2, minute=0),
        id="pattern_detection",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    # 02:15 UTC nightly — Habit Intelligence (avoided days, late days,
    # weekend nutrition dip), cached for workout_agent to read live.
    scheduler.add_job(
        job_habit_intelligence,
        CronTrigger(hour=2, minute=15),
        id="habit_intelligence",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    # 02:30 UTC nightly — memory cleanup (cheap, runs every night, no-op
    # past the retention window for most rows)
    scheduler.add_job(
        job_memory_cleanup,
        CronTrigger(hour=2, minute=30),
        id="memory_cleanup",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    # 03:00 UTC nightly — weekly review (expensive LLM calls; the job
    # itself checks for Sunday and no-ops other days, but the timer is
    # exercised nightly to keep the schedule simple — if a server restart
    # causes a missed Sunday run, misfire_grace_time still catches it for
    # the rest of the day)
    scheduler.add_job(
        job_weekly_review,
        CronTrigger(hour=3, minute=0),
        id="weekly_review",
        replace_existing=True,
        misfire_grace_time=3600 * 6,
    )
    # 04:00 UTC nightly — morning brief prep (so the first dashboard open
    # of the day, regardless of the user's timezone, hits a warm cache)
    scheduler.add_job(
        job_morning_brief_prep,
        CronTrigger(hour=4, minute=0),
        id="morning_brief_prep",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    # 04:30 UTC nightly — intelligent notification generation
    scheduler.add_job(
        job_generate_notifications,
        CronTrigger(hour=4, minute=30),
        id="generate_notifications",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    # Every 15 minutes, all day — Calendar Intelligence reminders. Unlike
    # the nightly jobs above, this one needs to run close to the actual
    # moment a reminder is useful, not once at 4:30 AM.
    scheduler.add_job(
        job_workout_reminders,
        IntervalTrigger(minutes=15),
        id="workout_reminders",
        replace_existing=True,
        misfire_grace_time=300,
    )

    scheduler.start()
    logger.info("[scheduler] started — pattern_detection@02:00, habit_intelligence@02:15, memory_cleanup@02:30, weekly_review@03:00 (Sun only), morning_brief_prep@04:00, generate_notifications@04:30 UTC, workout_reminders every 15min")
    return scheduler


def run_all_jobs_now() -> dict:
    """
    Manual trigger for all six jobs in sequence — used by the
    /api/admin/run-jobs-now endpoint (and by tests) instead of waiting for
    the nightly cron. Returns a status dict per job so failures in one job
    don't hide failures in another.
    """
    results = {}
    for name, fn in [
        ("pattern_detection", job_pattern_detection),
        ("habit_intelligence", job_habit_intelligence),
        ("memory_cleanup", job_memory_cleanup),
        ("weekly_review", job_weekly_review),
        ("morning_brief_prep", job_morning_brief_prep),
        ("generate_notifications", job_generate_notifications),
        ("workout_reminders", job_workout_reminders),
    ]:
        try:
            fn()
            results[name] = "ok"
        except Exception as e:
            results[name] = f"failed: {e}"
    return results