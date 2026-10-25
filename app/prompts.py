"""What we ask the model, and the JSON shape we require back."""

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
