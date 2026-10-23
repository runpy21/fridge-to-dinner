"""Fridge to Dinner: photo of your fridge in, one lazy dinner out. All local."""

import base64
import json
import os
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma3:4b")
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

LANGUAGES = {"en": "English", "de": "German (Deutsch)", "uk": "Ukrainian (Українська)"}

RESULT_SCHEMA = {
    "type": "object",
    "properties": {
        "ingredients": {"type": "array", "items": {"type": "string"}},
        "maybe": {"type": "array", "items": {"type": "string"}},
        "dish": {"type": "string"},
        "steps": {"type": "array", "items": {"type": "string"}, "maxItems": 5},
        "minutes": {"type": "integer"},
        "missing": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["ingredients", "maybe", "dish", "steps", "minutes", "missing"],
}

PROMPT = """You are looking at a photo of a fridge or pantry.

Rules:
1. "ingredients": list ONLY food items you can clearly see and identify. Be conservative:
   if you cannot read the label or see the food itself, it is not "clearly visible".
2. "maybe": items you think you see but are not sure about. Do not put them in "ingredients".
3. Never invent ingredients. Ignore brand names, appliance text, dishes, containers and
   anything that is not food. Something inside an opaque box is "maybe" at best.
4. "dish": suggest exactly ONE dinner that needs the fewest steps and uses only
   items from "ingredients", plus salt, pepper, oil and water. Prefer the laziest option.
5. "steps": at most 5 short steps, one sentence each.
6. "minutes": realistic total time in minutes, as an integer.
7. "missing": things the dish would normally need that are not visible (keep short; empty list if none).
8. Write every string in {language}.

Return only JSON matching the schema."""

STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="Fridge to Dinner")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.post("/api/dinner")
async def dinner(image: UploadFile = File(...), language: str = Form("en")) -> dict:
    if language not in LANGUAGES:
        raise HTTPException(400, "Unsupported language.")
    if not (image.content_type or "").startswith("image/"):
        raise HTTPException(400, "Please upload an image file.")

    data = await image.read()
    if not data:
        raise HTTPException(400, "The uploaded image is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Image is too large (max 10 MB).")

    payload = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "format": RESULT_SCHEMA,
        "options": {"temperature": 0.2},
        "messages": [
            {
                "role": "user",
                "content": PROMPT.format(language=LANGUAGES[language]),
                "images": [base64.b64encode(data).decode("ascii")],
            }
        ],
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
        result = json.loads(response.json()["message"]["content"])
    except (KeyError, ValueError, TypeError):
        raise HTTPException(502, "The model did not return valid JSON. Please try again.")

    result["steps"] = result.get("steps", [])[:5]
    result["model"] = OLLAMA_MODEL
    return result
