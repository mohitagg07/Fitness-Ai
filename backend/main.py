"""
VYRN — Adaptive Performance System
FastAPI Backend — Main Entry Point
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from api.routes.auth import router as auth_router
from api.routes.profile import router as profile_router
from api.routes.workouts import router as workout_router
from api.routes.progress import router as progress_router
from api.routes.coach import router as coach_router
from api.routes.nutrition import router as nutrition_router
from api.routes.dashboard import router as dashboard_router
from api.routes.memory import router as memory_router
from api.routes.review import router as review_router
from api.routes.decisions import router as decisions_router
from api.routes.program import router as program_router
from api.routes.mission import router as mission_router
from api.routes.bodyweight import router as bodyweight_router
from api.routes.notifications import router as notifications_router
from api.routes.admin import router as admin_router
from api.routes.strategy import router as strategy_router
from api.routes.simulate import router as simulate_router
from api.routes.habits import router as habits_router
from api.routes.recovery import router as recovery_router
from core.config import get_settings, validate_runtime_security_settings
from db.chroma_client import seed_guardrails

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Never start with a publicly known or weak JWT signing key. The app
    # remains importable in offline tests; this validation runs at startup.
    validate_runtime_security_settings(settings)

    # Seed ChromaDB on startup
    try:
        seed_guardrails()
    except Exception as e:
        print(f"ChromaDB seed warning: {e}")

    # Scheduled jobs run in backend/worker.py, not inside API workers.
    # Starting APScheduler here would run one copy per Uvicorn worker and
    # per web replica, duplicating notifications, reviews, and reminders.
    yield


app = FastAPI(
    title="VYRN Adaptive Performance System",
    description="Your Adaptive Performance System — remembers your journey, guides every rep, celebrates every PR.",
    version="2.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(auth_router,      prefix="/api/auth",      tags=["Authentication"])
app.include_router(profile_router,   prefix="/api/profile",   tags=["Profile"])
app.include_router(workout_router,   prefix="/api/workouts",  tags=["Workouts"])
app.include_router(progress_router,  prefix="/api/progress",  tags=["Progress"])
app.include_router(coach_router,     prefix="/api/coach",     tags=["AI Coach"])
app.include_router(nutrition_router, prefix="/api/nutrition", tags=["Nutrition"])
app.include_router(dashboard_router, prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(memory_router,    prefix="/api/memory",    tags=["Memory"])
app.include_router(review_router,    prefix="/api/review",    tags=["Review"])
app.include_router(decisions_router, prefix="/api/decisions", tags=["Decision History"])
app.include_router(program_router,   prefix="/api/program",   tags=["Program Evolution"])
app.include_router(mission_router,   prefix="/api/mission",   tags=["Mission"])
app.include_router(bodyweight_router,    prefix="/api/bodyweight",    tags=["Body Weight"])
app.include_router(notifications_router, prefix="/api/notifications", tags=["Notifications"])
app.include_router(admin_router,    prefix="/api/admin",    tags=["Admin"])
app.include_router(strategy_router, prefix="/api/strategy", tags=["Training Strategy"])
app.include_router(simulate_router, prefix="/api/simulate", tags=["Scenario Simulator"])
app.include_router(habits_router,   prefix="/api/habits",   tags=["Habit Intelligence"])
app.include_router(recovery_router, prefix="/api/recovery", tags=["Recovery"])


@app.get("/")
@app.head("/")  # Render's health-check probe uses HEAD / — this stops the 405
def root():
    return {
        "app": "VYRN Adaptive Performance System",
        "version": "2.1.0",
        "status": "running",
        "docs": "/docs",
        # Remind integrators of the correct base URL format. The most common
        # misconfiguration is setting EXPO_PUBLIC_API_URL to this root URL
        # (https://app.onrender.com) instead of the correct API prefix
        # (https://app.onrender.com/api). If you're seeing 404 on
        # /auth/login, this is the likely cause.
        "api_base": "/api",
        "correct_expo_url_format": "https://THIS_DOMAIN/api",
    }


@app.get("/health")
@app.head("/health")
def health():
    return {"status": "ok"}