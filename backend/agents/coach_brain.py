"""
Coach Brain — VYRN

The AI Decision Engine. Runs on app open, before the user types anything.

Instead of:
  User → Prompt → LLM → Answer

This does:
  App Opens → Fetch All User Data → Detect Trends → Find Problems
  → Generate Today's Strategy → Render Coach Dashboard

The coach THINKS first. It reasons through 6 steps:
  1. Recovery status
  2. Strength progression
  3. Injury flags
  4. Nutrition adequacy
  5. Sleep / fatigue
  6. Generate today's recommendation with confidence + WHY

Output: ProactiveBrief — a structured object the dashboard renders directly.
"""
from __future__ import annotations
import json
import logging
from dataclasses import dataclass, field

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage

from db.memory_client import recall
from core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class ReasoningStep:
    label: str
    finding: str
    implication: str


@dataclass
class ProactiveBrief:
    """What the AI coach decided about today — without being asked."""
    coach_message: str              # Personalized greeting + today's plan
    todays_focus: str               # Single most important thing today
    reasoning_steps: list[ReasoningStep]   # Transparent chain of thought
    recommendation: str            # The actual recommendation
    confidence: str                # "Low" | "Medium" | "High"
    confidence_pct: int            # 0-100
    why_summary: str               # 1-2 sentences explaining the reasoning
    suggested_top_set: str | None  # e.g. "Bench Press 82.5kg × 3"
    proactive_notices: list[str]   # Things coach noticed without being asked


def _build_reasoning_steps(
    recovery_decision,
    workout_decision,
    nutrition_decision,
    progress_decision,
    consumed: dict,
    targets: dict,
    profile: dict,
    agent_state_from_profile: dict = None,
) -> list[ReasoningStep]:
    """Build transparent reasoning chain shown in the 'Why?' section."""
    steps = []

    # Step 1: Recovery
    rec_score = recovery_decision.recovery_score
    if rec_score >= 7:
        rec_finding = f"Recovery is strong at {rec_score}/10"
        rec_impl = "Green light for high-intensity training"
    elif rec_score >= 4:
        rec_finding = f"Recovery is moderate at {rec_score}/10"
        rec_impl = "Proceed with training but reduce top-set intensity"
    else:
        rec_finding = f"Recovery is low at {rec_score}/10"
        rec_impl = "Training today risks injury — rest or light mobility only"

    steps.append(ReasoningStep(
        label="Recovery Status",
        finding=rec_finding,
        implication=rec_impl,
    ))

    # Step 2: Workout plan
    wtype = workout_decision.recommended_type or "rest"
    if workout_decision.rescheduled:
        steps.append(ReasoningStep(
            label="Workout Plan",
            finding=f"Missed session detected — rescheduling {wtype.replace('_', ' ').title()} day",
            implication="Today's session covers yesterday's gap",
        ))
    elif wtype.lower() == "rest":
        steps.append(ReasoningStep(
            label="Workout Plan",
            finding="Scheduled rest day",
            implication="Recovery is part of the adaptation — take it",
        ))
    else:
        steps.append(ReasoningStep(
            label="Workout Plan",
            finding=f"{wtype.replace('_', ' ').title()} day on schedule",
            implication="Stick to the plan and aim for progressive overload",
        ))

    # Step 3: Nutrition
    protein_pct = round(consumed.get("protein_g", 0) / max(1, targets.get("protein_g", 160)) * 100)
    if protein_pct >= 80:
        steps.append(ReasoningStep(
            label="Nutrition",
            finding=f"Protein at {protein_pct}% of target today",
            implication="Well fueled — strength training will be supported",
        ))
    else:
        remaining_g = round(targets.get("protein_g", 160) - consumed.get("protein_g", 0))
        steps.append(ReasoningStep(
            label="Nutrition",
            finding=f"Only {protein_pct}% protein logged so far today",
            implication=f"Need {remaining_g}g more — prioritize protein in next meal",
        ))

    # Step 4: Progress trend
    if progress_decision.stalled:
        adj = progress_decision.suggested_calorie_adjustment
        direction = "Reduce" if adj < 0 else "Add"
        steps.append(ReasoningStep(
            label="Progress Trend",
            finding="Weight progress stalled",
            implication=f"{direction} {abs(adj)} kcal/day to restart progress",
        ))
    else:
        steps.append(ReasoningStep(
            label="Progress Trend",
            finding="Weight moving in the right direction",
            implication="Keep current targets — don't change what's working",
        ))

    return steps


def generate_proactive_brief(
    user_id: str,
    profile: dict,
    workout_decision,
    recovery_decision,
    nutrition_decision,
    progress_decision,
    consumed: dict,
    targets: dict,
) -> dict:
    """
    Generate the proactive coach brief.
    Returns a dict (JSON-serializable) for the mission endpoint.
    """
    name = (profile.get("full_name") or "Athlete").split()[0]
    goal = profile.get("goal") or "maintain"
    injuries = profile.get("injuries") or []
    injury_note = ""
    if injuries:
        parts = [f"{i.get('body_part', '')} ({i.get('issue_type', '')})" for i in injuries if isinstance(i, dict)]
        injury_note = f"Injuries on file: {', '.join(parts[:2])}. " if parts else ""

    # Build reasoning steps
    reasoning_steps = _build_reasoning_steps(
        recovery_decision, workout_decision, nutrition_decision,
        progress_decision, consumed, targets, profile,
    )

    # Pull memories for personalization
    memories = []
    try:
        memories = recall(user_id, "training preference schedule nutrition", n_results=4)
    except Exception:
        pass
    memories_text = "\n".join(f"- {m}" for m in memories) if memories else "None stored yet."

    # Context for LLM
    rec_score = recovery_decision.recovery_score
    wtype = (workout_decision.recommended_type or "rest").replace("_", " ").title()
    protein_remaining = round(targets.get("protein_g", 160) - consumed.get("protein_g", 0), 1)
    calories_remaining = targets.get("calories", 2500) - int(consumed.get("calories", 0))

    prs = profile.get("personal_records") or {}
    top_pr_str = ""
    if isinstance(prs, dict) and prs:
        top_ex = list(prs.keys())[0]
        top_pr_str = f"Current {top_ex} PR: {prs[top_ex]}kg. "

    context = f"""ATHLETE: {name} | Goal: {goal} | Recovery: {rec_score}/10
Workout today: {wtype} {"(RESCHEDULED)" if workout_decision.rescheduled else ""}
Protein remaining: {max(0, protein_remaining):.0f}g | Calories remaining: {max(0, calories_remaining)} kcal
{injury_note}{top_pr_str}
Progress stalled: {progress_decision.stalled}
Memories: {memories_text}"""

    prompt = f"""You are VYRN — the athlete's personal coach. You think about them before they even open the app.

Based on this data, generate a PROACTIVE coach brief — what you've decided for them today.

{context}

Return ONLY valid JSON (no markdown fences):
{{
  "coach_message": "A warm, specific 2-3 sentence message. Reference actual numbers. First-person coach voice. Never say 'I will provide' or 'generating'. Max 60 words.",
  "todays_focus": "The single most important thing they should do today (one sentence, concrete).",
  "recommendation": "The specific training recommendation (e.g. 'Push Day — target Bench Press 82.5kg x 3 for your top set').",
  "suggested_top_set": "A specific set suggestion like 'Bench Press 82.5kg × 3' or null if rest day.",
  "confidence_pct": 85,
  "why_summary": "1-2 sentences explaining WHY you made this recommendation, citing specific data.",
  "proactive_notices": ["Thing coach noticed #1", "Thing coach noticed #2"]
}}

Keep coach_message under 60 words. Make it feel like a real coach who has been thinking about them."""

    try:
        llm = ChatGroq(
            model=settings.groq_model,
            api_key=settings.groq_api_key,
            temperature=0.3,
        )
        response = llm.invoke([
            SystemMessage(content="You are VYRN. Return only valid JSON, no markdown."),
            HumanMessage(content=prompt),
        ])
        raw = response.content.strip().replace("```json", "").replace("```", "").strip()
        result = json.loads(raw)
    except Exception as e:
        logger.warning(f"Coach brain LLM failed: {e}")
        result = {
            "coach_message": f"Recovery at {rec_score}/10 — {wtype} day is on schedule. Let's hit it.",
            "todays_focus": wtype if wtype.lower() != "rest" else "Full recovery — sleep and hydration today.",
            "recommendation": workout_decision.message,
            "suggested_top_set": None,
            "confidence_pct": 70,
            "why_summary": f"Recovery score {rec_score}/10 and {wtype} scheduled for today.",
            "proactive_notices": [],
        }

    # Serialize reasoning steps
    result["reasoning_steps"] = [
        {
            "label": s.label,
            "finding": s.finding,
            "implication": s.implication,
        }
        for s in reasoning_steps
    ]

    # Derive confidence label
    pct = result.get("confidence_pct", 70)
    result["confidence"] = "High" if pct >= 80 else "Medium" if pct >= 55 else "Low"

    return result
