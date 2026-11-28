"""Bounded LangGraph research loop for the VYRN Coach.

This subgraph gives the model control over *which* read-only tools to call.
It cannot write workouts, change profile data, log meals or schedule alerts.
Those actions are exposed through separate authenticated, user-confirmed APIs.
"""
from __future__ import annotations

import logging
from typing import Annotated, Any, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode

from agents.coach_tools import build_coach_tools

logger = logging.getLogger(__name__)
MAX_TOOL_ROUNDS = 3


class AgenticResearchState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    tool_rounds: int


def route_after_agent(state: AgenticResearchState) -> str:
    """Route tool calls back through the ToolNode, with a strict round limit."""
    messages = state.get("messages") or []
    last = messages[-1] if messages else None
    calls = getattr(last, "tool_calls", None) or []
    if not calls:
        return END
    if int(state.get("tool_rounds") or 0) > MAX_TOOL_ROUNDS:
        return "limit"
    return "tools"


def _limit_node(state: AgenticResearchState) -> dict:
    return {
        "messages": [
            AIMessage(content="I have reached the maximum data-check steps for this request. Use only the information already retrieved.")
        ]
    }


async def run_agentic_research(
    llm: Any,
    user_id: str,
    user_message: str,
    user_profile: dict | None = None,
) -> dict:
    """Run one bounded, user-scoped research/tool cycle and return its trace."""
    tools = build_coach_tools(user_id=user_id, profile=user_profile)
    model = llm.bind_tools(tools)

    async def agent_node(state: AgenticResearchState) -> dict:
        response = await model.ainvoke(state["messages"])
        return {
            "messages": [response],
            "tool_rounds": int(state.get("tool_rounds") or 0) + 1,
        }

    workflow = StateGraph(AgenticResearchState)
    workflow.add_node("agent", agent_node)
    workflow.add_node("tools", ToolNode(tools, handle_tool_errors=True))
    workflow.add_node("limit", _limit_node)
    workflow.set_entry_point("agent")
    workflow.add_conditional_edges(
        "agent",
        route_after_agent,
        {"tools": "tools", "limit": "limit", END: END},
    )
    workflow.add_edge("tools", "agent")
    workflow.add_edge("limit", END)
    graph = workflow.compile()

    system = SystemMessage(
        content=(
            "You are the read-only research stage for VYRN's fitness coach. "
            "Inspect the user's request and decide whether application data or "
            "curated fitness evidence is needed. Call only the tools that are "
            "relevant; do not call every tool by default. You may make at most "
            f"{MAX_TOOL_ROUNDS} tool rounds. Tools are already scoped to the "
            "authenticated user. Do not ask the user questions in this stage. "
            "Do not create or change plans, log activities, alter profile data, "
            "or schedule notifications. Never infer missing measurements. "
            "Return a concise factual research note after using tools, and "
            "state when a tool reports data unavailable."
        )
    )
    try:
        result = await graph.ainvoke(
            {
                "messages": [
                    system,
                    HumanMessage(content=str(user_message)[:3000]),
                ],
                "tool_rounds": 0,
            },
            config={"recursion_limit": 10},
        )
    except Exception as exc:
        logger.warning("Agentic research loop unavailable (%s)", type(exc).__name__)
        return {
            "findings": [],
            "tools_used": [],
            "tool_rounds": 0,
            "research_note": None,
            "available": False,
        }

    findings: list[dict] = []
    tools_used: list[str] = []
    research_note = None
    for message in result.get("messages") or []:
        if isinstance(message, ToolMessage):
            name = str(message.name or "tool")
            if name not in tools_used:
                tools_used.append(name)
            findings.append({
                "tool": name,
                "result": str(message.content or "")[:6000],
            })
        elif isinstance(message, AIMessage) and not (getattr(message, "tool_calls", None) or []):
            content = message.content
            if isinstance(content, str) and content.strip():
                research_note = content.strip()[:1800]

    return {
        "findings": findings[:MAX_TOOL_ROUNDS * 4],
        "tools_used": tools_used[:12],
        "tool_rounds": min(int(result.get("tool_rounds") or 0), MAX_TOOL_ROUNDS),
        "research_note": research_note,
        "available": True,
    }
