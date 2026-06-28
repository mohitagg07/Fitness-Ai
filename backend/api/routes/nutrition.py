# backend/api/routes/nutrition.py — search endpoint
import httpx

@router.get("/search")
async def search_food(q: str, max_results: int = 8, current_user: dict = Depends(get_current_user)):
    async with httpx.AsyncClient() as client:
        res = await client.get(
            "https://world.openfoodfacts.org/cgi/search.pl",
            params={"search_terms": q, "json": 1, "page_size": max_results, "fields": "product_name,nutriments,code"},
            timeout=10
        )
    products = res.json().get("products", [])
    foods = []
    for p in products:
        n = p.get("nutriments", {})
        foods.append({
            "food_id": p.get("code"),
            "food_name": p.get("product_name", "Unknown"),
            "calories": round(n.get("energy-kcal_100g", 0)),
            "protein_g": round(n.get("proteins_100g", 0), 1),
            "carbs_g": round(n.get("carbohydrates_100g", 0), 1),
            "fat_g": round(n.get("fat_100g", 0), 1),
        })
    return {"foods": [f for f in foods if f["food_name"] and f["calories"] > 0]}