// Shape-distinct severity glyph (always shown) + label. The glyph encodes
// severity by shape so it survives on no-color terminals; an empty label keeps
// a fixed 2-cell width so list flags stay aligned.

import { getTheme, type Severity } from "../theme/theme.js";

export type { Severity };

export function severityBadge(level: Severity, label: string): string {
  const theme = getTheme();
  const glyph = theme.colorLevel > 0 ? theme.severity(level, theme.severityGlyph(level)) : theme.severityGlyph(level);
  return label ? `${glyph} ${theme.severity(level, label)}` : `${glyph} `;
}
