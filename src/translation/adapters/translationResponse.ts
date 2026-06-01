type ParsedTranslationResponse = {
  titleKo: string;
  bodyKo: string;
  newGlossaryCandidates: string[];
};

type TranslationResponseJson = {
  titleKo?: unknown;
  bodyKo?: unknown;
  newGlossaryCandidates?: unknown;
};

type ParseTranslationResponseOptions = {
  strict?: boolean;
};

export function parseTranslationResponse(content: string, fallbackTitle: string, options: ParseTranslationResponseOptions = {}): ParsedTranslationResponse {
  const trimmed = content.trim();
  const parsed = parseJsonObject(trimmed);
  if (!parsed) {
    if (options.strict) {
      throw new Error("번역 응답이 strict JSON 객체가 아닙니다.");
    }
    return {
      titleKo: fallbackTitle,
      bodyKo: trimmed,
      newGlossaryCandidates: []
    };
  }
  if (options.strict) {
    return parseStrictTranslationResponse(parsed);
  }
  const titleKo = typeof parsed.titleKo === "string" && parsed.titleKo.trim() ? parsed.titleKo.trim() : fallbackTitle;
  const bodyKo = typeof parsed.bodyKo === "string" && parsed.bodyKo.trim() ? parsed.bodyKo.trim() : trimmed;
  const newGlossaryCandidates = Array.isArray(parsed.newGlossaryCandidates)
    ? parsed.newGlossaryCandidates.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
  return { titleKo, bodyKo, newGlossaryCandidates };
}

function parseStrictTranslationResponse(parsed: TranslationResponseJson): ParsedTranslationResponse {
  if (typeof parsed.titleKo !== "string" || !parsed.titleKo.trim()) {
    throw new Error("번역 응답 JSON에 titleKo 문자열이 필요합니다.");
  }
  if (typeof parsed.bodyKo !== "string" || !parsed.bodyKo.trim()) {
    throw new Error("번역 응답 JSON에 bodyKo 문자열이 필요합니다.");
  }
  if (!Array.isArray(parsed.newGlossaryCandidates)) {
    throw new Error("번역 응답 JSON에 newGlossaryCandidates 배열이 필요합니다.");
  }
  return {
    titleKo: parsed.titleKo.trim(),
    bodyKo: parsed.bodyKo.trim(),
    newGlossaryCandidates: parsed.newGlossaryCandidates.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
  };
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
