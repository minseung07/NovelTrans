export function extractMetaContent(html, key) {
    const escapedKey = escapeRegExp(key);
    const patterns = [
        new RegExp(`<meta\\b[^>]*(?:property|name)=["']${escapedKey}["'][^>]*content=["']([^"']*)["'][^>]*>`, "i"),
        new RegExp(`<meta\\b[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${escapedKey}["'][^>]*>`, "i")
    ];
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match?.[1]) {
            return decodeHtml(match[1].trim());
        }
    }
    return null;
}
export function extractTitle(html) {
    const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    return match?.[1] ? normalizeText(stripTags(match[1])) : null;
}
export function extractElementById(html, id) {
    return extractElement(html, (attrs) => attributeValue(attrs, "id") === id);
}
export function extractElementByClass(html, className) {
    return extractElement(html, (attrs) => {
        const classValue = attributeValue(attrs, "class");
        return classValue ? classValue.split(/\s+/).includes(className) : false;
    });
}
export function extractAnchorLinks(html) {
    const links = [];
    const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = pattern.exec(html))) {
        const attrs = match[1] ?? "";
        const href = attrs.match(/\bhref=["']([^"']+)["']/i)?.[1];
        if (!href) {
            continue;
        }
        links.push({ href: decodeHtml(href), text: normalizeText(stripTags(match[2] ?? "")) });
    }
    return links;
}
export function htmlToText(html) {
    return decodeHtml(html
        .replace(/<script\b[\s\S]*?<\/script>/gi, "")
        .replace(/<style\b[\s\S]*?<\/style>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p\s*>/gi, "\n")
        .replace(/<\/div\s*>/gi, "\n")
        .replace(/<\/section\s*>/gi, "\n")
        .replace(/<[^>]+>/g, ""))
        .split("\n")
        .map((line) => line.trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
export function stripTags(value) {
    return decodeHtml(value.replace(/<[^>]+>/g, ""));
}
export function normalizeText(value) {
    return decodeHtml(value).replace(/\s+/g, " ").trim();
}
export function decodeHtml(value) {
    const named = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: " "
    };
    return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (entity, body) => {
        const normalized = body.toLowerCase();
        if (normalized.startsWith("#x")) {
            return fromCodePoint(Number.parseInt(normalized.slice(2), 16), entity);
        }
        if (normalized.startsWith("#")) {
            return fromCodePoint(Number.parseInt(normalized.slice(1), 10), entity);
        }
        return named[normalized] ?? entity;
    });
}
export function absoluteUrl(base, href) {
    return new URL(href, base).toString();
}
function fromCodePoint(value, fallback) {
    return Number.isFinite(value) ? String.fromCodePoint(value) : fallback;
}
function extractElement(html, matches) {
    const openTagPattern = /<([a-z0-9]+)\b([^>]*)>/gi;
    let match;
    while ((match = openTagPattern.exec(html))) {
        const tagName = match[1]?.toLowerCase();
        const attrs = match[2] ?? "";
        if (!tagName || !matches(attrs)) {
            continue;
        }
        return extractBalancedElementBody(html, tagName, openTagPattern.lastIndex, match[0] ?? "");
    }
    return null;
}
function extractBalancedElementBody(html, tagName, bodyStart, openingTag) {
    if (isSelfClosingTag(openingTag)) {
        return "";
    }
    const tagPattern = new RegExp(`</?${escapeRegExp(tagName)}\\b[^>]*>`, "gi");
    tagPattern.lastIndex = bodyStart;
    let depth = 1;
    let match;
    while ((match = tagPattern.exec(html))) {
        const tag = match[0] ?? "";
        if (tag.startsWith("</")) {
            depth -= 1;
            if (depth === 0) {
                return html.slice(bodyStart, match.index);
            }
        }
        else if (!isSelfClosingTag(tag)) {
            depth += 1;
        }
    }
    return null;
}
function isSelfClosingTag(tag) {
    return /\/\s*>$/.test(tag);
}
function attributeValue(attrs, name) {
    const pattern = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
    const match = attrs.match(pattern);
    const value = match?.[1] ?? match?.[2] ?? match?.[3];
    return value === undefined ? null : decodeHtml(value);
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
