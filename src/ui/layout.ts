export const screenWidth = 74;
export const minScreenWidth = 44;
export const maxScreenWidth = 120;

export type ScreenOptions = {
  width?: number;
};

export type Viewport = {
  width?: number;
  height?: number;
};

export function normalizeScreenWidth(width?: number): number {
  if (!width || !Number.isFinite(width)) {
    return screenWidth;
  }
  return Math.max(minScreenWidth, Math.min(maxScreenWidth, Math.floor(width)));
}

export function renderScreen(title: string, subtitle: string, body: string[], footer: string, options: ScreenOptions = {}): string {
  const lines = [title, subtitle, "", ...body, "", footer];
  if (!options.width) {
    return lines.join("\n");
  }
  const width = normalizeScreenWidth(options.width);
  return lines.map((line) => truncate(line, width)).join("\n");
}

export function box(title: string, lines: string[], width = screenWidth): string[] {
  const normalizedWidth = normalizeBoxWidth(width);
  const innerWidth = normalizedWidth - 4;
  const heading = `- ${title} `;
  const top = `+-${heading}${"-".repeat(Math.max(0, innerWidth - visibleLength(heading) + 1))}+`;
  const bottom = `+${"-".repeat(normalizedWidth - 2)}+`;
  return [top, ...lines.map((line) => `| ${padRight(truncate(line, innerWidth), innerWidth)} |`), bottom];
}

function normalizeBoxWidth(width?: number): number {
  if (!width || !Number.isFinite(width)) {
    return screenWidth;
  }
  return Math.max(20, Math.min(maxScreenWidth, Math.floor(width)));
}

export function columns(leftTitle: string, leftLines: string[], rightTitle: string, rightLines: string[], width = screenWidth): string[] {
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

export function progressBar(percent: number, width = 16): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
}

export function table(rows: Array<[string, string | number]>, labelWidth = 14): string[] {
  return rows.map(([label, value]) => `${padRight(label, labelWidth)} ${value}`);
}

export function bullet(lines: string[]): string[] {
  return lines.map((line) => `- ${line}`);
}

export function padRight(value: string, width: number): string {
  const length = visibleLength(value);
  if (length >= width) {
    return value;
  }
  return `${value}${" ".repeat(width - length)}`;
}

export function truncate(value: string, width: number): string {
  if (visibleLength(value) <= width) {
    return value;
  }
  if (width <= 1) {
    return "…";
  }
  const ellipsisWidth = visibleLength("…");
  const target = Math.max(0, width - ellipsisWidth);
  let used = 0;
  const chars: string[] = [];
  for (const char of Array.from(value)) {
    const charWidth = charCellWidth(char);
    if (used + charWidth > target) {
      break;
    }
    chars.push(char);
    used += charWidth;
  }
  return `${chars.join("")}…`;
}

export function fitToViewport(screen: string, viewport: Viewport = {}): string {
  const width = normalizeScreenWidth(viewport.width);
  const height = viewport.height && Number.isFinite(viewport.height) ? Math.max(1, Math.floor(viewport.height)) : null;
  const lines = screen.split("\n").map((line) => truncate(line, width));
  if (!height || lines.length <= height) {
    return lines.join("\n");
  }
  if (height === 1) {
    return truncate(lines[0] ?? "", width);
  }
  if (height === 2) {
    return [lines[0] ?? "", "…"].join("\n");
  }

  const headCount = Math.min(6, Math.max(1, Math.floor(height * 0.55)));
  const tailCount = Math.max(1, height - headCount - 1);
  return [...lines.slice(0, headCount), "…", ...lines.slice(lines.length - tailCount)].join("\n");
}

export function formatRelativeTime(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) {
    return "unknown";
  }
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.round(hours / 24)}d ago`;
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }
  return date.toISOString().slice(11, 19);
}

export function visibleLength(value: string): number {
  return Array.from(value).reduce((length, char) => length + charCellWidth(char), 0);
}

function charCellWidth(char: string): number {
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint === 0) {
    return 0;
  }
  if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) {
    return 0;
  }
  if (isCombiningMark(codePoint)) {
    return 0;
  }
  if (isWideCodePoint(codePoint)) {
    return 2;
  }
  return 1;
}

function isCombiningMark(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  );
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1faff))
  );
}
