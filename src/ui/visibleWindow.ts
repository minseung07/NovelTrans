export type VisibleWindow<T> = {
  items: T[];
  selectedIndex: number;
  selectedOffset: number;
  hiddenBefore: number;
  hiddenAfter: number;
};

export function visibleWindow<T>(items: T[], selectedIndex: number, limit: number): VisibleWindow<T> {
  if (items.length === 0) {
    return { items: [], selectedIndex: 0, selectedOffset: 0, hiddenBefore: 0, hiddenAfter: 0 };
  }
  const size = Math.max(1, Math.min(limit, items.length));
  const effectiveSelectedIndex = clamp(selectedIndex, 0, items.length - 1);
  const preferredStart = effectiveSelectedIndex - Math.floor(size / 2);
  const start = clamp(preferredStart, 0, Math.max(0, items.length - size));
  const end = start + size;
  return {
    items: items.slice(start, end),
    selectedIndex: effectiveSelectedIndex,
    selectedOffset: effectiveSelectedIndex - start,
    hiddenBefore: start,
    hiddenAfter: Math.max(0, items.length - end)
  };
}

export function clamp(index: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, index));
}
