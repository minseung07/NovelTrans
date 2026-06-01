import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { NovelTransConfig, TranslationStyle } from "../domain/config.js";
import type { SourceAnalysis } from "../domain/episode.js";
import type { GlossaryData } from "../domain/glossary.js";
import type { ProjectMetadata, ProjectOverview } from "../domain/project.js";
import type { QAIssue } from "../domain/qa.js";
import type { TranslatorAdapter } from "../domain/translation.js";
import { analyzeSource } from "./sourceAnalyzer.js";
import { splitEpisodes } from "./episodeSplitter.js";
import { createEmptyGlossary, extractGlossaryCandidates } from "../glossary/glossaryEngine.js";
import { qaIssueFingerprint, runQA } from "../qa/qaEngine.js";
import {
  createProjectDirectories,
  loadGlossary,
  loadProjectMetadata,
  readAllQAIssues,
  readTranslation,
  saveEpisodes,
  saveGlossary,
  saveOriginalSource,
  saveProjectMetadata,
  saveQAIssues,
  writeQualityReport
} from "../storage/projectStore.js";
import { projectPaths } from "../storage/projectPaths.js";
import { ProjectStateStore } from "../storage/stateStore.js";
import { writeProjectLog } from "../storage/logger.js";
import { newId } from "../utils/hash.js";
import { slugify } from "../utils/path.js";
import { nowIso } from "../utils/time.js";
import { translateProjectQueue, type TranslationMode, type TranslationSummary } from "./translationOrchestrator.js";

type CreateProjectOptions = {
  sourcePath: string;
  projectRoot: string;
  name?: string;
  backend: string;
  model?: string;
  translationStyle?: TranslationStyle;
  concurrency: number;
  glossaryStrictness: "low" | "medium" | "high" | "strict";
  qaOptions?: NovelTransConfig["qa"];
  outputOptions?: Partial<ProjectMetadata["outputOptions"]>;
  userConfirmedRights?: boolean;
};

type CreateProjectFromTextOptions = Omit<CreateProjectOptions, "sourcePath"> & {
  sourceText: string;
  sourceLabel: string;
};

export type CreateProjectResult = {
  metadata: ProjectMetadata;
  analysis: SourceAnalysis;
  glossary: GlossaryData;
};

export async function createProjectFromTxt(options: CreateProjectOptions): Promise<CreateProjectResult> {
  const sourcePath = resolve(options.sourcePath);
  const sourceText = await readFile(sourcePath, "utf8");
  return createProjectFromSourceText({
    ...options,
    sourceText,
    sourceLabel: sourcePath,
    defaultName: basename(sourcePath, ".txt")
  });
}

export async function createProjectFromText(options: CreateProjectFromTextOptions): Promise<CreateProjectResult> {
  return createProjectFromSourceText({
    ...options,
    sourceLabel: options.sourceLabel,
    defaultName: options.name ?? "Pasted Novel"
  });
}

type CreateProjectFromSourceTextOptions = CreateProjectFromTextOptions & {
  defaultName: string;
};

async function createProjectFromSourceText(options: CreateProjectFromSourceTextOptions): Promise<CreateProjectResult> {
  const sourceText = options.sourceText;
  const sourcePath = options.sourceLabel;
  const analysis = analyzeSource(sourceText);
  const episodes = splitEpisodes(sourceText);
  const name = options.name ?? analysis.titleGuess ?? options.defaultName;
  const slug = await uniqueProjectSlug(options.projectRoot, slugify(name));
  const projectDir = join(resolve(options.projectRoot), slug);
  const now = nowIso();
  const metadata: ProjectMetadata = {
    id: newId("project"),
    name,
    originalTitle: analysis.titleGuess,
    sourcePath,
    projectDir,
    status: "ready",
    createdAt: now,
    updatedAt: now,
    options: {
      backend: options.backend,
      model: options.model,
      translationStyle: options.translationStyle ?? "balanced-webnovel",
      concurrency: options.concurrency,
      glossaryStrictness: options.glossaryStrictness,
      ...(options.qaOptions ? { qa: options.qaOptions } : {})
    },
    outputOptions: {
      formats: options.outputOptions?.formats ?? ["txt", "epub"],
      includeGlossaryAppendix: options.outputOptions?.includeGlossaryAppendix ?? true,
      includeAfterword: options.outputOptions?.includeAfterword ?? true,
      verticalWriting: options.outputOptions?.verticalWriting ?? false,
      ...(options.outputOptions?.coverImagePath ? { coverImagePath: options.outputOptions.coverImagePath } : {})
    },
    policy: {
      userConfirmedRights: Boolean(options.userConfirmedRights)
    }
  };

  await createProjectDirectories(projectDir);
  await saveOriginalSource(projectDir, sourceText);
  await saveEpisodes(projectDir, episodes);
  const glossary = extractGlossaryCandidates(episodes, createEmptyGlossary());
  await saveGlossary(projectDir, glossary);
  await saveProjectMetadata(metadata);
  await writeProjectLog({
    projectDir,
    category: "translation",
    event: "project_created",
    message: `${episodes.length} episode(s) imported from source text.`,
    projectId: metadata.id,
    metadata: { sourcePath, glossaryCandidates: glossary.entries.length }
  });
  await writeProjectLog({
    projectDir,
    category: "glossary",
    event: "initial_candidates_extracted",
    message: `${glossary.entries.length} glossary candidate(s) extracted.`,
    projectId: metadata.id,
    metadata: { conflictCount: glossary.conflicts.length }
  });

  const stateStore = new ProjectStateStore(projectPaths(projectDir).projectDb);
  try {
    stateStore.initializeEpisodeStates(episodes);
  } finally {
    stateStore.close();
  }

  return { metadata, analysis, glossary };
}

export async function loadProjectOverview(projectDir: string): Promise<ProjectOverview> {
  const metadata = await loadProjectMetadata(projectDir);
  const stateStore = new ProjectStateStore(projectPaths(projectDir).projectDb);
  try {
    const episodeStates = stateStore.listEpisodeStates();
    const glossary = await loadGlossary(projectDir);
    const issues = await readAllQAIssues(projectDir);
    return {
      metadata,
      episodeStates,
      counts: {
        pending: episodeStates.filter((state) => state.status === "pending").length,
        running: episodeStates.filter((state) => state.status === "running").length,
        completed: episodeStates.filter((state) => state.status === "completed").length,
        failed: episodeStates.filter((state) => state.status === "failed").length,
        skipped: episodeStates.filter((state) => state.status === "skipped").length
      },
      qaIssueCount: issues.filter((issue) => !issue.resolved).length,
      glossaryCandidateCount: glossary.entries.filter((entry) => entry.status === "candidate").length,
      glossaryConflictCount: glossary.conflicts.length
    };
  } finally {
    stateStore.close();
  }
}

export async function runTranslation(
  projectDir: string,
  adapter: TranslatorAdapter,
  mode: TranslationMode,
  concurrency?: number,
  qaOptions?: NovelTransConfig["qa"]
): Promise<TranslationSummary> {
  const metadata = await loadProjectMetadata(projectDir);
  return translateProjectQueue({
    metadata,
    adapter,
    mode,
    concurrency: concurrency ?? metadata.options.concurrency,
    qaOptions: qaOptions ?? metadata.options.qa
  });
}

export type ProjectQAProgress = {
  completed: number;
  total: number;
  episodeTitle: string;
};

export async function rerunProjectQA(
  projectDir: string,
  onProgress?: (progress: ProjectQAProgress) => void,
  qaOptions?: NovelTransConfig["qa"]
): Promise<QAIssue[]> {
  const { listEpisodes } = await import("../storage/projectStore.js");
  const metadata = await loadProjectMetadata(projectDir);
  const episodes = await listEpisodes(projectDir);
  const glossary = await loadGlossary(projectDir);
  const effectiveQAOptions = qaOptions ?? metadata.options.qa;
  const previousByFingerprint = new Map((await readAllQAIssues(projectDir)).map((issue) => [issue.fingerprint ?? qaIssueFingerprint(issue), issue]));
  const allIssues: QAIssue[] = [];
  for (const [index, episode] of episodes.entries()) {
    onProgress?.({ completed: index, total: episodes.length, episodeTitle: episode.title });
    const result = await readTranslation(projectDir, episode);
    if (!result) {
      await saveQAIssues(projectDir, episode, []);
      onProgress?.({ completed: index + 1, total: episodes.length, episodeTitle: episode.title });
      continue;
    }
    const issues = preserveResolvedQAIssues(runQA(episode, result, glossary, effectiveQAOptions), previousByFingerprint);
    await saveQAIssues(projectDir, episode, issues);
    allIssues.push(...issues);
    onProgress?.({ completed: index + 1, total: episodes.length, episodeTitle: episode.title });
  }
  await writeQualityReport(projectDir, allIssues);
  return allIssues;
}

function preserveResolvedQAIssues(issues: QAIssue[], previousByFingerprint: Map<string, QAIssue>): QAIssue[] {
  return issues.map((issue) => {
    const fingerprint = issue.fingerprint ?? qaIssueFingerprint(issue);
    const previous = previousByFingerprint.get(fingerprint);
    if (!previous) {
      return { ...issue, fingerprint };
    }
    return {
      ...issue,
      id: previous.id || issue.id,
      fingerprint,
      resolved: previous.resolved,
      createdAt: previous.createdAt || issue.createdAt
    };
  });
}

async function uniqueProjectSlug(projectRoot: string, baseSlug: string): Promise<string> {
  const { pathExists } = await import("../storage/jsonFile.js");
  const root = resolve(projectRoot);
  let slug = baseSlug;
  let counter = 2;
  while (await pathExists(join(root, slug))) {
    slug = `${baseSlug}-${counter}`;
    counter += 1;
  }
  return slug;
}
