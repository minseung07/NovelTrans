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
  return applyDeferredOrder(ordered, deferredEntryIds);
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
  return true;
}

function applyDeferredOrder(items: GlossaryQueueItem[], deferredEntryIds: string[]): GlossaryQueueItem[] {
  if (deferredEntryIds.length === 0) {
    return items;
  }
  const deferred = new Map(deferredEntryIds.map((entryId, index) => [entryId, index]));
  const active = items.filter((item) => !deferred.has(item.entry.id));
  const delayed = items.filter((item) => deferred.has(item.entry.id)).sort((left, right) => (deferred.get(left.entry.id) ?? 0) - (deferred.get(right.entry.id) ?? 0));
  return [...active, ...delayed];
}
