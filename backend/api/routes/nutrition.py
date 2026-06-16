from fastapi import APIRouter, Depends
from core.security import get_current_user

router = APIRouter()

@router.get("/targets")
async def get_nutrition_targets(
    is_training_day: bool = True,
    current_user: dict = Depends(get_current_user)
):
    # Basic targets — later the AI agent will personalize these
    base_calories = 2500 if is_training_day else 2000
    return {
        "calories": base_calories,
        "protein_g": 180,
        "carbs_g": 280 if is_training_day else 200,
        "fat_g": 70,
        "water_ml": 3500,
        "tdee": base_calories,
        "is_training_day": is_training_day,
        "goal": "maintain"
    }

@router.post("/log")
async def log_nutrition(
    data: dict,
    current_user: dict = Depends(get_current_user)
):
    return {"status": "logged", "data": data}

@router.get("/history")
async def get_nutrition_history(
    limit: int = 30,
    current_user: dict = Depends(get_current_user)
):
    return []