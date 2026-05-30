// Text & width primitives. The CJK cell-width logic is ported verbatim from the
// legacy layout module so wide-character alignment does not regress.

import { ANSI_PATTERN } from "../theme/ansi.js";

export const SCREEN_WIDTH = 74;
export const MIN_SCREEN_WIDTH = 44;
export const MAX_SCREEN_WIDTH = 120;

export function normalizeScreenWidth(width?: number): number {
  if (!width || !Number.isFinite(width)) {
    return SCREEN_WIDTH;
  }
  return Math.max(MIN_SCREEN_WIDTH, Math.min(MAX_SCREEN_WIDTH, Math.floor(width)));
}

export function normalizeBoxWidth(width?: number): number {
  if (!width || !Number.isFinite(width)) {
    return SCREEN_WIDTH;
  }
  return Math.max(20, Math.min(MAX_SCREEN_WIDTH, Math.floor(width)));
}

export function visibleLength(value: string): number {
  return Array.from(value.replace(ANSI_PATTERN, "")).reduce((length, char) => length + charCellWidth(char), 0);
}

export function padRight(value: string, width: number): string {
  const length = visibleLength(value);
  return length >= width ? value : `${value}${" ".repeat(width - length)}`;
}

export function truncate(value: string, width: number): string {
  if (visibleLength(value) <= width) {
    return value;
  }
  if (width <= 1) {
    return "…";
  }
  const target = Math.max(0, width - 1);
  let used = 0;
  let out = "";
  let styled = false;
  for (const token of value.split(/(\x1b\[[0-9;]*m)/)) {
    if (token === "") {
      continue;
    }
    if (/^\x1b\[[0-9;]*m$/.test(token)) {
      out += token;
      styled = true;
      continue;
    }
    for (const char of Array.from(token)) {
      const charWidth = charCellWidth(char);
      if (used + charWidth > target) {
        return `${out}…${styled ? "\x1b[0m" : ""}`;
      }
      out += char;
      used += charWidth;
    }
  }
  return `${out}…${styled ? "\x1b[0m" : ""}`;
}

export function formatRelativeTime(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) {
    return "unknown";
  }
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function charCellWidth(char: string): number {
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint === 0 || codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) {
    return 0;
  }
  if (isCombiningMark(codePoint)) {
    return 0;
  }
  return isWideCodePoint(codePoint) ? 2 : 1;
}

function isCombiningMark(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  );
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1faff))
  );
}
