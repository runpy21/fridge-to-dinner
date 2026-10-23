"""Fridge to Dinner: photo of your fridge in, three lazy dinners out. All local."""

import base64
import json
import os
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma3:4b")
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

LANGUAGES = {"en": "English", "de": "German (Deutsch)", "uk": "Ukrainian (Українська)"}

STRING_LIST = {"type": "array", "items": {"type": "string"}}

INGREDIENTS_SCHEMA = {
    "type": "object",
    "properties": {"ingredients": STRING_LIST, "maybe": STRING_LIST},
    "required": ["ingredients", "maybe"],
}

RECIPES_SCHEMA = {
    "type": "object",
    "properties": {
        "recipes": {
            "type": "array",
            "minItems": 3,
            "maxItems": 3,
            "items": {
                "type": "object",
                "properties": {
                    "dish": {"type": "string"},
                    "minutes": {"type": "integer"},
                    "steps": {"type": "array", "items": {"type": "string"}, "maxItems": 5},
                    "missing": STRING_LIST,
                },
                "required": ["dish", "minutes", "steps", "missing"],
            },
        }
    },
    "required": ["recipes"],
}

VISION_PROMPT = """You are looking at a photo of a fridge or pantry.

Rules:
1. "ingredients": list ONLY food items you can clearly see and identify. Be conservative:
   if you cannot read the label or see the food itself, it is not "clearly visible".
2. "maybe": items you think you see but are not sure about. Do not put them in "ingredients".
3. Never invent ingredients. Ignore brand names, appliance text, dishes, containers and
   anything that is not food. Something inside an opaque box is "maybe" at best.
4. Write every string in {language}.

Return only JSON matching the schema."""

RECIPE_PROMPT = """Available ingredients: {ingredients}.
{avoid}
Suggest exactly 3 dinners that are clearly different from each other, for example a
different cooking method or cuisine. Prefer lazy dishes with few steps.

Rules:
1. Use mostly the available ingredients, plus salt, pepper, oil and water.
2. Never invent ingredients that are not in the list. If a dish needs something else,
   put it under "missing" (keep it short; empty list if nothing is missing).
3. "steps": at most 5 short steps, one sentence each.
4. "minutes": realistic total time in minutes, as an integer.
5. Write every string in {language}.

Return only JSON matching the schema."""

STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="Fridge to Dinner")


class RecipeRequest(BaseModel):
    ingredients: list[str] = Field(max_length=60)
    language: str = "en"
    avoid: list[str] = Field(default_factory=list, max_length=30)


async def call_ollama(message: dict, schema: dict, temperature: float) -> dict:
    payload = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "format": schema,
        "options": {"temperature": temperature},
        "messages": [message],
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=5.0)) as client:
            response = await client.post(f"{OLLAMA_HOST}/api/chat", json=payload)
    except httpx.ConnectError:
        raise HTTPException(
            503, f"Ollama is not running at {OLLAMA_HOST}. Start it with `ollama serve` and try again."
        )
    except httpx.TimeoutException:
        raise HTTPException(504, "Ollama took too long to answer. Try a smaller photo or a smaller model.")

    if response.status_code == 404 or "not found" in response.text.lower():
        raise HTTPException(
            503, f"Model `{OLLAMA_MODEL}` is not installed. Run `ollama pull {OLLAMA_MODEL}` and try again."
        )
    if response.status_code != 200:
        raise HTTPException(502, f"Ollama returned an error: {response.text[:300]}")

    try:
        return json.loads(response.json()["message"]["content"])
    except (KeyError, ValueError, TypeError):
        raise HTTPException(502, "The model did not return valid JSON. Please try again.")


def clean_list(items: object) -> list[str]:
    return [s.strip() for s in items if isinstance(s, str) and s.strip()] if isinstance(items, list) else []


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
