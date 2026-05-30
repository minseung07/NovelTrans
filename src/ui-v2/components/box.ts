// Titled bordered box. Rounded unicode border on capable terminals, ASCII
// fallback otherwise (driven by the v2 theme).

import { getTheme } from "../theme/theme.js";
import { normalizeBoxWidth, padRight, truncate, visibleLength } from "./text.js";

export function box(title: string, lines: string[], width?: number): string[] {
  const theme = getTheme();
  const { tl, tr, bl, br, h, v } = theme.box;
  const normalizedWidth = normalizeBoxWidth(width);
  const innerWidth = normalizedWidth - 4;
  const heading = `${h} ${title} `;
  const fill = h.repeat(Math.max(0, innerWidth - visibleLength(heading) + 1));
  const top = `${tl}${h}${h} ${theme.bold(theme.accent(title))} ${fill}${tr}`;
  const bottom = `${bl}${h.repeat(normalizedWidth - 2)}${br}`;
  return [top, ...lines.map((line) => `${v} ${padRight(truncate(line, innerWidth), innerWidth)} ${v}`), bottom];
}

// A panel is a box; the alias lets screens express intent ("static panel" vs
// "card") without diverging implementations.
export const panel = box;
