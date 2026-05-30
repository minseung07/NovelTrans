import { normalizeNewlines } from "../utils/text.js";

const afterwordMarkerPattern = /(?:あとがき|後書き|作者あとがき|作者より|作者から|Author'?s?\s+note)/iu;
const afterwordHeadingPattern = /^\s*(?:あとがき|後書き|作者あとがき|作者より|作者から|Author'?s?\s+note)(?:\s*[:：].*)?\s*$/iu;
const forewordHeadingPattern = /^\s*(?:まえがき|前書き|前書|はじめに|Author'?s?\s+preface|Preface)(?:\s*[:：].*)?\s*$/iu;

export function isForewordHeadingLine(line: string): boolean {
  return forewordHeadingPattern.test(line);
}

export function isAfterwordHeadingLine(line: string): boolean {
  return afterwordHeadingPattern.test(line);
}

export function hasAfterwordMarker(text: string): boolean {
  return afterwordMarkerPattern.test(text) || normalizeNewlines(text).split("\n").some(isAfterwordHeadingLine);
}
