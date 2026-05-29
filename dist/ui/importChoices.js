export function parseImportAnalysisChoice(value) {
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
export function parseRecipePresetId(value) {
    const preset = Number(value.trim());
    return preset >= 1 && preset <= 6 ? preset : null;
}
