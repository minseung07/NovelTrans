export function buildGlossaryQueue(model, filter = "all", deferredEntryIds = []) {
    const conflictSources = new Set(model.glossary.conflicts.map((conflict) => conflict.source));
    const ordered = model.glossary.entries
        .filter((entry) => entry.status !== "deprecated")
        .filter((entry) => matchesFilter(entry.status, conflictSources.has(entry.source), filter))
        .map((entry) => ({
        entry,
        label: conflictSources.has(entry.source) ? "conflict" : entry.status,
        priority: conflictSources.has(entry.source) ? 0 : entry.status === "candidate" ? 1 : entry.locked ? 3 : 2
    }))
        .sort((left, right) => left.priority - right.priority || right.entry.occurrenceCount - left.entry.occurrenceCount || left.entry.source.localeCompare(right.entry.source));
    return applyDeferredOrder(ordered, deferredEntryIds);
}
export function selectedGlossaryQueueItem(model, selectedIndex, filter = "all", deferredEntryIds = []) {
    const queue = buildGlossaryQueue(model, filter, deferredEntryIds);
    return queue[selectedIndex] ?? queue[0] ?? null;
}
export function deferSelectedGlossaryQueueItem(model, selectedIndex, filter = "all", deferredEntryIds = []) {
    const selected = selectedGlossaryQueueItem(model, selectedIndex, filter, deferredEntryIds);
    if (!selected) {
        return { deferredEntryIds, message: "선택된 용어가 없습니다." };
    }
    return {
        deferredEntryIds: [...deferredEntryIds.filter((entryId) => entryId !== selected.entry.id), selected.entry.id],
        message: `나중에 볼 용어로 보냈습니다: ${selected.entry.source}`
    };
}
function matchesFilter(status, isConflict, filter) {
    if (filter === "conflicts") {
        return isConflict;
    }
    if (filter === "candidates") {
        return status === "candidate" && !isConflict;
    }
    return true;
}
function applyDeferredOrder(items, deferredEntryIds) {
    if (deferredEntryIds.length === 0) {
        return items;
    }
    const deferred = new Map(deferredEntryIds.map((entryId, index) => [entryId, index]));
    const active = items.filter((item) => !deferred.has(item.entry.id));
    const delayed = items.filter((item) => deferred.has(item.entry.id)).sort((left, right) => (deferred.get(left.entry.id) ?? 0) - (deferred.get(right.entry.id) ?? 0));
    return [...active, ...delayed];
}
