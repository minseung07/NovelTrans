export function newlyFoundTerms(glossary, limit = 5) {
    return glossary.entries
        .filter((entry) => entry.status === "candidate" && entry.occurrenceCount > 0)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.occurrenceCount - left.occurrenceCount || left.source.localeCompare(right.source))
        .slice(0, limit)
        .map((entry) => `+ ${entry.source}${entry.firstSeenEpisode ? `  ep.${entry.firstSeenEpisode}` : ""}`);
}
