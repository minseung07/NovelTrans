import type { GlossaryQueueFilter, ProjectUiModel, StudioSpace } from "./types.js";

export type StudioKeyIntent =
  | { type: "open-space"; space: StudioSpace; glossaryFilter?: GlossaryQueueFilter }
  | { type: "translate"; mode: "resume" | "retry-failed" };

export function primaryStudioKeyIntent(model: ProjectUiModel, key: string): StudioKeyIntent | null {
  const normalized = key.toLowerCase();
  const action = model.nextActions.find((item) => item.commandHint.toLowerCase().startsWith(`[${normalized}]`));
  if (!action) {
    return null;
  }
  return studioIntentForCommand(action.commandId, model);
}

export function studioIntentForCommand(commandId: string, model: ProjectUiModel): StudioKeyIntent | null {
  if (commandId === "open-failure-recovery") {
    return { type: "open-space", space: "failure-recovery" };
  }
  if (commandId === "glossary-conflicts") {
    return { type: "open-space", space: "glossary-lab", glossaryFilter: "conflicts" };
  }
  if (commandId === "glossary-candidates") {
    return { type: "open-space", space: "glossary-lab", glossaryFilter: "candidates" };
  }
  if (commandId === "open-glossary") {
    return { type: "open-space", space: "glossary-lab", glossaryFilter: "all" };
  }
  if (commandId === "open-review") {
    return { type: "open-space", space: model.failureRecovery.failedCount > 0 ? "failure-recovery" : "review-desk" };
  }
  if (commandId === "open-export") {
    return { type: "open-space", space: "export-room" };
  }
  if (commandId === "continue-translation") {
    return { type: "translate", mode: "resume" };
  }
  if (commandId === "retry-failed") {
    return { type: "translate", mode: "retry-failed" };
  }
  return null;
}
