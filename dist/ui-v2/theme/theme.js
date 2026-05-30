// Design tokens. Maps semantic roles to ANSI styling and box/icon glyphs,
// with ASCII + no-color fallbacks. A lazily-detected global theme keeps view
// function signatures unchanged while still enabling color on a real TTY.
import { detectColorLevel, detectUnicode } from "./capabilities.js";
import { fg256, sgr } from "./ansi.js";
const SEVERITY_CODES = {
    info: { c256: 39, basic: 36 },
    warning: { c256: 214, basic: 33 },
    critical: { c256: 196, basic: 31 },
    success: { c256: 35, basic: 32 }
};
const UNICODE_BOX = { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" };
const ASCII_BOX = { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" };
export function createTheme(colorLevel, unicode) {
    const on = colorLevel > 0;
    return {
        colorLevel,
        unicode,
        box: unicode ? UNICODE_BOX : ASCII_BOX,
        accent: (text) => fg256(on, colorLevel, 44, 36, text),
        muted: (text) => sgr(on, [2], text),
        bold: (text) => sgr(on, [1], text),
        severity: (level, text) => {
            const code = SEVERITY_CODES[level];
            return fg256(on, colorLevel, code.c256, code.basic, text);
        },
        focus: (text) => sgr(on, [7], text),
        badge: (level) => {
            const dot = unicode ? "●" : "*";
            const code = SEVERITY_CODES[level];
            return fg256(on, colorLevel, code.c256, code.basic, dot);
        },
        spinnerFrames: unicode ? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] : ["|", "/", "-", "\\"],
        progressFull: unicode ? "█" : "#",
        progressEmpty: unicode ? "░" : "-"
    };
}
let activeTheme = null;
export function getTheme() {
    if (!activeTheme) {
        activeTheme = createTheme(detectColorLevel(process.stdout), detectUnicode(process.stdout));
    }
    return activeTheme;
}
export function setTheme(theme) {
    activeTheme = theme;
}
