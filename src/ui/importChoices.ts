import type { RecipePresetId } from "./actions/settingsActions.js";

export type ImportAnalysisChoice = "start" | "recipe" | "glossary" | "cancel" | "invalid";

export function parseImportAnalysisChoice(value: string): ImportAnalysisChoice {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "start";
  }
  if (normalized === "e") {
    return "recipe";
  }
  if (normalized === "g") {
    return "glossary";
  }
  if (normalized === "\u001b" || normalized === "esc" || normalized === "q" || normalized === "cancel") {
    return "cancel";
  }
  return "invalid";
}

export function parseRecipePresetId(value: string): RecipePresetId | null {
  const preset = Number(value.trim());
  return preset >= 1 && preset <= 6 ? (preset as RecipePresetId) : null;
}
