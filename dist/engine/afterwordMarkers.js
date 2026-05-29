import { normalizeNewlines } from "../utils/text.js";
const afterwordMarkerPattern = /(?:あとがき|後書き|作者あとがき|作者より|作者から|Author'?s?\s+note)/iu;
const afterwordHeadingPattern = /^\s*(?:あとがき|後書き|作者あとがき|作者より|作者から|Author'?s?\s+note)(?:\s*[:：].*)?\s*$/iu;
const forewordMarkerPattern = /(?:まえがき|前書き|前書|はじめに|Author'?s?\s+preface|Preface)/iu;
const forewordHeadingPattern = /^\s*(?:まえがき|前書き|前書|はじめに|Author'?s?\s+preface|Preface)(?:\s*[:：].*)?\s*$/iu;
export function isForewordHeadingLine(line) {
    return forewordHeadingPattern.test(line);
}
export function isAfterwordHeadingLine(line) {
    return afterwordHeadingPattern.test(line);
}
export function hasForewordMarker(text) {
    return forewordMarkerPattern.test(text) || normalizeNewlines(text).split("\n").some(isForewordHeadingLine);
}
export function hasAfterwordMarker(text) {
    return afterwordMarkerPattern.test(text) || normalizeNewlines(text).split("\n").some(isAfterwordHeadingLine);
}
