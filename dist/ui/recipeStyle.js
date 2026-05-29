export function translationStyleLabel(style) {
    if (style === "fast-draft") {
        return "빠른 초벌 번역";
    }
    if (style === "literary-naturalization") {
        return "문학적 자연화";
    }
    if (style === "literal-preserve") {
        return "직역 보존";
    }
    if (style === "terminology-consistency") {
        return "용어 일관성 우선";
    }
    if (style === "custom") {
        return "커스텀";
    }
    return "한국 웹소설 균형체";
}
