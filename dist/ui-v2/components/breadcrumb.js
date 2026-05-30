// Navigation path shown at the top of each screen, e.g. "Library › 작품".
// The last segment is highlighted; earlier segments are dimmed.
import { getTheme } from "../theme/theme.js";
export function breadcrumb(segments) {
    const theme = getTheme();
    const shown = segments.filter(Boolean);
    const sep = theme.muted(theme.unicode ? " › " : " > ");
    return shown
        .map((segment, index) => (index === shown.length - 1 ? theme.bold(theme.accent(segment)) : theme.muted(segment)))
        .join(sep);
}
