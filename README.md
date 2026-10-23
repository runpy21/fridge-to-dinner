# Fridge to Dinner

Take a photo of your open fridge or pantry. Get **one** dinner that needs the
fewest steps and uses only what's visible (plus salt, pepper, oil and water).

Built for the Hacktoberfest Open-Source AI Challenge, theme *Slow and Steady*:
reward laziness. No shopping list, no meal plan, no account. Just dinner.

Everything runs on your machine through [Ollama](https://ollama.com) with an
open-weight vision model. **100% local. Your photos never leave your machine.**

## How it works

1. You drop in a photo. The browser shrinks it to max 1024 px before upload.
2. FastAPI sends the image to Ollama's `/api/chat` with a JSON schema.
3. The model lists the ingredients it clearly sees, puts uncertain ones under
   "maybe", and suggests the laziest dinner it can make from them, in at most
   5 steps, in the language you picked (English, Deutsch, Українська).

## Setup

Requires Python 3.11+ and Ollama.

```bash
# 1. Install Ollama: https://ollama.com/download
# 2. Pull the default vision model (about 3 GB)
ollama pull gemma3:4b

# 3. Install and run the app
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000 and drop in a fridge photo.

## Configuration

| Variable       | Default                  | What it does                              |
| -------------- | ------------------------ | ----------------------------------------- |
| `OLLAMA_MODEL` | `gemma3:4b`              | Any Ollama model that accepts images      |
| `OLLAMA_HOST`  | `http://localhost:11434` | Where Ollama is listening                 |

Example with a bigger model:

```bash
ollama pull gemma3:12b
OLLAMA_MODEL=gemma3:12b python -m uvicorn app.main:app --reload
```

## API

`POST /api/dinner` with multipart fields `image` (file) and `language`
(`en`, `de` or `uk`). Returns:

```json
{
  "ingredients": ["eggs", "tomatoes", "cheese"],
  "maybe": ["spring onions"],
  "dish": "Tomato and cheese omelette",
  "steps": ["Beat the eggs.", "..."],
  "minutes": 10,
  "missing": [],
  "model": "gemma3:4b"
}
```

## Project layout

```
app/main.py            FastAPI app and Ollama call
app/static/index.html  The whole UI, no framework
```

## License

MIT, see [LICENSE](LICENSE).
