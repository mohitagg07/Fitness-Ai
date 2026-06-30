"""
Intelligent Notifications — VYRN  (v2)

Per the roadmap, every notification body is built from a real number:

  Recovery 93% → Today's a good day to push. Bench +2.5 kg is realistic.
  You've skipped legs twice this month → Reschedule tomorrow?
  Protein 62% → Need another 48 g.
  3 kg from 100 kg Bench — go for it today.

This module generates the notification *payloads* that a push layer would
deliver, and persists them to a `notifications` table so the frontend can
render an in-app notification centre even before real push delivery is wired.

Changes from v1:
  - Recovery notification now uses score_pct (0-100) from the dynamic engine
    and fires at ≥80%, with a PR-proximity message when recovery is ≥90%.
  - Protein notification uses actual remaining grams (real number, not a %).
  - All notifications include a `cta` (call-to-action route) so the frontend
    can deep-link into the right screen on tap.
  - CNS Very High → dedicated "take a deload" push, higher priority.
  - Motivation notification surfaced if motivation engine finds a real hook.
"""
from __future__ import annotations
import logging
from datetime import date

logger = logging.getLogger(__name__)


# ── Individual notification builders ─────────────────────────────────────────

def _recovery_notification(recovery_decision, profile: dict) -> dict | None:
    """
    Recovery ≥ 80% → fire.
    Recovery ≥ 90% + PR opportunity → include specific lift advice.
    """
    score_pct = getattr(recovery_decision, "score_pct", None)
    if score_pct is None:
        score_pct = recovery_decision.recovery_score * 10   # legacy 0-10 fallback
    score_pct = round(score_pct)

    if score_pct < 80:
        return None

    body = f"Recovery {score_pct}% — today's a good day to push."
    if score_pct >= 90:
        body = f"Recovery {score_pct}% — conditions are ideal. Consider a top set at 95% of your best lift."

    return {
        "type": "recovery_high",
        "title": f"Recovery {score_pct}%",
        "body": body,
        "priority": "normal",
        "cta": "/workout",
        "data": {"recovery_pct": score_pct},
    }


def _cns_deload_notification(recovery_decision) -> dict | None:
    """Fires when CNS load is Very High — separate from recovery low."""
    cns_load = getattr(recovery_decision, "cns_load", {})
    if not cns_load:
        return None
    if cns_load.get("label") != "Very High":
        return None
    return {
        "type": "cns_very_high",
        "title": "CNS overloaded",
        "body": "CNS load is Very High. Deload this week — 60% intensity, cut volume 30%. Your next block will be stronger for it.",
        "priority": "high",
        "cta": "/recovery",
        "data": {"cns_score": cns_load.get("score")},
    }


def _missed_workout_notification(insights: list) -> dict | None:
    """You've skipped legs twice this month → Reschedule tomorrow?"""
    for insight in insights:
        category = insight.category if hasattr(insight, "category") else insight.get("category")
        if category == "missed_workout":
            detail = insight.detail if hasattr(insight, "detail") else insight.get("detail")
            data_d = insight.data if hasattr(insight, "data") else insight.get("data", {})
            day    = data_d.get("day", "a session")
            return {
                "type": "missed_workout",
                "title": f"Missed {day} sessions",
                "body": f"{detail} Reschedule tomorrow?",
                "priority": "normal",
                "cta": "/workout",
                "data": {"category": "missed_workout", "day": day},
            }
    return None


def _protein_notification(nutrition_today: dict, protein_target_g: float) -> dict | None:
    """
    Protein 62% → Need another 48 g.
    Only fires when the gap is meaningful (≥15 g) — avoids nagging at 2g
    under target or right after breakfast with all day left.
    """
    if not nutrition_today or protein_target_g <= 0:
        return None
    consumed  = nutrition_today.get("protein_g", 0)
    pct       = round(100 * consumed / protein_target_g)
    remaining = round(protein_target_g - consumed)
    if remaining < 15:
        return None
    return {
        "type": "protein_gap",
        "title": f"Protein {pct}%",
        "body": f"Need another {remaining}g to hit today's target. Greek yogurt + chicken = ~45g.",
        "priority": "normal",
        "cta": "/nutrition",
        "data": {"protein_pct": pct, "remaining_g": remaining},
    }


def _pr_opportunity_notification(insights: list) -> dict | None:
    """Surfaces a pr_opportunity PatternInsight as a push."""
    for insight in insights:
        category = insight.category if hasattr(insight, "category") else insight.get("category")
        if category == "pr_opportunity":
            title          = insight.title if hasattr(insight, "title") else insight.get("title", "PR opportunity")
            recommendation = insight.recommendation if hasattr(insight, "recommendation") else insight.get("recommendation", "Go for it today.")
            return {
                "type": "pr_opportunity",
                "title": title,
                "body": recommendation,
                "priority": "high",
                "cta": "/workout",
                "data": {"category": "pr_opportunity"},
            }
    return None


def _recovery_decline_notification(insights: list) -> dict | None:
    for insight in insights:
        category = insight.category if hasattr(insight, "category") else insight.get("category")
        if category == "recovery_decline":
            detail         = insight.detail if hasattr(insight, "detail") else insight.get("detail", "")
            recommendation = insight.recommendation if hasattr(insight, "recommendation") else insight.get("recommendation", "")
            return {
                "type": "recovery_decline",
                "title": "Recovery trending down",
                "body": f"{detail} {recommendation}".strip(),
                "priority": "high",
                "cta": "/recovery",
                "data": {"category": "recovery_decline"},
            }
    return None


def _motivation_notification(user_id: str, profile: dict) -> dict | None:
    """Real-number motivation message — only if the engine finds a genuine hook."""
    try:
        from agents.motivation_agent import get_motivation_message
        coach_style = profile.get("coach_style") or "friendly"
        msg = get_motivation_message(user_id, coach_style)
        # Skip generic fallbacks (they contain "keep it up" or "most important")
        if "keep it up" in msg or "most important" in msg:
            return None
        return {
            "type": "motivation",
            "title": "Coach says",
            "body": msg,
            "priority": "low",
            "cta": "/dashboard",
            "data": {},
        }
    except Exception as e:
        logger.debug(f"_motivation_notification: failed ({e})")
        return None


# ── Main generator ────────────────────────────────────────────────────────────

def generate_notifications_for_user(user_id: str) -> list[dict]:
    """
    Builds today's set of intelligent notifications from real agent output.
    Returns a list (usually 0-3 items) ready to insert into `notifications`.
    """
    from db.supabase_client import get_supabase, get_full_user_context
    from agents.recovery_agent import run_recovery_agent
    from agents.workout_agent import run_workout_agent
    from agents.pattern_engine import run_pattern_engine
    from services.nutrition import calculate_macros
    from schemas.models import Goal

    profile, agent_state = get_full_user_context(user_id)
    goal_str = profile.get("goal") or "maintain"
    goal     = Goal(goal_str) if goal_str in Goal._value2member_map_ else Goal.maintain
    targets  = calculate_macros(
        weight_kg=profile.get("weight_kg") or 75,
        height_cm=profile.get("height_cm") or 175,
        age=profile.get("age") or 28,
        gender=profile.get("gender") or "male",
        goal=goal,
        is_training_day=True,
    )

    workout_decision  = run_workout_agent(user_id, preferred_time=profile.get("workout_time_preference"))
    recovery_decision = run_recovery_agent(
        user_id,
        sleep_hours=profile.get("sleep_hours"),
        planned_workout_type=workout_decision.recommended_type,
        protein_target_g=targets["protein_g"],
        calorie_target=targets["calories"],
    )
    insights = run_pattern_engine(user_id, protein_target_g=targets["protein_g"])

    sb    = get_supabase()
    today = str(date.today())
    nutrition_res = (
        sb.table("nutrition_logs")
        .select("calories, protein_g")
        .eq("user_id", user_id)
        .eq("log_date", today)
        .execute()
    )
    logs = nutrition_res.data or []
    nutrition_today = {
        "calories":  sum(l.get("calories") or 0 for l in logs),
        "protein_g": sum(l.get("protein_g") or 0 for l in logs),
    }

    # Priority order — high-priority items come first so cap-at-3 drops
    # the least urgent ones.
    candidates = [
        _cns_deload_notification(recovery_decision),         # Very High CNS → deload push
        _recovery_decline_notification(insights),            # trending down (critical)
        _pr_opportunity_notification(insights),              # PR window (high)
        _missed_workout_notification(insights),              # skipped sessions
        _recovery_notification(recovery_decision, profile),  # ≥80% recovery
        _protein_notification(nutrition_today, targets["protein_g"]),
        _motivation_notification(user_id, profile),          # lowest priority
    ]
    notifications = [n for n in candidates if n is not None]

    # Cap at 3 per day so the user isn't spammed even if every signal fires
    return notifications[:3]


def save_notifications(user_id: str, notifications: list[dict]) -> list[dict]:
    """Persists generated notifications to the notifications table, skipping duplicates for today+type."""
    from db.supabase_client import get_supabase
    sb    = get_supabase()
    today = str(date.today())
    saved = []
    for n in notifications:
        existing = (
            sb.table("notifications")
            .select("id")
            .eq("user_id", user_id)
            .eq("type", n["type"])
            .eq("notif_date", today)
            .limit(1)
            .execute()
        )
        if existing.data:
            continue
        row = {
            "user_id":    user_id,
            "notif_date": today,
            "type":       n["type"],
            "title":      n["title"],
            "body":       n["body"],
            "priority":   n["priority"],
            "cta":        n.get("cta"),
            "data":       n.get("data") or {},
            "read":       False,
        }
        try:
            res = sb.table("notifications").insert(row).execute()
            if res.data:
                saved.append(res.data[0])
        except Exception as e:
            logger.warning(f"save_notifications: failed to insert {n['type']} for {user_id}: {e}")
    return saved
