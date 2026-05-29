export function buildSourceStatus(metadata, episodes, analysis) {
    return {
        sourcePath: metadata.sourcePath,
        originalTitle: metadata.originalTitle || metadata.name,
        languageGuess: analysis?.languageGuess ?? "알 수 없음",
        characterCount: analysis?.characterCount ?? episodes.reduce((sum, episode) => sum + episode.sourceText.length, 0),
        episodeCount: analysis?.episodeCount ?? episodes.length,
        structureLabel: analysis ? (analysis.hasEpisodeHeadings ? "화 제목 감지" : "단일 화 또는 약한 제목") : "저장된 화 기준",
        longEpisodeCount: analysis?.longEpisodeIds.length ?? 0,
        afterwordCount: analysis?.afterwordCount ?? episodes.filter((episode) => episode.afterword).length,
        warnings: analysis?.warnings ?? []
    };
}
