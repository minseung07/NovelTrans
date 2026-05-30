// Selection row with a consistent 2-cell prefix so selected/unselected rows
// stay aligned. A focused row gets an accent left bar (▌) + inverse content on a
// unicode color terminal; otherwise it falls back to the classic ">" marker.
import { getTheme } from "../theme/theme.js";
export function selectionRow(content, selected) {
    const theme = getTheme();
    if (!selected) {
        return `  ${content}`;
    }
    if (theme.unicode && theme.colorLevel > 0) {
        return `${theme.accent("▌")} ${theme.focus(content)}`;
    }
    return `> ${content}`;
}
