export function detectWebImportUrl(value) {
    let url;
    try {
        url = new URL(value.trim());
    }
    catch {
        return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return null;
    }
    const host = url.hostname.toLowerCase();
    if (host === "kakuyomu.jp" || host === "www.kakuyomu.jp") {
        return { site: "kakuyomu", url: normalizeHttps(url) };
    }
    if (host === "ncode.syosetu.com") {
        return { site: "syosetu", url: normalizeHttps(url) };
    }
    return null;
}
export function isSupportedWebImportUrl(value) {
    return Boolean(detectWebImportUrl(value));
}
function normalizeHttps(url) {
    const normalized = new URL(url.toString());
    normalized.protocol = "https:";
    return normalized;
}
