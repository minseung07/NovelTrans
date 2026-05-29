import { absoluteUrl, extractAnchorLinks, extractElementByClass, extractElementById, extractMetaContent, extractTitle, htmlToText, normalizeText } from "../html.js";
export class SyosetuAdapter {
    http;
    site = "syosetu";
    constructor(http) {
        this.http = http;
    }
    detect(url) {
        return url.hostname === "ncode.syosetu.com" && Boolean(ncodeFromUrl(url));
    }
    async loadWork(url) {
        const ncode = ncodeFromUrl(url);
        if (!ncode) {
            throw new Error("소설가가 되자 작품 URL이 아닙니다.");
        }
        const workUrl = `https://ncode.syosetu.com/${ncode}/`;
        const [html, metadata] = await Promise.all([
            this.http.getText(workUrl),
            this.loadOfficialMetadata(ncode).catch(() => null)
        ]);
        const links = extractAnchorLinks(html)
            .map((link) => {
            const absolute = absoluteUrl(workUrl, link.href);
            const episodeNo = episodeNoFromUrl(new URL(absolute), ncode);
            return episodeNo ? { no: episodeNo, title: link.text, url: absolute, remoteId: `${ncode}-${episodeNo}` } : null;
        })
            .filter((item) => Boolean(item))
            .filter((item, index, items) => items.findIndex((candidate) => candidate.no === item.no) === index)
            .sort((left, right) => left.no - right.no)
            .map((item, index) => ({ ...item, no: index + 1, remoteId: `${ncode}-${item.no}`, title: item.title || `第${index + 1}話` }));
        const episodes = links.length > 0
            ? links
            : [
                {
                    no: 1,
                    title: extractWorkTitle(html) ?? ncode,
                    url: workUrl,
                    remoteId: `${ncode}-1`
                }
            ];
        return {
            site: this.site,
            title: metadata?.title ?? extractWorkTitle(html) ?? ncode,
            author: metadata?.writer ?? extractAuthor(html),
            sourceUrl: workUrl,
            episodes
        };
    }
    async loadEpisode(ref) {
        const html = await this.http.getText(ref.url);
        const bodyHtml = extractBodyHtml(html);
        const bodyText = htmlToText(bodyHtml);
        if (!bodyText) {
            throw new Error(`소설가가 되자 본문을 찾지 못했습니다: ${ref.url}`);
        }
        const foreword = extractOptionalText(html, "novel_p");
        const afterword = extractOptionalText(html, "novel_a");
        return {
            ...ref,
            title: extractEpisodeTitle(html) ?? ref.title,
            bodyText,
            ...(foreword ? { foreword } : {}),
            ...(afterword ? { afterword } : {})
        };
    }
    async loadOfficialMetadata(ncode) {
        const url = `https://api.syosetu.com/novelapi/api/?out=json&of=t-w-ga&ncode=${encodeURIComponent(ncode)}`;
        const text = await this.http.getText(url);
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) {
            return null;
        }
        const item = parsed[1];
        if (!item) {
            return null;
        }
        return {
            title: typeof item.title === "string" ? item.title : undefined,
            writer: typeof item.writer === "string" ? item.writer : undefined,
            general_all_no: typeof item.general_all_no === "number" ? item.general_all_no : undefined
        };
    }
}
function ncodeFromUrl(url) {
    return url.pathname.match(/^\/(n[0-9a-z]+)(?:\/|$)/i)?.[1]?.toLowerCase() ?? null;
}
function episodeNoFromUrl(url, ncode) {
    const match = url.pathname.match(new RegExp(`^/${ncode}/(\\d+)/?$`, "i"));
    if (!match?.[1]) {
        return null;
    }
    const parsed = Number(match[1]);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function extractWorkTitle(html) {
    const titleHtml = extractElementByClass(html, "novel_title") ?? extractElementByClass(html, "p-novel__title");
    if (titleHtml) {
        return htmlToText(titleHtml).split("\n")[0]?.trim() || null;
    }
    const meta = extractMetaContent(html, "og:title") ?? extractTitle(html);
    return meta ? cleanupSyosetuTitle(meta) : null;
}
function extractEpisodeTitle(html) {
    const titleHtml = extractElementByClass(html, "novel_subtitle") ?? extractElementByClass(html, "p-novel__title");
    if (titleHtml) {
        return htmlToText(titleHtml).split("\n")[0]?.trim() || null;
    }
    const meta = extractMetaContent(html, "og:title") ?? extractTitle(html);
    return meta ? cleanupSyosetuTitle(meta) : null;
}
function extractAuthor(html) {
    const writer = extractElementByClass(html, "novel_writername") ?? extractElementByClass(html, "p-novel__author");
    if (!writer) {
        return null;
    }
    return htmlToText(writer).replace(/^作者[:：]\s*/u, "").trim() || null;
}
function extractBodyHtml(html) {
    return (extractElementById(html, "novel_honbun") ??
        extractElementByClass(html, "p-novel__body") ??
        extractElementByClass(html, "novel_view") ??
        "");
}
function extractOptionalText(html, id) {
    const value = extractElementById(html, id);
    const text = value ? htmlToText(value) : "";
    return text || undefined;
}
function cleanupSyosetuTitle(title) {
    return normalizeText(title.replace(/\s*[-|｜]\s*小説家になろう.*$/u, ""));
}
