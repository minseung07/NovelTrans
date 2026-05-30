const japanesePattern = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/u;
const japaneseGlobalPattern = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/gu;

export function hasJapanese(value: string): boolean {
  return japanesePattern.test(value);
}

export function japaneseCharacterCount(value: string): number {
  return Array.from(value.matchAll(japaneseGlobalPattern)).length;
}

export function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

export function paragraphs(value: string): string[] {
  return normalizeNewlines(value)
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function extractNumbers(value: string): string[] {
  return Array.from(value.matchAll(/[0-9０-９]+/g), (match) => normalizeDigits(match[0] ?? ""));
}

function normalizeDigits(value: string): string {
  return value.replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10));
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}
