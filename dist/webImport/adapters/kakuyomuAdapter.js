import { absoluteUrl, extractAnchorLinks, extractElementByClass, extractElementById, extractMetaContent, extractTitle, htmlToText, normalizeText } from "../html.js";
export class KakuyomuAdapter {
    http;
    site = "kakuyomu";
    constructor(http) {
        this.http = http;
    }
    detect(url) {
        return (url.hostname === "kakuyomu.jp" || url.hostname === "www.kakuyomu.jp") && /\/works\/\d+/.test(url.pathname);
    }
    async loadWork(url) {
        const workId = workIdFromUrl(url);
        const workUrl = `https://kakuyomu.jp/works/${workId}`;
        const html = await this.http.getText(workUrl);
        const episodesFromNextData = extractEpisodesFromNextData(html, workId, workUrl);
        const episodes = episodesFromNextData ?? extractEpisodesFromAnchors(html, workId, workUrl);
        const expectedEpisodeCount = extractExpectedEpisodeCount(html);
        if (episodes.length === 0) {
            throw new Error("카쿠요무 작품 페이지에서 에피소드 목록을 찾지 못했습니다.");
        }
        if (!episodesFromNextData && expectedEpisodeCount && episodes.length < expectedEpisodeCount) {
            throw new Error(`카쿠요무 전체 목차를 읽지 못했습니다. 페이지에는 ${expectedEpisodeCount}화가 표시되지만 ${episodes.length}화만 감지했습니다.`);
        }
        return {
            site: this.site,
            title: cleanupKakuyomuTitle(extractMetaContent(html, "og:title") ?? extractTitle(html) ?? `kakuyomu-${workId}`),
            author: extractAuthor(html),
            sourceUrl: workUrl,
            episodes
        };
    }
    async loadEpisode(ref) {
        const html = await this.http.getText(ref.url);
        const bodyHtml = extractElementByClass(html, "widget-episodeBody") ??
            extractElementByClass(html, "js-episode-body") ??
            extractElementByClass(html, "episodeBody") ??
            extractElementById(html, "contentMain-read") ??
            extractElementByClass(html, "widget-episode");
        const bodyText = bodyHtml ? htmlToText(bodyHtml) : "";
        if (!bodyText) {
            throw new Error(`카쿠요무 본문을 찾지 못했습니다: ${ref.url}`);
        }
        return {
            ...ref,
            title: extractEpisodeTitle(html) ?? ref.title,
            bodyText
        };
    }
}
function workIdFromUrl(url) {
    const match = url.pathname.match(/\/works\/(\d+)/);
    if (!match?.[1]) {
        throw new Error("카쿠요무 작품 URL이 아닙니다.");
    }
    return match[1];
}
function episodeIdFromUrl(url) {
    const match = url.pathname.match(/\/episodes\/(\d+)/);
    return match?.[1] ?? url.pathname;
}
function extractEpisodesFromAnchors(html, workId, workUrl) {
    return extractAnchorLinks(html)
        .filter((link) => link.href.includes(`/works/${workId}/episodes/`))
        .map((link) => ({
        title: link.text,
        url: absoluteUrl(workUrl, link.href),
        remoteId: episodeIdFromUrl(new URL(absoluteUrl(workUrl, link.href)))
    }))
        .filter((item, index, items) => items.findIndex((candidate) => candidate.remoteId === item.remoteId) === index)
        .map((item, index) => ({
        no: index + 1,
        title: item.title || `第${index + 1}話`,
        url: item.url,
        remoteId: item.remoteId
    }));
}
function extractEpisodesFromNextData(html, workId, workUrl) {
    const state = extractApolloState(html);
    if (!state) {
        return null;
    }
    const work = asRecord(state[`Work:${workId}`]);
    const chapters = asArray(work?.tableOfContentsV2);
    const episodes = episodesFromChapters(state, chapters, workUrl);
    const expectedEpisodeCount = numberValue(work?.publicEpisodeCount) ?? extractExpectedEpisodeCount(html);
    if (expectedEpisodeCount && episodes.length < expectedEpisodeCount) {
        const allEpisodes = episodesFromState(state, workUrl);
        if (allEpisodes.length >= episodes.length) {
            return allEpisodes.length > 0 ? allEpisodes : null;
        }
    }
    return episodes.length > 0 ? episodes : null;
}
function episodesFromChapters(state, chapters, workUrl) {
    const episodes = [];
    const seen = new Set();
    for (const chapterRef of chapters) {
        const chapter = asRecord(state[refKey(chapterRef) ?? ""]);
        const episodeRefs = asArray(chapter?.episodeUnions);
        for (const episodeRef of episodeRefs) {
            const key = refKey(episodeRef);
            if (!key?.startsWith("Episode:")) {
                continue;
            }
            const episode = asRecord(state[key]);
            const remoteId = typeof episode?.id === "string" ? episode.id : key.slice("Episode:".length);
            if (!remoteId || seen.has(remoteId)) {
                continue;
            }
            seen.add(remoteId);
            const no = episodes.length + 1;
            const title = typeof episode?.title === "string" ? normalizeText(episode.title) : "";
            episodes.push({
                no,
                title: title || `第${no}話`,
                url: `${workUrl}/episodes/${remoteId}`,
                remoteId
            });
        }
    }
    return episodes;
}
function episodesFromState(state, workUrl) {
    const episodes = Object.entries(state)
        .filter(([key]) => key.startsWith("Episode:"))
        .map(([, value]) => asRecord(value))
        .filter((episode) => Boolean(episode))
        .map((episode) => ({
        id: typeof episode.id === "string" ? episode.id : "",
        title: typeof episode.title === "string" ? normalizeText(episode.title) : "",
        publishedAt: typeof episode.publishedAt === "string" ? episode.publishedAt : ""
    }))
        .filter((episode) => episode.id)
        .sort((left, right) => left.publishedAt.localeCompare(right.publishedAt));
    return episodes.map((episode, index) => ({
        no: index + 1,
        title: episode.title || `第${index + 1}話`,
        url: `${workUrl}/episodes/${episode.id}`,
        remoteId: episode.id
    }));
}
function extractApolloState(html) {
    const match = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match?.[1]) {
        return null;
    }
    try {
        const data = JSON.parse(match[1]);
        return asRecord(asRecord(asRecord(data)?.props)?.pageProps)?.__APOLLO_STATE__ ?? null;
    }
    catch {
        return null;
    }
}
function refKey(value) {
    const ref = asRecord(value)?.__ref;
    return typeof ref === "string" ? ref : null;
}
function asArray(value) {
    return Array.isArray(value) ? value : [];
}
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function numberValue(value) {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}
function extractExpectedEpisodeCount(html) {
    const dataLayer = html.match(/"publicEpisodeCount"\s*:\s*(\d+)/);
    if (dataLayer?.[1]) {
        return Number(dataLayer[1]);
    }
    const label = html.match(/全\s*([0-9,]+)\s*話/u);
    if (label?.[1]) {
        return Number(label[1].replaceAll(",", ""));
    }
    return null;
}
function extractEpisodeTitle(html) {
    const titleHtml = extractElementByClass(html, "widget-episodeTitle") ??
        extractElementByClass(html, "js-vertical-composition-item") ??
        extractElementByClass(html, "episodeTitle");
    if (titleHtml) {
        return htmlToText(titleHtml).split("\n")[0]?.trim() || null;
    }
    const meta = extractMetaContent(html, "og:title") ?? extractTitle(html);
    return meta ? cleanupKakuyomuTitle(meta) : null;
}
function extractAuthor(html) {
    const author = extractMetaContent(html, "author");
    if (author) {
        return author;
    }
    const match = html.match(/<a\b[^>]*href=["']\/users\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i);
    return match?.[1] ? normalizeText(match[1].replace(/<[^>]+>/g, "")) : null;
}
function cleanupKakuyomuTitle(title) {
    return title.replace(/\s*-\s*カクヨム.*$/u, "").trim();
}
