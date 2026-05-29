import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
export function normalizeSourcePathInput(value) {
    let normalized = stripBracketedPasteMarkers(value).trim();
    normalized = stripWrappingQuotes(normalized);
    if (normalized.startsWith("file://")) {
        try {
            normalized = fileURLToPath(normalized);
        }
        catch {
            return normalized;
        }
    }
    normalized = unescapeShellPath(normalized);
    if (normalized === "~") {
        return homedir();
    }
    if (normalized.startsWith("~/")) {
        return `${homedir()}${normalized.slice(1)}`;
    }
    return normalized;
}
export function stripBracketedPasteMarkers(value) {
    return value.replaceAll("\u001b[200~", "").replaceAll("\u001b[201~", "");
}
function stripWrappingQuotes(value) {
    let normalized = value;
    while (normalized.length >= 2 &&
        ((normalized.startsWith("'") && normalized.endsWith("'")) || (normalized.startsWith('"') && normalized.endsWith('"')))) {
        normalized = normalized.slice(1, -1).trim();
    }
    return normalized;
}
function unescapeShellPath(value) {
    return value.replace(/\\([\\ "'()&[\]{};$`!#*?|<>])/g, "$1");
}
