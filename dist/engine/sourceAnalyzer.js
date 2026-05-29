import { hasEpisodeHeadings, splitEpisodes } from "./episodeSplitter.js";
import { japaneseCharacterCount, normalizeNewlines } from "../utils/text.js";
import { hasAfterwordMarker } from "./afterwordMarkers.js";
const longEpisodeThreshold = 30000;
export function analyzeSource(sourceText) {
    const normalized = normalizeNewlines(sourceText);
    const episodes = splitEpisodes(normalized);
    const japaneseCount = japaneseCharacterCount(normalized);
    const characterCount = Array.from(normalized).length;
    const warnings = [];
    const longEpisodeIds = episodes.filter((episode) => episode.body.length > longEpisodeThreshold).map((episode) => episode.id);
    const afterwordCount = episodes.filter((episode) => episode.afterword || hasAfterwordMarker(episode.sourceText)).length;
    if (longEpisodeIds.length > 0) {
        warnings.push(`${longEpisodeIds.length} long episode(s) detected.`);
    }
    if (afterwordCount > 0) {
        warnings.push(`${afterwordCount} author afterword(s) detected.`);
    }
    if (episodes.length === 1) {
        warnings.push("No repeated episode heading pattern was detected; imported as a single episode.");
    }
    return {
        titleGuess: guessTitle(episodes),
        languageGuess: japaneseCount / Math.max(1, characterCount) > 0.1 ? "ja" : "unknown",
        characterCount,
        episodeCount: episodes.length,
        hasEpisodeHeadings: hasEpisodeHeadings(normalized),
        longEpisodeIds,
        afterwordCount,
        warnings
    };
}
function guessTitle(episodes) {
    const first = episodes[0];
    if (!first) {
        return "Untitled Novel";
    }
    const candidate = first.title.replace(/^第\s*[0-9０-９一二三四五六七八九十百千万億]+\s*[話章節]\s*/u, "").trim();
    return candidate || first.title || "Untitled Novel";
}
