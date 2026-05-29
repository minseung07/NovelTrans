export type ParsedTranslationResponse = {
  titleKo: string;
  bodyKo: string;
  newGlossaryCandidates: string[];
};

type TranslationResponseJson = {
  titleKo?: unknown;
  bodyKo?: unknown;
  newGlossaryCandidates?: unknown;
};

export function parseTranslationResponse(content: string, fallbackTitle: string): ParsedTranslationResponse {
  const trimmed = content.trim();
  const parsed = parseJsonObject(trimmed);
  if (!parsed) {
    return {
      titleKo: fallbackTitle,
      bodyKo: trimmed,
      newGlossaryCandidates: []
    };
  }
  const titleKo = typeof parsed.titleKo === "string" && parsed.titleKo.trim() ? parsed.titleKo.trim() : fallbackTitle;
  const bodyKo = typeof parsed.bodyKo === "string" && parsed.bodyKo.trim() ? parsed.bodyKo.trim() : trimmed;
  const newGlossaryCandidates = Array.isArray(parsed.newGlossaryCandidates)
    ? parsed.newGlossaryCandidates.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
  return { titleKo, bodyKo, newGlossaryCandidates };
}

function parseJsonObject(content: string): TranslationResponseJson | null {
  const json = extractJson(content);
  if (!json) {
    return null;
  }
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as TranslationResponseJson) : null;
  } catch {
    return null;
  }
}

function extractJson(content: string): string | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  return content.slice(start, end + 1);
}
