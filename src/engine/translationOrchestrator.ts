import type { NovelTransConfig } from "../domain/config.js";
import type { EpisodeState, ProjectMetadata, RunRecord } from "../domain/project.js";
import type { QAIssue } from "../domain/qa.js";
import type { TranslatorAdapter } from "../domain/translation.js";
import { extractGlossaryCandidates } from "../glossary/glossaryEngine.js";
import { runQA } from "../qa/qaEngine.js";
import {
  listEpisodes,
  loadGlossary,
  saveGlossary,
  saveProjectMetadata,
  saveQAIssues,
  saveTranslation,
  readAllQAIssues,
  writeQualityReport
} from "../storage/projectStore.js";
import { projectPaths } from "../storage/projectPaths.js";
import { ProjectStateStore } from "../storage/stateStore.js";
import { writeProjectLog } from "../storage/logger.js";
import { newId } from "../utils/hash.js";
import { nowIso } from "../utils/time.js";
import { translateEpisodeParts } from "./episodeTranslation.js";
import { ProjectGlossaryUpdater } from "./glossaryUpdate.js";

export type TranslationMode = "resume" | "retry-failed" | "pending-only";

export type TranslateProjectOptions = {
  metadata: ProjectMetadata;
  adapter: TranslatorAdapter;
  mode: TranslationMode;
  concurrency: number;
  qaOptions?: NovelTransConfig["qa"];
};

export type TranslationSummary = {
  queued: number;
  completed: number;
  failed: number;
  skipped: number;
  qaIssues: number;
};

type WorkerResult = {
  completed: number;
  failed: number;
  qaIssues: QAIssue[];
};

export async function translateProjectQueue(options: TranslateProjectOptions): Promise<TranslationSummary> {
  const stateStore = new ProjectStateStore(projectPaths(options.metadata.projectDir).projectDb);
  const run: RunRecord = {
    id: newId("run"),
    projectId: options.metadata.id,
    type: options.mode === "retry-failed" ? "retry" : "translate",
    startedAt: nowIso(),
    status: "running",
    backend: options.adapter.id,
    model: options.metadata.options.model,
    episodeCount: 0
  };
  let runCreated = false;

  try {
    const status = await options.adapter.checkAvailability();
    if (!status.available) {
      throw new Error(status.message);
    }

    const episodes = await listEpisodes(options.metadata.projectDir);
    const states = stateStore.listEpisodeStates();
    const stateById = new Map(states.map((state) => [state.episodeId, state]));
    const queuedEpisodes = episodes.filter((episode) => shouldQueue(stateById.get(episode.id), options.mode));
    run.episodeCount = queuedEpisodes.length;
    stateStore.createRun(run);
    runCreated = true;
    await writeProjectLog({
      projectDir: options.metadata.projectDir,
      category: "translation",
      event: "run_started",
      message: `${queuedEpisodes.length} episode(s) queued for ${options.mode}.`,
      projectId: options.metadata.id,
      runId: run.id,
      metadata: { mode: options.mode, backend: options.adapter.id, concurrency: options.concurrency }
    });

    options.metadata.status = "translating";
    options.metadata.updatedAt = nowIso();
    await saveProjectMetadata(options.metadata);

    let glossary = await loadGlossary(options.metadata.projectDir);
    glossary = extractGlossaryCandidates(episodes, glossary);
    await saveGlossary(options.metadata.projectDir, glossary);
    const glossaryUpdater = new ProjectGlossaryUpdater(options.metadata.projectDir, glossary);
    await writeProjectLog({
      projectDir: options.metadata.projectDir,
      category: "glossary",
      event: "candidates_refreshed",
      message: `${glossary.entries.filter((entry) => entry.status === "candidate").length} candidate term(s), ${glossary.conflicts.length} conflict(s).`,
      projectId: options.metadata.id,
      runId: run.id,
      metadata: { entryCount: glossary.entries.length, conflictCount: glossary.conflicts.length }
    });

    const queue = [...queuedEpisodes];
    const workerCount = Math.max(1, Math.min(options.concurrency, queue.length || 1));
    const workers = Array.from({ length: workerCount }, () => runWorker(queue, options, stateStore, glossaryUpdater));
    const workerResults = await Promise.all(workers);

    const completed = workerResults.reduce((sum, result) => sum + result.completed, 0);
    const failed = workerResults.reduce((sum, result) => sum + result.failed, 0);
    const qaIssues = workerResults.flatMap((result) => result.qaIssues);
    const allIssues = await collectAndPersistQualityReport(options.metadata.projectDir, qaIssues);

    const finalStates = stateStore.listEpisodeStates();
    options.metadata.status = finalStates.some((state) => state.status === "failed")
      ? "completed_with_issues"
      : finalStates.every((state) => state.status === "completed" || state.status === "skipped")
        ? "completed"
        : "ready";
    options.metadata.updatedAt = nowIso();
    await saveProjectMetadata(options.metadata);

    stateStore.finishRun(run.id, failed > 0 ? "failed" : "completed", failed > 0 ? `${failed} episode(s) failed.` : undefined);
    await writeProjectLog({
      projectDir: options.metadata.projectDir,
      category: failed > 0 ? "error" : "translation",
      level: failed > 0 ? "error" : "info",
      event: "run_finished",
      message: `Translation run finished: completed=${completed}, failed=${failed}.`,
      projectId: options.metadata.id,
      runId: run.id,
      metadata: { completed, failed, qaIssues: allIssues.length }
    });
    return {
      queued: queuedEpisodes.length,
      completed,
      failed,
      skipped: episodes.length - queuedEpisodes.length,
      qaIssues: allIssues.length
    };
  } catch (error) {
    if (!runCreated) {
      stateStore.createRun(run);
    }
    stateStore.finishRun(run.id, "failed", (error as Error).message);
    await writeProjectLog({
      projectDir: options.metadata.projectDir,
      category: "error",
      level: "error",
      event: "run_failed",
      message: (error as Error).message,
      projectId: options.metadata.id,
      runId: run.id
    });
    options.metadata.status = "failed";
    options.metadata.updatedAt = nowIso();
    await saveProjectMetadata(options.metadata);
    throw error;
  } finally {
    stateStore.close();
  }
}

async function runWorker(
  queue: Awaited<ReturnType<typeof listEpisodes>>,
  options: TranslateProjectOptions,
  stateStore: ProjectStateStore,
  glossaryUpdater: ProjectGlossaryUpdater
): Promise<WorkerResult> {
  let completed = 0;
  let failed = 0;
  const qaIssues: QAIssue[] = [];

  while (queue.length > 0) {
    const episode = queue.shift();
    if (!episode) {
      continue;
    }
    try {
      stateStore.markEpisodeRunning(episode.id);
      await writeProjectLog({
        projectDir: options.metadata.projectDir,
        category: "translation",
        event: "episode_started",
        message: `${episode.title} started.`,
        projectId: options.metadata.id,
        episodeId: episode.id
      });
      const result = await translateEpisodeParts({
        adapter: options.adapter,
        episode,
        glossary: glossaryUpdater.snapshot(),
        glossaryStrictness: options.metadata.options.glossaryStrictness,
        translationStyle: options.metadata.options.translationStyle,
        model: options.metadata.options.model
      });
      const glossary = await glossaryUpdater.mergeCandidates(result.newGlossaryCandidates, episode.id);
      const issues = runQA(episode, result, glossary, options.qaOptions ?? options.metadata.options.qa);
      result.qaIssueIds = issues.map((issue) => issue.id);
      await saveTranslation(options.metadata.projectDir, episode, result);
      await saveQAIssues(options.metadata.projectDir, episode, issues);
      await writeProjectLog({
        projectDir: options.metadata.projectDir,
        category: "qa",
        event: "episode_checked",
        message: `${episode.title} QA completed with ${issues.length} issue(s).`,
        projectId: options.metadata.id,
        episodeId: episode.id,
        metadata: { issueCount: issues.length }
      });
      qaIssues.push(...issues);
      stateStore.setEpisodeStatus(episode.id, "completed");
      await writeProjectLog({
        projectDir: options.metadata.projectDir,
        category: "translation",
        event: "episode_completed",
        message: `${episode.title} completed.`,
        projectId: options.metadata.id,
        episodeId: episode.id,
        metadata: { qaIssueCount: issues.length, backend: result.backend, model: result.model }
      });
      completed += 1;
    } catch (error) {
      stateStore.setEpisodeStatus(episode.id, "failed", (error as Error).message);
      await writeProjectLog({
        projectDir: options.metadata.projectDir,
        category: "error",
        level: "error",
        event: "episode_failed",
        message: (error as Error).message,
        projectId: options.metadata.id,
        episodeId: episode.id
      });
      failed += 1;
    }
  }

  return { completed, failed, qaIssues };
}

function shouldQueue(state: EpisodeState | undefined, mode: TranslationMode): boolean {
  if (!state) {
    return true;
  }
  if (mode === "retry-failed") {
    return state.status === "failed";
  }
  if (mode === "pending-only") {
    return state.status === "pending";
  }
  return state.status === "pending" || state.status === "failed" || state.status === "running";
}

async function collectAndPersistQualityReport(projectDir: string, currentIssues: QAIssue[]): Promise<QAIssue[]> {
  const allIssues = await readAllQAIssues(projectDir);
  const merged = allIssues.length > 0 ? allIssues : currentIssues;
  await writeQualityReport(projectDir, merged);
  return merged;
}
