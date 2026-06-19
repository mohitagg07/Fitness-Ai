"""
RepMind — AI Gym Spotter
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
from core.config import get_settings
from db.chroma_client import seed_guardrails

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Seed ChromaDB on startup.
    # DefaultEmbeddingFunction downloads a ~90MB ONNX model from HuggingFace
    # on first use. Without the timeout guard below, a slow/blocked download
    # will hang the lifespan hook indefinitely, preventing the server from
    # ever reaching "Application startup complete" — confirmed via live boot test.
    import asyncio as _asyncio
    try:
        await _asyncio.wait_for(
            _asyncio.to_thread(seed_guardrails),
            timeout=30.0,
        )
        print("ChromaDB guardrails seeded OK.")
    except _asyncio.TimeoutError:
        print(
            "WARNING: ChromaDB seed timed out (ONNX model download too slow). "
            "Guardrails will be unavailable until next restart. Server continuing."
        )
    except Exception as e:
        print(f"WARNING: ChromaDB seed failed: {e}. Server continuing without guardrails.")
    yield


app = FastAPI(
    title="RepMind AI Gym Spotter",
    description="Your AI Gym Spotter — remembers your journey, guides every rep, celebrates every PR.",
    version="2.0.0",
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


@app.get("/")
def root():
    return {
        "app": "RepMind AI Gym Spotter",
        "version": "2.0.0",
        "status": "running",
        "docs": "/docs",
    }


@app.get("/health")
def health():
    return {"status": "ok"}