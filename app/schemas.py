"""Request bodies the browser sends us."""

from pydantic import BaseModel, Field


class RecipeRequest(BaseModel):
    ingredients: list[str] = Field(max_length=60)
    language: str = "en"
    avoid: list[str] = Field(default_factory=list, max_length=30)
