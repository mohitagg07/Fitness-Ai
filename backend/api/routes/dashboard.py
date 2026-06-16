from fastapi import APIRouter, Depends
from core.security import get_current_user

router = APIRouter()

@router.get("/summary")
async def get_dashboard_summary(
    current_user: dict = Depends(get_current_user)
):
    return {
        "greeting": "Ready to train?",
        "cns_fatigue": 0,
        "sessions_this_week": 0,
        "next_session": None,
    }