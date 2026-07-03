"""
Scenario Simulator route — "What If" engine.

main.py mounts this at prefix="/api/simulate".

Replaces the frontend's previous hardcoded-formula simulation
(SimulationScreen.tsx's local runSimulation()) with real projections
computed from the user's actual logged history. See
services/scenario_simulator.py for the model behind each scenario.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.security import get_current_user
from services.scenario_simulator import run_scenario, ScenarioId

router = APIRouter(tags=["Scenario Simulator"])


class ScenarioRequest(BaseModel):
    scenario_id: str
    weeks: int = 4


@router.post("/scenario")
async def simulate_scenario(
    payload: ScenarioRequest,
    current_user: dict = Depends(get_current_user),
):
    valid_ids = {"protein", "missWorkouts", "sleep", "calSurplus"}
    if payload.scenario_id not in valid_ids:
        raise HTTPException(400, f"scenario_id must be one of {sorted(valid_ids)}")

    try:
        result = run_scenario(current_user["user_id"], payload.scenario_id, payload.weeks)
    except Exception as e:
        raise HTTPException(500, f"Simulation failed: {e}")

    return result
