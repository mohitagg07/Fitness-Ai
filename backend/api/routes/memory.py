"""
Memory API — exposes the ChromaDB personal fact store to the frontend.
Routes:
  GET    /api/memory          — returns all stored facts for the current user, grouped by category
  POST   /api/memory          — manually store a fact ("Remember: I train at 6am")
  DELETE /api/memory/{id}     — delete a specific fact by ID
Mounted in main.py under prefix="/api/memory".
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from core.security import get_current_user
from db.memory_client import remember, recall_all, forget

router = APIRouter(tags=["Memory"])

VALID_CATEGORIES = {
    "schedule", "food_preference", "equipment", "injury",
    "coaching_style", "goal_progress", "recovery_pattern", "general",
}


class MemoryCreate(BaseModel):
    fact: str = Field(min_length=3, max_length=500)
    category: str = Field(default="general")


@router.get("")
async def get_memories(current_user: dict = Depends(get_current_user)):
    """
    Return all stored facts for this user, grouped by category.
    Used by the Profile screen "What my coach knows" card.
    """
    user_id = current_user["user_id"]
    facts = recall_all(user_id)
    # Group by category for frontend rendering
    grouped: dict = {}
    for fact in facts:
        cat = fact.get("category", "general")
        grouped.setdefault(cat, []).append(fact)
    return {"facts": facts, "grouped": grouped, "total": len(facts)}


@router.post("", status_code=201)
async def add_memory(
    payload: MemoryCreate,
    current_user: dict = Depends(get_current_user),
):
    """
    Manually store a fact about the user.
    Frontend can call this from a "Remember this" button or coach chat shortcut.
    """
    category = payload.category if payload.category in VALID_CATEGORIES else "general"
    fact_id = remember(current_user["user_id"], payload.fact, category=category)
    if not fact_id:
        raise HTTPException(500, "Failed to store memory")
    return {"id": fact_id, "fact": payload.fact, "category": category}


@router.delete("/{fact_id}", status_code=204)
async def delete_memory(
    fact_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Delete a specific stored fact by its ChromaDB document ID."""
    try:
        forget(current_user["user_id"], fact_id)
    except Exception as e:
        raise HTTPException(404, f"Fact not found or could not be deleted: {e}")
