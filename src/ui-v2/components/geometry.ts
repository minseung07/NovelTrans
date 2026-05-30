// Layout geometry: vertical stacking, two-column split, and a scroll window.

import { box } from "./box.js";
import { normalizeScreenWidth, padRight } from "./text.js";

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Stacks blocks with a blank separator line, skipping empty blocks.
export function stack(...blocks: string[][]): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    if (block.length === 0) {
      continue;
    }
    if (out.length > 0) {
      out.push("");
    }
    out.push(...block);
  }
  return out;
}

// Two side-by-side boxes; collapses to vertical stacking when too narrow.
export function columns(leftTitle: string, leftLines: string[], rightTitle: string, rightLines: string[], width?: number): string[] {
  const gap = 3;
  const normalizedWidth = normalizeScreenWidth(width);
  if (normalizedWidth < 68) {
    return [...box(leftTitle, leftLines, normalizedWidth), ...box(rightTitle, rightLines, normalizedWidth)];
  }
  const columnWidth = Math.floor((normalizedWidth - gap) / 2);
  const left = box(leftTitle, leftLines, columnWidth);
  const right = box(rightTitle, rightLines, normalizedWidth - columnWidth - gap);
  const height = Math.max(left.length, right.length);
  const result: string[] = [];
  for (let index = 0; index < height; index += 1) {
    result.push(`${padRight(left[index] ?? "", columnWidth)}${" ".repeat(gap)}${right[index] ?? ""}`);
  }
  return result;
}

// Joins two line blocks side by side, left padded to a fixed width.
export function row(left: string[], leftWidth: number, right: string[], gap = 2): string[] {
  const height = Math.max(left.length, right.length);
  const out: string[] = [];
  for (let index = 0; index < height; index += 1) {
    out.push(`${padRight(left[index] ?? "", leftWidth)}${" ".repeat(gap)}${right[index] ?? ""}`);
  }
  return out;
}

type VisibleWindow<T> = {
  items: T[];
  selectedOffset: number;
  hiddenBefore: number;
  hiddenAfter: number;
};

// A scroll window centered on the selected index, used to paginate long lists.
export function visibleWindow<T>(items: T[], selectedIndex: number, limit: number): VisibleWindow<T> {
  if (items.length === 0) {
    return { items: [], selectedOffset: 0, hiddenBefore: 0, hiddenAfter: 0 };
  }
  const size = Math.max(1, Math.min(limit, items.length));
  const selected = clamp(selectedIndex, 0, items.length - 1);
  const start = clamp(selected - Math.floor(size / 2), 0, Math.max(0, items.length - size));
  const end = start + size;
  return {
    items: items.slice(start, end),
    selectedOffset: selected - start,
    hiddenBefore: start,
    hiddenAfter: Math.max(0, items.length - end)
  };
}
