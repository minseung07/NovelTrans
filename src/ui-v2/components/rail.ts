// Stage rail (vertical, wide layout) with a narrow tab-strip fallback. Items
// carry an optional severity badge so pipeline state reads at a glance.

import { getTheme } from "../theme/theme.js";
import { box } from "./box.js";
import { selectionRow } from "./list.js";
import { severityBadge, type Severity } from "./badge.js";
import { visibleLength } from "./text.js";

export interface RailItem {
  label: string;
  badge?: { level: Severity; text: string };
}

function labelOf(item: RailItem, index: number): string {
  const badge = item.badge ? `  ${severityBadge(item.badge.level, item.badge.text)}` : "";
  return `${index + 1} ${item.label}${badge}`;
}

export function rail(items: RailItem[], activeIndex: number, width: number): string[] {
  return box(
    "단계",
    items.map((item, index) => selectionRow(labelOf(item, index), index === activeIndex)),
    width
  );
}

export function tabStrip(items: RailItem[], activeIndex: number, width: number): string {
  const theme = getTheme();
  const cells = items.map((item, index) => ` ${labelOf(item, index)} `);
  const widths = cells.map((cell) => visibleLength(cell));
  const render = (start: number, end: number): string => {
    const parts: string[] = [];
    if (start > 0) {
      parts.push(theme.muted("‹"));
    }
    for (let index = start; index < end; index += 1) {
      parts.push(index === activeIndex ? theme.focus(cells[index]!) : theme.muted(cells[index]!));
    }
    if (end < items.length) {
      parts.push(theme.muted("›"));
    }
    return parts.join("");
  };
  if (widths.reduce((sum, value) => sum + value, 0) <= width) {
    return render(0, items.length);
  }
  let start = activeIndex;
  let end = activeIndex + 1;
  let used = widths[activeIndex]!;
  for (let grew = true; grew; ) {
    grew = false;
    const avail = width - (start > 0 ? 1 : 0) - (end < items.length ? 1 : 0);
    if (end < items.length && used + widths[end]! <= avail) {
      used += widths[end]!;
      end += 1;
      grew = true;
    }
    if (start > 0 && used + widths[start - 1]! <= avail) {
      used += widths[start - 1]!;
      start -= 1;
      grew = true;
    }
  }
  return render(start, end);
}
