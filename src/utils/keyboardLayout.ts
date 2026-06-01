const LEADS = [
  "r",
  "R",
  "s",
  "e",
  "E",
  "f",
  "a",
  "q",
  "Q",
  "t",
  "T",
  "d",
  "w",
  "W",
  "c",
  "z",
  "x",
  "v",
  "g"
] as const;

const VOWELS = [
  "k",
  "o",
  "i",
  "O",
  "j",
  "p",
  "u",
  "P",
  "h",
  "hk",
  "ho",
  "hl",
  "y",
  "n",
  "nj",
  "np",
  "nl",
  "b",
  "m",
  "ml",
  "l"
] as const;

const TAILS = [
  "",
  "r",
  "R",
  "rt",
  "s",
  "sw",
  "sg",
  "e",
  "f",
  "fr",
  "fa",
  "fq",
  "ft",
  "fx",
  "fv",
  "fg",
  "a",
  "q",
  "qt",
  "t",
  "T",
  "d",
  "w",
  "c",
  "z",
  "x",
  "v",
  "g"
] as const;

const JAMO_TO_QWERTY: Record<string, string> = {
  ㄱ: "r",
  ㄲ: "R",
  ㄳ: "rt",
  ㄴ: "s",
  ㄵ: "sw",
  ㄶ: "sg",
  ㄷ: "e",
  ㄸ: "E",
  ㄹ: "f",
  ㄺ: "fr",
  ㄻ: "fa",
  ㄼ: "fq",
  ㄽ: "ft",
  ㄾ: "fx",
  ㄿ: "fv",
  ㅀ: "fg",
  ㅁ: "a",
  ㅂ: "q",
  ㅃ: "Q",
  ㅄ: "qt",
  ㅅ: "t",
  ㅆ: "T",
  ㅇ: "d",
  ㅈ: "w",
  ㅉ: "W",
  ㅊ: "c",
  ㅋ: "z",
  ㅌ: "x",
  ㅍ: "v",
  ㅎ: "g",
  ㅏ: "k",
  ㅐ: "o",
  ㅑ: "i",
  ㅒ: "O",
  ㅓ: "j",
  ㅔ: "p",
  ㅕ: "u",
  ㅖ: "P",
  ㅗ: "h",
  ㅘ: "hk",
  ㅙ: "ho",
  ㅚ: "hl",
  ㅛ: "y",
  ㅜ: "n",
  ㅝ: "nj",
  ㅞ: "np",
  ㅟ: "nl",
  ㅠ: "b",
  ㅡ: "m",
  ㅢ: "ml",
  ㅣ: "l"
};

const HANGUL_BASE = 0xac00;
const HANGUL_END = 0xd7a3;
const MODERN_LEAD_BASE = 0x1100;
const MODERN_VOWEL_BASE = 0x1161;
const MODERN_TAIL_BASE = 0x11a7;
const VOWEL_COUNT = 21;
const TAIL_COUNT = 28;
const SYLLABLES_PER_LEAD = VOWEL_COUNT * TAIL_COUNT;

function qwertyFromKoreanKeyboard(value: string): string {
  let converted = "";
  for (const char of value) {
    converted += qwertyCharFromKoreanKeyboard(char);
  }
  return converted;
}

export function qwertyShortcutTokenFromKoreanPaste(value: string): string | null {
  const chars = [...value];
  if (chars.length !== 1) {
    return null;
  }
  const converted = qwertyFromKoreanKeyboard(value).toLowerCase();
  return converted !== value.toLowerCase() && converted.length === 1 ? converted : null;
}

function qwertyCharFromKoreanKeyboard(char: string): string {
  const mapped = JAMO_TO_QWERTY[char];
  if (mapped) {
    return mapped;
  }

  const code = char.codePointAt(0);
  if (code === undefined || code < HANGUL_BASE || code > HANGUL_END) {
    if (code !== undefined && code >= MODERN_LEAD_BASE && code < MODERN_LEAD_BASE + LEADS.length) {
      return LEADS[code - MODERN_LEAD_BASE] ?? char;
    }
    if (code !== undefined && code >= MODERN_VOWEL_BASE && code < MODERN_VOWEL_BASE + VOWELS.length) {
      return VOWELS[code - MODERN_VOWEL_BASE] ?? char;
    }
    if (code !== undefined && code > MODERN_TAIL_BASE && code < MODERN_TAIL_BASE + TAILS.length) {
      return TAILS[code - MODERN_TAIL_BASE] || char;
    }
    return char;
  }

  const offset = code - HANGUL_BASE;
  const lead = Math.floor(offset / SYLLABLES_PER_LEAD);
  const vowel = Math.floor((offset % SYLLABLES_PER_LEAD) / TAIL_COUNT);
  const tail = offset % TAIL_COUNT;
  return `${LEADS[lead] ?? ""}${VOWELS[vowel] ?? ""}${TAILS[tail] ?? ""}`;
}
