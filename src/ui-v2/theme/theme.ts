// Design tokens. Maps semantic roles to ANSI styling and box/icon glyphs,
// with ASCII + no-color fallbacks. A lazily-detected global theme keeps view
// function signatures unchanged while still enabling color on a real TTY.

import { type ColorLevel, detectColorLevel, detectUnicode } from "./capabilities.js";
import { fg256, sgr } from "./ansi.js";

export type Severity = "info" | "warning" | "critical" | "success";

type BoxChars = { tl: string; tr: string; bl: string; br: string; h: string; v: string };

interface Theme {
  colorLevel: ColorLevel;
  unicode: boolean;
  box: BoxChars;
  accent(text: string): string;
  muted(text: string): string;
  bold(text: string): string;
  severity(level: Severity, text: string): string;
  focus(text: string): string;
  severityGlyph(level: Severity): string;
  spinnerFrames: string[];
  progressFull: string;
  progressEmpty: string;
}

const SEVERITY_CODES: Record<Severity, { c256: number; basic: number }> = {
  info: { c256: 39, basic: 36 },
  warning: { c256: 214, basic: 33 },
  critical: { c256: 196, basic: 31 },
  success: { c256: 35, basic: 32 }
};

const UNICODE_BOX: BoxChars = { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" };
const ASCII_BOX: BoxChars = { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" };

// Shape-distinct glyphs so severity reads without relying on color.
const SEVERITY_GLYPHS: Record<Severity, { unicode: string; ascii: string }> = {
  info: { unicode: "●", ascii: "*" },
  warning: { unicode: "▲", ascii: "!" },
  critical: { unicode: "×", ascii: "x" },
  success: { unicode: "✓", ascii: "+" }
};

export function createTheme(colorLevel: ColorLevel, unicode: boolean): Theme {
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
    severityGlyph: (level) => (unicode ? SEVERITY_GLYPHS[level].unicode : SEVERITY_GLYPHS[level].ascii),
    spinnerFrames: unicode ? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] : ["|", "/", "-", "\\"],
    progressFull: unicode ? "█" : "#",
    progressEmpty: unicode ? "░" : "-"
  };
}

let activeTheme: Theme | null = null;

export function getTheme(): Theme {
  if (!activeTheme) {
    activeTheme = createTheme(detectColorLevel(process.stdout), detectUnicode(process.stdout));
  }
  return activeTheme;
}

export function setTheme(theme: Theme | null): void {
  activeTheme = theme;
}
