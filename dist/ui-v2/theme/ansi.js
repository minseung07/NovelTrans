// Low-level ANSI SGR styling. When disabled, all helpers return text unchanged.
// One self-contained reset per call avoids nested-reset bugs when segments are concatenated.
export const RESET = "\x1b[0m";
export function sgr(enabled, codes, text) {
    if (!enabled || codes.length === 0) {
        return text;
    }
    return `\x1b[${codes.join(";")}m${text}${RESET}`;
}
// Foreground via 256-color palette, downgraded to a basic 16-color code when level < 2.
export function fg256(enabled, level, code, basic, text) {
    if (!enabled) {
        return text;
    }
    return level >= 2 ? sgr(true, [38, 5, code], text) : sgr(true, [basic], text);
}
export const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
export function stripAnsi(value) {
    return value.replace(ANSI_PATTERN, "");
}
