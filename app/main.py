"""Fridge to Dinner: photo of your fridge in, three lazy dinners out. All local."""

import base64
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.ollama import OLLAMA_MODEL, call_ollama, clean_list
from app.prompts import INGREDIENTS_SCHEMA, LANGUAGES, RECIPE_PROMPT, RECIPES_SCHEMA, VISION_PROMPT
from app.schemas import RecipeRequest

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="Fridge to Dinner")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.post("/api/ingredients")
async def ingredients(image: UploadFile = File(...), language: str = Form("en")) -> dict:
    if language not in LANGUAGES:
        raise HTTPException(400, "Unsupported language.")
    if not (image.content_type or "").startswith("image/"):
        raise HTTPException(400, "Please upload an image file.")

    data = await image.read()
    if not data:
        raise HTTPException(400, "The uploaded image is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Image is too large (max 10 MB).")

    message = {
        "role": "user",
        "content": VISION_PROMPT.format(language=LANGUAGES[language]),
        "images": [base64.b64encode(data).decode("ascii")],
    }
    result = await call_ollama(message, INGREDIENTS_SCHEMA, temperature=0.2)
    return {
        "ingredients": clean_list(result.get("ingredients")),
        "maybe": clean_list(result.get("maybe")),
        "model": OLLAMA_MODEL,
    }


@app.post("/api/recipes")
async def recipes(req: RecipeRequest) -> dict:
    if req.language not in LANGUAGES:
        raise HTTPException(400, "Unsupported language.")
    items = clean_list(req.ingredients)
    if not items:
        raise HTTPException(400, "Add at least one ingredient.")

    avoid = clean_list(req.avoid)
    avoid_line = (
        f"Do NOT suggest these dishes again or anything very similar: {', '.join(avoid)}." if avoid else ""
    )
    message = {
        "role": "user",
        "content": RECIPE_PROMPT.format(
            ingredients=", ".join(items), avoid=avoid_line, language=LANGUAGES[req.language]
        ),
    }
    result = await call_ollama(message, RECIPES_SCHEMA, temperature=0.7)

    out = []
    for r in result.get("recipes", []) if isinstance(result.get("recipes"), list) else []:
        if not isinstance(r, dict) or not isinstance(r.get("dish"), str):
            continue
        out.append(
            {
                "dish": r["dish"].strip(),
                "minutes": r.get("minutes") if isinstance(r.get("minutes"), int) else None,
                "steps": clean_list(r.get("steps"))[:5],
                "missing": clean_list(r.get("missing")),
            }
        )
    if not out:
        raise HTTPException(502, "The model did not return any recipes. Please try again.")
    return {"recipes": out[:3], "model": OLLAMA_MODEL}
