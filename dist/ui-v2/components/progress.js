// Progress bar, percent-labeled progress line, and a frame-based spinner.
import { getTheme } from "../theme/theme.js";
export function progressBar(percent, width = 16) {
    const theme = getTheme();
    const clamped = Math.max(0, Math.min(100, percent));
    const filled = Math.round((clamped / 100) * width);
    return `[${theme.accent(theme.progressFull.repeat(filled))}${theme.progressEmpty.repeat(width - filled)}]`;
}
export function progressLine(percent, width = 16) {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    return `${progressBar(clamped, width)} ${clamped}%`;
}
export function spinnerFrame(tick) {
    const frames = getTheme().spinnerFrames;
    return frames[Math.abs(Math.floor(tick)) % frames.length] ?? frames[0];
}
