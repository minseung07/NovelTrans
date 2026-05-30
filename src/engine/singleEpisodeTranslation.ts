import type { NovelTransConfig } from "../domain/config.js";
import type { ProjectMetadata, RunRecord } from "../domain/project.js";
import type { TranslatorAdapter } from "../domain/translation.js";
import { loadGlossary, loadProjectMetadata, listEpisodes, readAllQAIssues, saveProjectMetadata, writeQualityReport } from "../storage/projectStore.js";
import { projectPaths } from "../storage/projectPaths.js";
import { ProjectStateStore } from "../storage/stateStore.js";
import { writeProjectLog } from "../storage/logger.js";
import { newId } from "../utils/hash.js";
import { nowIso } from "../utils/time.js";
import {
  finishMetadataFromEpisodeStates,
  isAbortError,
  refreshGlossaryCandidatesForSource,
  translateAndPersistEpisode
} from "./episodeLifecycle.js";
import { ProjectGlossaryUpdater } from "./glossaryUpdate.js";

type TranslateSingleEpisodeOptions = {
  projectDir: string;
  episodeId: string;
  adapter: TranslatorAdapter;
  reason: string;
  signal?: AbortSignal;
  qaOptions?: NovelTransConfig["qa"];
};

type SingleEpisodeTranslationSummary = {
  episodeId: string;
  completed: number;
  failed: number;
  cancelled: number;
  qaIssues: number;
};

export async function translateSingleEpisode(options: TranslateSingleEpisodeOptions): Promise<SingleEpisodeTranslationSummary> {
  const metadata = await loadProjectMetadata(options.projectDir);
  const episodes = await listEpisodes(options.projectDir);
  const episode = episodes.find((candidate) => candidate.id === options.episodeId);
  if (!episode) {
    throw new Error(`Episode not found: ${options.episodeId}`);
  }

  const stateStore = new ProjectStateStore(projectPaths(options.projectDir).projectDb);
  const run: RunRecord = {
    id: newId("run"),
    projectId: metadata.id,
    type: "retry",
    startedAt: nowIso(),
    status: "running",
    backend: options.adapter.id,
    model: metadata.options.model,
    episodeCount: 1
  };

  try {
    stateStore.createRun(run);
    const status = await options.adapter.checkAvailability();
    if (!status.available) {
      throw new Error(status.message);
    }
    options.signal?.throwIfAborted();

    metadata.status = "translating";
    metadata.updatedAt = nowIso();
    await saveProjectMetadata(metadata);
    stateStore.markEpisodeRunning(episode.id);
    await logEpisode(metadata, "translation", "episode_retranslate_started", `${episode.title} retranslation started: ${options.reason}.`, episode.id);

    const { glossary } = await refreshGlossaryCandidatesForSource(options.projectDir, episodes, await loadGlossary(options.projectDir));
    const glossaryUpdater = new ProjectGlossaryUpdater(options.projectDir, glossary);
    const { result, issues } = await translateAndPersistEpisode({
      metadata,
      adapter: options.adapter,
      episode,
      glossaryUpdater,
      qaOptions: options.qaOptions ?? metadata.options.qa,
      signal: options.signal
    });
    await writeQualityReport(options.projectDir, await readAllQAIssues(options.projectDir));
    stateStore.setEpisodeStatus(episode.id, "completed");

    await logEpisode(metadata, "qa", "episode_checked", `${episode.title} QA completed with ${issues.length} issue(s).`, episode.id, { issueCount: issues.length });
    await logEpisode(metadata, "translation", "episode_retranslate_completed", `${episode.title} retranslation completed.`, episode.id, {
      qaIssueCount: issues.length,
      backend: result.backend,
      model: result.model
    });

    await finishMetadataFromEpisodeStates(metadata, stateStore);
    stateStore.finishRun(run.id, "completed");
    return { episodeId: episode.id, completed: 1, failed: 0, cancelled: 0, qaIssues: issues.length };
  } catch (error) {
    if (isAbortError(error) || options.signal?.aborted) {
      stateStore.setEpisodeStatus(episode.id, "pending");
      await finishMetadataFromEpisodeStates(metadata, stateStore);
      stateStore.finishRun(run.id, "cancelled", "Review retranslation cancelled.");
      await logEpisode(metadata, "translation", "episode_retranslate_cancelled", `${episode.title} retranslation cancelled.`, episode.id);
      return { episodeId: episode.id, completed: 0, failed: 0, cancelled: 1, qaIssues: 0 };
    }
    stateStore.setEpisodeStatus(episode.id, "failed", (error as Error).message);
    await finishMetadataFromEpisodeStates(metadata, stateStore);
    stateStore.finishRun(run.id, "failed", (error as Error).message);
    await logEpisode(metadata, "error", "episode_retranslate_failed", (error as Error).message, episode.id);
    return { episodeId: episode.id, completed: 0, failed: 1, cancelled: 0, qaIssues: 0 };
  } finally {
    stateStore.close();
  }
}

async function logEpisode(
  metadata: ProjectMetadata,
  category: "translation" | "qa" | "error",
  event: string,
  message: string,
  episodeId: string,
  logMetadata?: Record<string, unknown>
): Promise<void> {
  await writeProjectLog({
    projectDir: metadata.projectDir,
    category,
    level: category === "error" ? "error" : "info",
    event,
    message,
    projectId: metadata.id,
    episodeId,
    metadata: logMetadata
  });
}
