import type { NovelTransConfig } from "../domain/config.js";
import type { TranslatorAdapter } from "../domain/translation.js";
import type { TranslationSessionSnapshot } from "../engine/translationSession.js";
import { translateSingleEpisode } from "../engine/singleEpisodeTranslation.js";
import { selectedOpenIssue } from "./actions/reviewActions.js";
import type { ProjectUiModel } from "./types.js";

export type ReviewRetranslationScope = "selected" | "all-open" | "same-type";

export type ReviewRetranslationQueueItem = {
  episodeId: string;
  episodeNo: number | null;
  title: string;
  issueTypes: string[];
};

export type ReviewRetranslationTask = {
  controller: AbortController;
  initialSnapshot: TranslationSessionSnapshot;
  done: Promise<{ snapshot: TranslationSessionSnapshot; message: string }>;
  enqueue(items: ReviewRetranslationQueueItem[]): number;
  queuedEpisodeIds(): string[];
  snapshot(): TranslationSessionSnapshot;
};

type ReviewRetranslationQueueState = {
  queue: ReviewRetranslationQueueItem[];
  episodeIds: Set<string>;
  completed: number;
  failed: number;
  cancelled: number;
  current: ReviewRetranslationQueueItem | null;
  status: TranslationSessionSnapshot["status"];
  message: string;
  startedAtMs: number;
  startedAt: string;
  onSnapshot: ((snapshot: TranslationSessionSnapshot) => void) | undefined;
};

export function createReviewRetranslationTask(options: {
  projectDir: string;
  model: ProjectUiModel;
  selectedIssueIndex: number;
  adapter: TranslatorAdapter;
  scope: ReviewRetranslationScope;
  qaOptions?: NovelTransConfig["qa"];
  onSnapshot?: (snapshot: TranslationSessionSnapshot) => void;
}): ReviewRetranslationTask | null {
  const queue = buildReviewRetranslationQueue(options.model, options.selectedIssueIndex, options.scope);
  if (queue.length === 0) {
    return null;
  }
  const controller = new AbortController();
  const first = queue[0]!;
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const state: ReviewRetranslationQueueState = {
    queue: [...queue],
    episodeIds: new Set(queue.map((item) => item.episodeId)),
    completed: 0,
    failed: 0,
    cancelled: 0,
    current: first,
    status: "running",
    message: `검수 재번역 시작: ${queue.length}화`,
    startedAtMs,
    startedAt,
    onSnapshot: options.onSnapshot
  };
  const initialSnapshot = queueSnapshot(state);
  return {
    controller,
    initialSnapshot,
    done: Promise.resolve().then(() => runReviewRetranslationQueue({
      projectDir: options.projectDir,
      adapter: options.adapter,
      controller,
      state,
      qaOptions: options.qaOptions
    })),
    enqueue: (items) => enqueueReviewRetranslationItems(state, items),
    queuedEpisodeIds: () => Array.from(state.episodeIds),
    snapshot: () => queueSnapshot(state)
  };
}

export function failedReviewRetranslationSnapshot(error: unknown, title: string): TranslationSessionSnapshot {
  return {
    status: "failed",
    queued: 1,
    completed: 0,
    failed: 1,
    skipped: 0,
    currentEpisodeTitle: title,
    activeEpisodeNos: [],
    activeEpisodeTitles: [],
    message: (error as Error).message
  };
}

export function buildReviewRetranslationQueue(
  model: ProjectUiModel,
  selectedIssueIndex: number,
  scope: ReviewRetranslationScope
): ReviewRetranslationQueueItem[] {
  const selected = selectedOpenIssue(model, selectedIssueIndex);
  if (!selected) {
    return [];
  }
  const issues =
    scope === "selected"
      ? [selected]
      : model.reviewDesk.openIssues.filter((issue) => scope === "all-open" || issue.type === selected.type);
  const byEpisode = new Map<string, ReviewRetranslationQueueItem>();
  for (const issue of issues) {
    const episode = model.episodes.find((item) => item.id === issue.episodeId);
    const item = byEpisode.get(issue.episodeId);
    if (item) {
      if (!item.issueTypes.includes(issue.type)) {
        item.issueTypes.push(issue.type);
      }
      continue;
    }
    byEpisode.set(issue.episodeId, {
      episodeId: issue.episodeId,
      episodeNo: episode?.episodeNo ?? null,
      title: episode?.title ?? issue.episodeId,
      issueTypes: [issue.type]
    });
  }
  return Array.from(byEpisode.values());
}

async function runReviewRetranslationQueue(options: {
  projectDir: string;
  adapter: TranslatorAdapter;
  controller: AbortController;
  state: ReviewRetranslationQueueState;
  qaOptions?: NovelTransConfig["qa"];
}): Promise<{ snapshot: TranslationSessionSnapshot; message: string }> {
  let index = 0;
  const state = options.state;

  while (index < state.queue.length) {
    if (options.controller.signal.aborted) {
      state.cancelled += state.queue.length - index;
      break;
    }
    const item = state.queue[index]!;
    index += 1;
    state.current = item;
    state.message = `${item.title} 재번역 중`;
    emitSnapshot(state);
    const summary = await translateSingleEpisode({
      projectDir: options.projectDir,
      episodeId: item.episodeId,
      adapter: options.adapter,
      reason: `Review Desk: ${item.issueTypes.join(", ")}`,
      signal: options.controller.signal,
      qaOptions: options.qaOptions
    });
    state.completed += summary.completed;
    state.failed += summary.failed;
    state.cancelled += summary.cancelled;
    if (summary.cancelled > 0 || options.controller.signal.aborted) {
      state.cancelled += state.queue.length - index;
      break;
    }
    state.current = null;
    state.message = `검수 재번역 ${state.completed + state.failed}/${state.queue.length}화 처리`;
    emitSnapshot(state);
  }

  state.status = state.cancelled > 0 ? "cancelled" : state.failed > 0 ? "failed" : "completed";
  state.current = null;
  const message = `검수 재번역 ${statusLabel(state.status)}: 완료 ${state.completed}, 실패 ${state.failed}, 취소 ${state.cancelled}.`;
  state.message = message;
  return {
    message,
    snapshot: queueSnapshot(state)
  };
}

function enqueueReviewRetranslationItems(state: ReviewRetranslationQueueState, items: ReviewRetranslationQueueItem[]): number {
  if (state.status !== "running") {
    return 0;
  }
  let added = 0;
  for (const item of items) {
    if (state.episodeIds.has(item.episodeId)) {
      continue;
    }
    state.queue.push(item);
    state.episodeIds.add(item.episodeId);
    added += 1;
  }
  if (added > 0) {
    state.message = `${added}개 화를 재번역 큐에 추가했습니다.`;
    emitSnapshot(state);
  }
  return added;
}

function emitSnapshot(state: ReviewRetranslationQueueState): TranslationSessionSnapshot {
  const snapshot = queueSnapshot(state);
  state.onSnapshot?.(snapshot);
  return snapshot;
}

function queueSnapshot(state: ReviewRetranslationQueueState): TranslationSessionSnapshot {
  const processed = state.completed + state.failed + state.cancelled;
  const elapsedMs = Math.max(0, Date.now() - state.startedAtMs);
  const remaining = Math.max(0, state.queue.length - processed);
  return {
    status: state.status,
    queued: state.queue.length,
    completed: state.completed,
    failed: state.failed,
    skipped: state.cancelled,
    startedAt: state.startedAt,
    elapsedMs,
    estimatedRemainingMs: processed > 0 ? Math.ceil((elapsedMs / processed) * remaining) : null,
    currentEpisodeTitle: state.current?.title ?? null,
    activeEpisodeNos: state.current?.episodeNo ? [state.current.episodeNo] : [],
    activeEpisodeTitles: state.current ? [state.current.title] : [],
    message: state.message
  };
}

function statusLabel(status: TranslationSessionSnapshot["status"]): string {
  if (status === "cancelled") {
    return "취소";
  }
  if (status === "failed") {
    return "완료 후 일부 실패";
  }
  return "완료";
}
