"""One local chat call, and the errors a missing Ollama should show."""

import json
import os

import httpx
from fastapi import HTTPException

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma3:4b")


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
