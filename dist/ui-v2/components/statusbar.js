// Persistent bottom bar: dimmed, separator-joined meta segments.
import { getTheme } from "../theme/theme.js";
export function statusBar(parts) {
    const theme = getTheme();
    const sep = theme.unicode ? "  ·  " : "  |  ";
    return theme.muted(parts.filter(Boolean).join(sep));
}
