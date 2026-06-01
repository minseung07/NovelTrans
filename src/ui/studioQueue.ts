import type { ProjectOverview } from "../domain/project.js";
import type { StudioQueue, StudioQueueItem } from "./types.js";

const visibleQueueLimit = 5;

export function buildStudioQueue(overview: ProjectOverview): StudioQueue {
  const items = overview.episodeStates.map((state): StudioQueueItem => ({
    episodeId: state.episodeId,
    episodeNo: state.episodeNo,
    title: state.title,
    status: state.status,
    detail: state.errorMessage ?? `${state.attempts} attempt(s)`
  }));

  return {
    active: items.filter((item) => item.status === "running").slice(0, visibleQueueLimit),
    next: items.filter((item) => item.status === "pending").slice(0, visibleQueueLimit),
    failed: items.filter((item) => item.status === "failed").slice(0, visibleQueueLimit),
    skipped: items.filter((item) => item.status === "skipped").slice(0, visibleQueueLimit)
  };
}
