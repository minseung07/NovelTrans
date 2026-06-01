import type { NovelTransConfig } from "../../domain/config.js";
import type { TranslatorAdapter } from "../../domain/translation.js";
import { rerunProjectQA, type ProjectQAOptions, type ProjectQAProgress } from "../../engine/projectWorkflow.js";
import { translateSingleEpisode } from "../../engine/singleEpisodeTranslation.js";
import { translationMarkdownPath } from "../../storage/projectPaths.js";
import { listEpisodes, loadProjectMetadata, updateQAIssue } from "../../storage/projectStore.js";
import { writeProjectLog } from "../../storage/logger.js";
import { filterReviewIssues, selectedReviewIssue } from "../reviewDeskModel.js";
import type { ProjectUiModel, ReviewIssueFilter } from "../types.js";
import { openFile, type OpenFileOptions } from "./fileOpenActions.js";

function selectedOpenIssue(model: ProjectUiModel, selectedIndex: number, filter: ReviewIssueFilter = "all") {
  return selectedReviewIssue(model.reviewDesk, selectedIndex, filter);
}

type RetryIssueEpisodeResult = {
  episodeId: string;
  completed: number;
  failed: number;
  cancelled: number;
  message: string;
};

export type RetryIssueScope = "all-open" | "same-type";

export type RetryIssueProgress = {
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  currentEpisodeId: string | null;
  currentEpisodeTitle: string | null;
};

function episodeTitle(model: ProjectUiModel, episodeId: string): string | null {
  const episode = model.episodes.find((item) => item.id === episodeId);
  return episode ? `${episode.episodeNo}화 ${episode.title}` : null;
}

export async function markSelectedIssueIgnored(projectDir: string, model: ProjectUiModel, selectedIndex: number, filter: ReviewIssueFilter = "all"): Promise<string> {
  const issue = selectedOpenIssue(model, selectedIndex, filter);
  if (!issue) {
    return "선택된 검수 항목이 없습니다.";
  }
  const updated = await updateQAIssue(projectDir, issue.id, { resolved: true });
  const metadata = await loadProjectMetadata(projectDir);
  await writeProjectLog({
    projectDir,
    category: "qa",
    event: "issue_ignored",
    message: `${issue.episodeId} ${issue.type} ignored.`,
    projectId: metadata.id,
    episodeId: issue.episodeId,
    metadata: { issueId: issue.id }
  });
  return updated ? `검수 항목을 숨겼습니다: ${issue.type}` : "검수 항목을 찾지 못했습니다.";
}

export async function retrySelectedIssueEpisodeResult(
  projectDir: string,
  model: ProjectUiModel,
  selectedIndex: number,
  adapter: TranslatorAdapter,
  signal?: AbortSignal,
  qaOptions?: NovelTransConfig["qa"],
  filter: ReviewIssueFilter = "all",
  onProgress?: (progress: RetryIssueProgress) => void
): Promise<RetryIssueEpisodeResult> {
  const issue = selectedOpenIssue(model, selectedIndex, filter);
  if (!issue) {
    return {
      episodeId: "",
      completed: 0,
      failed: 0,
      cancelled: 0,
      message: "선택된 검수 항목이 없습니다."
    };
  }
  const label = episodeTitle(model, issue.episodeId) ?? issue.episodeId;
  onProgress?.({
    total: 1,
    completed: 0,
    failed: 0,
    cancelled: 0,
    currentEpisodeId: issue.episodeId,
    currentEpisodeTitle: label
  });
  const summary = await translateSingleEpisode({
    projectDir,
    episodeId: issue.episodeId,
    adapter,
    reason: `Review Desk: ${issue.type}`,
    signal,
    qaOptions
  });
  onProgress?.({
    total: 1,
    completed: summary.completed,
    failed: summary.failed,
    cancelled: summary.cancelled,
    currentEpisodeId: null,
    currentEpisodeTitle: null
  });
  return {
    episodeId: issue.episodeId,
    completed: summary.completed,
    failed: summary.failed,
    cancelled: summary.cancelled,
    message: `${label} 재번역이 마무리되었습니다: 완료 ${summary.completed}, 실패 ${summary.failed}, 취소 ${summary.cancelled}.`
  };
}

export async function retryIssueEpisodesResult(
  projectDir: string,
  model: ProjectUiModel,
  selectedIndex: number,
  scope: RetryIssueScope,
  adapter: TranslatorAdapter,
  signal?: AbortSignal,
  qaOptions?: NovelTransConfig["qa"],
  filter: ReviewIssueFilter = "all",
  onProgress?: (progress: RetryIssueProgress) => void
): Promise<RetryIssueEpisodeResult> {
  const selected = selectedOpenIssue(model, selectedIndex, filter);
  if (!selected) {
    return {
      episodeId: "",
      completed: 0,
      failed: 0,
      cancelled: 0,
      message: "선택된 검수 항목이 없습니다."
    };
  }

  const openIssues = filterReviewIssues(model.reviewDesk.openIssues, filter);
  const issues = scope === "same-type" ? openIssues.filter((issue) => issue.type === selected.type) : openIssues;
  const episodeIds = Array.from(new Set(issues.map((issue) => issue.episodeId)));
  if (episodeIds.length === 0) {
    return {
      episodeId: "",
      completed: 0,
      failed: 0,
      cancelled: 0,
      message: "재번역할 검수 화가 없습니다."
    };
  }

  let completed = 0;
  let failed = 0;
  let cancelled = 0;
  for (const episodeId of episodeIds) {
    onProgress?.({
      total: episodeIds.length,
      completed,
      failed,
      cancelled,
      currentEpisodeId: episodeId,
      currentEpisodeTitle: episodeTitle(model, episodeId)
    });
    const summary = await translateSingleEpisode({
      projectDir,
      episodeId,
      adapter,
      reason: scope === "same-type" ? `Review Desk batch: ${selected.type}` : "Review Desk batch",
      signal,
      qaOptions
    });
    completed += summary.completed;
    failed += summary.failed;
    cancelled += summary.cancelled;
    onProgress?.({
      total: episodeIds.length,
      completed,
      failed,
      cancelled,
      currentEpisodeId: null,
      currentEpisodeTitle: null
    });
    if (signal?.aborted) {
      break;
    }
  }

  return {
    episodeId: episodeIds.join(","),
    completed,
    failed,
    cancelled,
    message: `검수 화 재번역이 마무리되었습니다: 대상 ${episodeIds.length}, 완료 ${completed}, 실패 ${failed}, 취소 ${cancelled}.`
  };
}

export async function recheckReviewDeskQA(projectDir: string, onProgress?: (progress: ProjectQAProgress) => void, qaOptions?: NovelTransConfig["qa"], options: ProjectQAOptions = {}): Promise<string> {
  const issues = await rerunProjectQA(projectDir, onProgress, qaOptions, options);
  const openIssueCount = issues.filter((issue) => !issue.resolved).length;
  const metadata = await loadProjectMetadata(projectDir);
  await writeProjectLog({
    projectDir,
    category: "qa",
    event: "qa_rechecked",
    message: `${openIssueCount} open QA issue(s) after recheck.`,
    projectId: metadata.id,
    metadata: { issueCount: openIssueCount, totalIssueCount: issues.length }
  });
  const excludedCount = new Set(options.excludeEpisodeIds ?? []).size;
  const suffix = excludedCount > 0 ? ` 재번역 중 ${excludedCount}화 제외.` : "";
  return `검수 재검사 완료: 열린 항목 ${openIssueCount}개.${suffix}`;
}

export async function openSelectedIssueTranslation(
  projectDir: string,
  model: ProjectUiModel,
  selectedIndex: number,
  filter: ReviewIssueFilter = "all",
  options: OpenFileOptions = {}
): Promise<string> {
  const path = await resolveTranslationPathForSelectedIssue(projectDir, model, selectedIndex, filter);
  if (isResolutionMessage(path)) {
    return path;
  }
  const result = await openFile(path, options);
  const issue = selectedOpenIssue(model, selectedIndex, filter);
  const metadata = await loadProjectMetadata(projectDir);
  await writeProjectLog({
    projectDir,
    category: "qa",
    event: result.opened ? "translation_opened" : "translation_open_skipped",
    message: result.message,
    projectId: metadata.id,
    episodeId: issue?.episodeId,
    metadata: { command: result.command, issueId: issue?.id }
  });
  return result.opened ? result.message : `${result.message}. 바로 열려면 NOVELTRANS_EDITOR 또는 EDITOR를 설정하세요.`;
}

async function resolveTranslationPathForSelectedIssue(projectDir: string, model: ProjectUiModel, selectedIndex: number, filter: ReviewIssueFilter): Promise<string> {
  const issue = selectedOpenIssue(model, selectedIndex, filter);
  if (!issue) {
    return "선택된 검수 항목이 없습니다.";
  }
  const episodes = await listEpisodes(projectDir);
  const episode = episodes.find((item) => item.id === issue.episodeId);
  if (!episode) {
    return `화를 찾을 수 없습니다: ${issue.episodeId}`;
  }
  const path = translationMarkdownPath(projectDir, episode.episodeNo);
  return path;
}

function isResolutionMessage(value: string): boolean {
  return value.startsWith("선택된") || value.startsWith("화를 ");
}
