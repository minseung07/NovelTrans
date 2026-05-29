const japanesePattern = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/u;
const japaneseGlobalPattern = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/gu;
export function hasJapanese(value) {
    return japanesePattern.test(value);
}
export function japaneseCharacterCount(value) {
    return Array.from(value.matchAll(japaneseGlobalPattern)).length;
}
export function normalizeNewlines(value) {
    return value.replace(/\r\n?/g, "\n");
}
export function paragraphs(value) {
    return normalizeNewlines(value)
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .filter(Boolean);
}
export function extractNumbers(value) {
    return Array.from(value.matchAll(/[0-9０-９]+/g), (match) => normalizeDigits(match[0] ?? ""));
}
export function normalizeDigits(value) {
    return value.replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10));
}
export function escapeXml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&apos;");
}
