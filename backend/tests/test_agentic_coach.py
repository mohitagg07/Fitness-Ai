import json
from types import SimpleNamespace

from agents.agentic_research import MAX_TOOL_ROUNDS, route_after_agent
from agents.coach_tools import build_coach_tools
from db import memory_client


def test_agentic_research_routes_only_tool_calls_and_caps_tool_rounds():
    plain = SimpleNamespace(tool_calls=[])
    call = SimpleNamespace(tool_calls=[{"name": "get_recent_workouts", "args": {}, "id": "t1"}])

    assert route_after_agent({"messages": [plain], "tool_rounds": 1}) == "__end__"
    assert route_after_agent({"messages": [call], "tool_rounds": 1}) == "tools"
    assert route_after_agent({"messages": [call], "tool_rounds": MAX_TOOL_ROUNDS}) == "tools"
    assert route_after_agent({"messages": [call], "tool_rounds": MAX_TOOL_ROUNDS + 1}) == "limit"


def test_coach_tool_registry_is_read_only_and_user_scoped():
    tools = build_coach_tools(
        user_id="athlete-123",
        profile={
            "goal": "bulk",
            "equipment": ["dumbbell"],
            "password": "must-not-be-returned",
        },
    )
    by_name = {tool.name: tool for tool in tools}

    assert set(by_name) == {
        "get_recent_workouts",
        "get_nutrition_today",
        "get_recovery_checkins",
        "get_weight_trend",
        "get_profile_constraints",
        "search_fitness_evidence",
    }
    profile = json.loads(by_name["get_profile_constraints"].invoke({}))
    assert profile["goal"] == "bulk"
    assert profile["equipment"] == ["dumbbell"]
    assert "password" not in profile


def test_nutrition_tool_scopes_query_to_authenticated_user(monkeypatch):
    class Query:
        def __init__(self):
            self.filters = []
        def select(self, *_args, **_kwargs):
            return self
        def eq(self, key, value):
            self.filters.append((key, value))
            return self
        def order(self, *_args, **_kwargs):
            return self
        def execute(self):
            return SimpleNamespace(data=[{
                "meal_name": "Lunch",
                "calories": 500,
                "protein_g": 30,
                "carbs_g": 50,
                "fat_g": 10,
                "water_ml": 250,
            }])

    class Supabase:
        def __init__(self):
            self.query = Query()
        def table(self, name):
            assert name == "nutrition_logs"
            return self.query

    client = Supabase()
    monkeypatch.setattr("agents.coach_tools.get_supabase", lambda: client)
    tool = next(t for t in build_coach_tools("athlete-123") if t.name == "get_nutrition_today")
    result = json.loads(tool.invoke({}))

    assert ("user_id", "athlete-123") in client.query.filters
    assert result["logged"] is True
    assert result["totals"]["protein_g"] == 30


def test_auto_memory_is_disabled_for_new_users_and_explicitly_toggleable(monkeypatch):
    class SettingsCollection:
        def __init__(self):
            self.metadata = {}
        def get(self, ids, include):
            assert include == ["metadatas"]
            return {"metadatas": [self.metadata] if self.metadata else [None]}
        def upsert(self, ids, documents, metadatas):
            assert len(ids) == 1
            self.metadata = metadatas[0]

    collection = SettingsCollection()
    monkeypatch.setattr(memory_client, "get_memory_settings_collection", lambda: collection)

    assert memory_client.get_auto_memory_enabled("athlete-123") is False
    memory_client.set_auto_memory_enabled("athlete-123", True)
    assert memory_client.get_auto_memory_enabled("athlete-123") is True
    memory_client.set_auto_memory_enabled("athlete-123", False)
    assert memory_client.get_auto_memory_enabled("athlete-123") is False
