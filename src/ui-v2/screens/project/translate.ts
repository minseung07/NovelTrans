// Translate stage: job control + queue status + failed episodes inline
// (absorbs the old failure-recovery screen, incl. skip-and-export).

import type { ProjectUiModel, StudioQueueItem } from "../../../ui/types.js";
import type { Job } from "../../state/model.js";
import { box } from "../../components/box.js";
import { progressLine } from "../../components/progress.js";
import { stack } from "../../components/geometry.js";
import { jobStatusLabel, jobPercent, jobKindLabel } from "./overview.js";

const ACTIVE_LIMIT = 5;

function queueLine(item: StudioQueueItem): string {
  return `${item.episodeNo}. ${item.title}  ${item.status}`;
}

function isActiveQaRetranslation(job: Job | null): job is Job {
  return Boolean(job && (job.status === "running" || job.status === "paused") && (job.kind === "qa-retranslate" || job.kind === "qa-batch-retranslate"));
}

function canPause(job: Job): boolean {
  return job.kind === "translate" || job.kind === "retry";
}

function liveEpisodeId(project: ProjectUiModel, job: Job): string | null {
  if (job.current) {
    const episode = project.episodes.find((item) => `${item.episodeNo}화 ${item.title}` === job.current);
    if (episode) {
      return episode.id;
    }
  }
  return job.episodeIds?.length === 1 ? (job.episodeIds[0] ?? null) : null;
}

function retranslationActiveLines(project: ProjectUiModel, job: Job | null): Array<{ episodeId?: string; line: string }> {
  if (!isActiveQaRetranslation(job)) {
    return [];
  }
  const status = job.status === "paused" ? `${jobKindLabel(job)} 일시정지` : jobKindLabel(job);
  const liveId = liveEpisodeId(project, job);
  const episodeIds = liveId ? [liveId] : (job.episodeIds ?? []).slice(0, ACTIVE_LIMIT);
  if (episodeIds.length > 0) {
    return episodeIds.map((episodeId) => {
      const episode = project.episodes.find((item) => item.id === episodeId);
      return {
        episodeId,
        line: episode ? `${episode.episodeNo}. ${episode.title}  ${status}` : `${episodeId}  ${status}`
      };
    });
  }
  const label = job.current ?? job.label;
  return label ? [{ line: `${label}  ${status}` }] : [];
}

function activeLines(project: ProjectUiModel, job: Job | null): string[] {
  const retranslation = retranslationActiveLines(project, job);
  const retranslationIds = new Set(retranslation.map((item) => item.episodeId).filter((episodeId): episodeId is string => Boolean(episodeId)));
  const stored = project.studioQueue.active.filter((item) => !item.episodeId || !retranslationIds.has(item.episodeId)).map(queueLine);
  return [...retranslation.map((item) => item.line), ...stored].slice(0, ACTIVE_LIMIT);
}

function actionLine(project: ProjectUiModel, job: Job | null): string {
  if (job?.status === "running") {
    return canPause(job) ? "[p]일시정지 [x]취소" : "[x]취소";
  }
  if (job?.status === "paused") {
    return canPause(job) ? "[p]재개 [x]취소" : "[x]취소";
  }
  const actions: string[] = [];
  if (project.overview.counts.pending > 0 || project.overview.counts.running > 0) {
    actions.push("[t]이어가기");
  }
  if (project.overview.counts.failed > 0) {
    actions.push("[y]실패 재시도", "[s]건너뛰고 내보내기");
  }
  return actions.length > 0 ? actions.join(" ") : "번역할 대기 화가 없습니다.";
}

export function renderTranslate(project: ProjectUiModel, job: Job | null, width: number): string[] {
  const counts = project.overview.counts;
  const total = project.overview.episodeStates.length;
  const statusLine = job
    ? `${jobKindLabel(job)} ${jobStatusLabel(job.status)}  ${progressLine(jobPercent(job), 14)}  완료 ${job.completed}/${job.queued}  실패 ${job.failed}`
    : `완료 ${counts.completed}/${total}  대기 ${counts.pending}  실행 ${counts.running}  실패 ${counts.failed}`;
  const control = box("번역 상태", [statusLine, actionLine(project, job)], width);
  const activeItems = activeLines(project, job);
  const active = box("진행 중", activeItems.length > 0 ? activeItems : ["진행 중인 화가 없습니다."], width);
  const failed = box(
    "실패한 화",
    project.failureRecovery.items.length > 0 ? project.failureRecovery.items.slice(0, 6).map((item) => `${item.episodeNo}. ${item.title} — ${item.reason}`) : ["실패한 화가 없습니다."],
    width
  );
  return stack(control, active, failed);
}
