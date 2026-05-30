// Progress bar, percent-labeled progress line, and a frame-based spinner.

import { getTheme } from "../theme/theme.js";

function progressBar(percent: number, width = 16): string {
  const theme = getTheme();
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  return `[${theme.accent(theme.progressFull.repeat(filled))}${theme.progressEmpty.repeat(width - filled)}]`;
}

export function progressLine(percent: number, width = 16): string {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return `${progressBar(clamped, width)} ${clamped}%`;
}
