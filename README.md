# Fridge to Dinner

Take a photo of your open fridge or pantry. Get **three** different dinners
that need few steps and use mostly what's visible (plus salt, pepper, oil and
water).

Built for the Hacktoberfest Open-Source AI Challenge, theme *Slow and Steady*:
reward laziness. No shopping list, no meal plan, no account. Just dinner.

Everything runs on your machine through [Ollama](https://ollama.com) with an
open-weight vision model. **100% local. Your photos never leave your machine.**

## How it works

Two model calls, same local model, nothing stored in between.

1. **Look.** You drop in a photo; the browser shrinks it to max 1024 px before
   upload. FastAPI sends it to Ollama's `/api/chat` with a JSON schema and the
   vision model lists the ingredients it clearly sees. Anything it is unsure
   about goes under "maybe".
2. **Fix the list.** The ingredients show up as chips. Click × to drop a wrong
   guess, click + on a "maybe" to confirm it, or type in something the model
   missed. The model never sees the photo again, only this list.
3. **Cook.** "Suggest dinners" sends the confirmed list (text only) back to the
   model and asks for exactly 3 clearly different dishes, each with at most 5
   short steps, a time estimate and a "missing" list for anything the dish
   needs that is not in your fridge. "Show me 3 different ideas" asks again
   while telling the model which dishes it already suggested.
4. **Keep.** Click "Save" on a recipe you like. Saved recipes live in your
   browser's `localStorage` and show up under the "Saved recipes" tab. The
   server never sees them.

Everything is answered in the language you picked (English, Deutsch,
Українська).

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

`POST /api/ingredients` with multipart fields `image` (file) and `language`
(`en`, `de` or `uk`). Returns:

```json
{
  "ingredients": ["eggs", "tomatoes", "cheese"],
  "maybe": ["spring onions"],
  "model": "gemma3:4b"
}
```

`POST /api/recipes` with a JSON body `{"ingredients": [...], "language": "en",
"avoid": ["dishes already shown"]}` (`avoid` is optional). Returns:

```json
{
  "recipes": [
    {
      "dish": "Tomato and cheese omelette",
      "minutes": 10,
      "steps": ["Beat the eggs.", "..."],
      "missing": []
    }
  ],
  "model": "gemma3:4b"
}
```

## Project layout

```
app/main.py            FastAPI app and the two Ollama calls
app/static/index.html  The whole UI, no framework
```

## License

MIT, see [LICENSE](LICENSE).
