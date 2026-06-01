import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { NovelTransConfig } from "../domain/config.js";
import type { Episode } from "../domain/episode.js";
import type { GlossaryData } from "../domain/glossary.js";
import type { ProjectMetadata } from "../domain/project.js";
import type { QAIssue } from "../domain/qa.js";
import type { TranslationResult, TranslatorAdapter } from "../domain/translation.js";
import { extractGlossaryCandidates } from "../glossary/glossaryEngine.js";
import { runQA } from "../qa/qaEngine.js";
import { pathExists } from "../storage/jsonFile.js";
import { writeProjectLog } from "../storage/logger.js";
import { projectPaths } from "../storage/projectPaths.js";
import { saveGlossary, saveProjectMetadata, saveQAIssues, saveTranslation } from "../storage/projectStore.js";
import type { ProjectStateStore } from "../storage/stateStore.js";
import { nowIso } from "../utils/time.js";
import { translateEpisodeParts } from "./episodeTranslation.js";
import { ProjectGlossaryUpdater } from "./glossaryUpdate.js";

type TranslateAndPersistEpisodeOptions = {
  metadata: ProjectMetadata;
  adapter: TranslatorAdapter;
  episode: Episode;
  glossaryUpdater: ProjectGlossaryUpdater;
  qaOptions?: NovelTransConfig["qa"];
  signal?: AbortSignal;
};

type TranslateAndPersistEpisodeResult = {
  result: TranslationResult;
  issues: QAIssue[];
  glossary: GlossaryData;
};

export async function translateAndPersistEpisode(options: TranslateAndPersistEpisodeOptions): Promise<TranslateAndPersistEpisodeResult> {
  const result = await translateEpisodeParts({
    adapter: options.adapter,
    episode: options.episode,
    glossary: options.glossaryUpdater.snapshot(),
    glossaryStrictness: options.metadata.options.glossaryStrictness,
    translationStyle: options.metadata.options.translationStyle,
    model: options.metadata.options.model,
    signal: options.signal
  });
  const glossary = await options.glossaryUpdater.mergeCandidates(result.newGlossaryCandidates, options.episode.id);
  const issues = runQA(options.episode, result, glossary, options.qaOptions ?? options.metadata.options.qa);
  result.qaIssueIds = issues.map((issue) => issue.id);
  await saveTranslation(options.metadata.projectDir, options.episode, result);
  await saveQAIssues(options.metadata.projectDir, options.episode, issues);
  await writeProjectLog({
    projectDir: options.metadata.projectDir,
    category: "qa",
    event: "episode_checked",
    message: `${options.episode.title} QA completed with ${issues.length} issue(s).`,
    projectId: options.metadata.id,
    episodeId: options.episode.id,
    metadata: { issueCount: issues.length }
  });
  return { result, issues, glossary };
}

export async function refreshGlossaryCandidatesForSource(
  projectDir: string,
  episodes: Episode[],
  glossary: GlossaryData
): Promise<{ glossary: GlossaryData; refreshed: boolean }> {
  if (!(await shouldRefreshGlossaryCandidates(projectDir, glossary))) {
    return { glossary, refreshed: false };
  }
  const refreshed = extractGlossaryCandidates(episodes, glossary);
  await saveGlossary(projectDir, refreshed);
  return { glossary: refreshed, refreshed: true };
}

export async function finishMetadataFromEpisodeStates(
  metadata: ProjectMetadata,
  stateStore: ProjectStateStore,
  cancelledStatus: ProjectMetadata["status"] = "ready"
): Promise<void> {
  const states = stateStore.listEpisodeStates();
  if (states.some((state) => state.status === "running")) {
    metadata.status = "translating";
  } else if (states.some((state) => state.status === "failed")) {
    metadata.status = "completed_with_issues";
  } else if (states.every((state) => state.status === "completed" || state.status === "skipped")) {
    metadata.status = "completed";
  } else {
    metadata.status = cancelledStatus;
  }
  metadata.updatedAt = nowIso();
  await saveProjectMetadata(metadata);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /cancelled|aborted/i.test(error.message));
}

async function shouldRefreshGlossaryCandidates(projectDir: string, glossary: GlossaryData): Promise<boolean> {
  const refreshedAt = Date.parse(glossary.updatedAt);
  if (!Number.isFinite(refreshedAt)) {
    return true;
  }
  const latestSourceMtime = await latestEpisodeSourceMtimeMs(projectDir);
  return latestSourceMtime > refreshedAt;
}

async function latestEpisodeSourceMtimeMs(projectDir: string): Promise<number> {
  const paths = projectPaths(projectDir);
  if (!(await pathExists(paths.sourceDir))) {
    return 0;
  }
  const names = await readdir(paths.sourceDir);
  let latest = 0;
  for (const name of names) {
    if (!/^episode_\d+\.json$/.test(name)) {
      continue;
    }
    const info = await stat(join(paths.sourceDir, name));
    latest = Math.max(latest, info.mtimeMs);
  }
  return latest;
}
