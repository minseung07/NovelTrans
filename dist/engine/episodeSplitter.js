import { hashText } from "../utils/hash.js";
import { padEpisodeNo } from "../utils/path.js";
import { normalizeNewlines } from "../utils/text.js";
import { isAfterwordHeadingLine, isForewordHeadingLine } from "./afterwordMarkers.js";
const headingPatterns = [
    /^\s*(第\s*[0-9０-９一二三四五六七八九十百千万億]+\s*[話章節][^\n]{0,80})\s*$/u,
    /^\s*([0-9０-９]{1,4}\s*[話章節][^\n]{0,80})\s*$/u,
    /^\s*([0-9０-９]{1,4}[.．、]\s*[^\n]{1,80})\s*$/u,
    /^\s*(プロローグ|エピローグ|序章|終章|幕間[^\n]{0,80})\s*$/u
];
export function splitEpisodes(sourceText) {
    const normalized = normalizeNewlines(sourceText).trim();
    if (!normalized) {
        throw new Error("Source text is empty.");
    }
    const lines = normalized.split("\n");
    const headings = findHeadings(lines);
    if (headings.length < 2) {
        return [buildEpisode(1, guessSingleTitle(lines), normalized, normalized)];
    }
    const episodes = [];
    const prefix = lines.slice(0, headings[0]?.lineIndex ?? 0).join("\n").trim();
    for (let index = 0; index < headings.length; index += 1) {
        const heading = headings[index];
        const nextHeading = headings[index + 1];
        if (!heading) {
            continue;
        }
        const start = heading.lineIndex;
        const end = nextHeading ? nextHeading.lineIndex : lines.length;
        const segmentLines = lines.slice(start, end);
        const title = heading.title;
        const bodyLines = segmentLines.slice(1);
        const source = segmentLines.join("\n").trim();
        const bodyPrefix = index === 0 && prefix ? `${prefix}\n\n` : "";
        const body = `${bodyPrefix}${bodyLines.join("\n").trim()}`.trim() || title;
        episodes.push(buildEpisode(index + 1, title, source, body));
    }
    return episodes;
}
export function hasEpisodeHeadings(sourceText) {
    return findHeadings(normalizeNewlines(sourceText).split("\n")).length >= 2;
}
function findHeadings(lines) {
    const headings = [];
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex]?.trim() ?? "";
        if (!line || line.length > 90) {
            continue;
        }
        if (headingPatterns.some((pattern) => pattern.test(line))) {
            headings.push({ lineIndex, title: line });
        }
    }
    return headings;
}
function buildEpisode(episodeNo, title, sourceText, body) {
    const parts = splitEpisodeSections(body);
    return {
        id: `episode_${padEpisodeNo(episodeNo)}`,
        episodeNo,
        title,
        sourceText,
        foreword: parts.foreword,
        body: parts.body,
        afterword: parts.afterword,
        sourceHash: hashText(sourceText),
        metadata: {}
    };
}
function splitEpisodeSections(body) {
    const forewordParts = splitForeword(body);
    const afterwordParts = splitAfterword(forewordParts.body);
    return {
        foreword: forewordParts.foreword,
        body: afterwordParts.body,
        afterword: afterwordParts.afterword
    };
}
function splitForeword(body) {
    const normalized = normalizeNewlines(body).trim();
    const lines = normalized.split("\n");
    const markerIndex = lines.findIndex((line, index) => index <= 1 && isForewordHeadingLine(line));
    if (markerIndex < 0) {
        return { body: normalized };
    }
    const separatorIndex = lines.findIndex((line, index) => index > markerIndex && line.trim() === "");
    if (separatorIndex < 0) {
        return { body: normalized };
    }
    const foreword = lines.slice(markerIndex, separatorIndex).join("\n").trim();
    const mainBody = lines.slice(separatorIndex + 1).join("\n").trim();
    if (!foreword || !mainBody) {
        return { body: normalized };
    }
    return { foreword, body: mainBody };
}
function splitAfterword(body) {
    const normalized = normalizeNewlines(body).trim();
    const lines = normalized.split("\n");
    const markerIndex = lines.findIndex((line, index) => index > 0 && isAfterwordHeadingLine(line));
    if (markerIndex < 0) {
        return { body: normalized };
    }
    const mainBody = lines.slice(0, markerIndex).join("\n").trim();
    const afterword = lines.slice(markerIndex).join("\n").trim();
    if (!mainBody || !afterword) {
        return { body: normalized };
    }
    return { body: mainBody, afterword };
}
function guessSingleTitle(lines) {
    const firstMeaningfulLine = lines.find((line) => line.trim().length > 0)?.trim();
    if (firstMeaningfulLine && firstMeaningfulLine.length <= 80) {
        return firstMeaningfulLine;
    }
    return "Episode 1";
}
