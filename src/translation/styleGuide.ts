import type { TranslationStyle } from "../domain/config.js";

export function styleGuideFor(style: TranslationStyle): string {
  if (style === "fast-draft") {
    return "Use a clear fast-draft Korean web novel style. Prioritize completeness, readable flow, and stable terminology over literary polish.";
  }
  if (style === "literary-naturalization") {
    return "Use polished natural Korean prose with literary rhythm. Preserve scene intent while smoothing awkward source phrasing.";
  }
  if (style === "literal-preserve") {
    return "Stay close to the source sentence order and nuance. Prefer faithful wording over aggressive localization.";
  }
  if (style === "terminology-consistency") {
    return "Prioritize glossary consistency and repeated-name stability above stylistic variation. Apply confirmed and locked terms exactly.";
  }
  if (style === "custom") {
    return "Use the project's custom translation style settings while preserving glossary rules and paragraph boundaries.";
  }
  return "Use a balanced Korean web novel style: natural, readable, faithful to plot details, and consistent with glossary terms.";
}
