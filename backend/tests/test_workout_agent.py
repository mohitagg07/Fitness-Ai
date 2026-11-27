from datetime import date

from agents import workout_agent


TUESDAY = date(2026, 11, 24)
MONDAY = date(2026, 11, 23)


def _install_plan(monkeypatch, schedule, sessions=None):
    sessions = sessions or {}
    monkeypatch.setattr(
        workout_agent,
        "_active_plan",
        lambda _user_id: {"schedule": schedule},
    )
    monkeypatch.setattr(
        workout_agent,
        "_session_on",
        lambda _user_id, on_date: sessions.get(on_date),
    )


def test_missed_yesterday_does_not_replace_today_scheduled_workout(monkeypatch):
    _install_plan(
        monkeypatch,
        {"mon": "push", "tue": "pull"},
    )

    decision = workout_agent.run_workout_agent("user-1", target_date=TUESDAY)

    assert decision.recommended_type == "pull"
    assert decision.rescheduled is False
    assert "today's scheduled pull remains unchanged" in decision.message.lower()
    assert "has not been rescheduled" in decision.message


def test_missed_yesterday_does_not_turn_a_rest_day_into_a_workout(monkeypatch):
    _install_plan(
        monkeypatch,
        {"mon": "legs", "tue": "rest"},
    )

    decision = workout_agent.run_workout_agent("user-1", target_date=TUESDAY)

    assert decision.recommended_type == "rest"
    assert decision.rescheduled is False
    assert "scheduled rest day" in decision.message
    assert "weekly plan is unchanged" in decision.message


def test_completed_today_session_is_not_replaced_by_yesterdays_missed_workout(monkeypatch):
    _install_plan(
        monkeypatch,
        {"mon": "push", "tue": "pull"},
        {TUESDAY: {"completed": True}},
    )

    decision = workout_agent.run_workout_agent("user-1", target_date=TUESDAY)

    assert decision.recommended_type == "pull"
    assert decision.rescheduled is False
    assert "already logged as complete" in decision.message
    assert "has not been moved" in decision.message


def test_active_or_paused_yesterday_session_is_not_counted_as_missed(monkeypatch):
    _install_plan(
        monkeypatch,
        {"mon": "push", "tue": "pull"},
        {MONDAY: {"completed": False, "status": "paused"}},
    )

    decision = workout_agent.run_workout_agent("user-1", target_date=TUESDAY)

    assert decision.recommended_type == "pull"
    assert decision.rescheduled is False
    assert "not logged as complete" not in decision.message


def test_completed_yesterday_session_leaves_today_schedule_unchanged(monkeypatch):
    _install_plan(
        monkeypatch,
        {"mon": "push", "tue": "pull"},
        {MONDAY: {"completed": True}},
    )

    decision = workout_agent.run_workout_agent("user-1", target_date=TUESDAY)

    assert decision.recommended_type == "pull"
    assert decision.rescheduled is False
    assert "on schedule for today" in decision.message
