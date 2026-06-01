import type { GlossaryQueueFilter, GlossaryQueueItem, ProjectUiModel } from "./types.js";

export function buildGlossaryQueue(model: ProjectUiModel, filter: GlossaryQueueFilter = "all", deferredEntryIds: string[] = []): GlossaryQueueItem[] {
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
  return hideDeferred(ordered, deferredEntryIds);
}

export function selectedGlossaryQueueItem(
  model: ProjectUiModel,
  selectedIndex: number,
  filter: GlossaryQueueFilter = "all",
  deferredEntryIds: string[] = []
): GlossaryQueueItem | null {
  const queue = buildGlossaryQueue(model, filter, deferredEntryIds);
  return queue[selectedIndex] ?? queue[0] ?? null;
}

function matchesFilter(status: string, isConflict: boolean, filter: GlossaryQueueFilter): boolean {
  if (filter === "conflicts") {
    return isConflict;
  }
  if (filter === "candidates") {
    return status === "candidate" && !isConflict;
  }
  if (filter === "confirmed") {
    return status === "confirmed" || status === "locked";
  }
  return true;
}

function hideDeferred(items: GlossaryQueueItem[], deferredEntryIds: string[]): GlossaryQueueItem[] {
  if (deferredEntryIds.length === 0) {
    return items;
  }
  const deferred = new Set(deferredEntryIds);
  return items.filter((item) => !deferred.has(item.entry.id));
}
