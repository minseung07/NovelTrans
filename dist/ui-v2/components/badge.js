// Colored severity dot (●) + label. With color disabled it degrades to the
// plain label so non-color terminals stay readable.
import { getTheme } from "../theme/theme.js";
export function severityBadge(level, label) {
    const theme = getTheme();
    const colored = theme.severity(level, label);
    return theme.colorLevel > 0 ? `${theme.badge(level)} ${colored}` : colored;
}
