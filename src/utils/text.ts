const japanesePattern = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/u;
const japaneseGlobalPattern = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/gu;
const numberTokenPattern = /[0-9０-９]+|[零〇一二三四五六七八九十百千万億]+/gu;
const japaneseDigitValues: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
};
const japaneseSmallUnits: Record<string, number> = {
  十: 10,
  百: 100,
  千: 1000
};
const japaneseLargeUnits: Record<string, number> = {
  万: 10000,
  億: 100000000
};

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
  return Array.from(value.matchAll(numberTokenPattern), (match) => normalizeNumberToken(match[0] ?? "")).filter(Boolean);
}

function normalizeNumberToken(value: string): string {
  const normalizedDigits = normalizeDigits(value);
  if (/^[0-9]+$/.test(normalizedDigits)) {
    return stripLeadingZeroes(normalizedDigits);
  }
  const japaneseNumber = parseJapaneseNumeral(value);
  return japaneseNumber === null ? "" : String(japaneseNumber);
}

function normalizeDigits(value: string): string {
  return value.replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10));
}

function stripLeadingZeroes(value: string): string {
  return value.replace(/^0+(?=\d)/, "");
}

function parseJapaneseNumeral(value: string): number | null {
  if (/^[零〇一二三四五六七八九]+$/u.test(value)) {
    return Number(Array.from(value, (char) => japaneseDigitValues[char] ?? 0).join(""));
  }

  let total = 0;
  let section = 0;
  let current: number | null = null;
  let sawNumeral = false;
  for (const char of value) {
    if (char in japaneseDigitValues) {
      current = japaneseDigitValues[char] ?? 0;
      sawNumeral = true;
      continue;
    }
    if (char in japaneseSmallUnits) {
      section += (current ?? 1) * (japaneseSmallUnits[char] ?? 1);
      current = null;
      sawNumeral = true;
      continue;
    }
    if (char in japaneseLargeUnits) {
      const sectionValue = section + (current ?? 0);
      total += (sectionValue || 1) * (japaneseLargeUnits[char] ?? 1);
      section = 0;
      current = null;
      sawNumeral = true;
      continue;
    }
    return null;
  }
  if (!sawNumeral) {
    return null;
  }
  return total + section + (current ?? 0);
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}
