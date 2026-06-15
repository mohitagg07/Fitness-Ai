from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routes_user import router as user_router
from api.routes_workout import router as workout_router
from api.routes_diet import router as diet_router
from api.routes_progress import router as progress_router
from api.routes_chat import router as chat_router

app = FastAPI(
    title="FitMind AI",
    description="Agentic Multimodal Fitness Ecosystem API",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(user_router, prefix="/api/user", tags=["User"])
app.include_router(workout_router, prefix="/api/workout", tags=["Workout"])
app.include_router(diet_router, prefix="/api/diet", tags=["Diet"])
app.include_router(progress_router, prefix="/api/progress", tags=["Progress"])
app.include_router(chat_router, prefix="/api/chat", tags=["AI Coach"])

@app.get("/")
def root():
    return {"status": "FitMind AI running", "version": "1.0.0"}

@app.get("/health")
def health():
    return {"status": "ok"}