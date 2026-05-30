// Project Overview stage: pipeline status, "next actions", the live job, and
// recent activity. Also exports the job-display helpers used by the status bar.

import type { ProjectUiModel } from "../../../ui/types.js";
import type { Job } from "../../state/model.js";
import type { TranslationSessionStatus } from "../../../engine/translationSession.js";
import { box } from "../../components/box.js";
import { progressLine, spinnerFrame } from "../../components/progress.js";
import { severityBadge } from "../../components/badge.js";
import { stack } from "../../components/geometry.js";

export function jobStatusLabel(status: TranslationSessionStatus): string {
  const labels: Record<TranslationSessionStatus, string> = {
    idle: "대기",
    running: "진행 중",
    paused: "일시정지",
    completed: "완료",
    failed: "실패",
    cancelled: "취소"
  };
  return labels[status];
}

export function jobPercent(job: Job): number {
  return job.queued > 0 ? Math.round((job.completed / job.queued) * 100) : job.status === "completed" ? 100 : 0;
}

export function jobSegment(job: Job, tick = 0): string {
  const spin = job.status === "running" ? `${spinnerFrame(tick)} ` : "";
  const counts = job.queued > 0 ? ` ${job.completed}/${job.queued} (${jobPercent(job)}%)` : "";
  return `${spin}잡 ${jobStatusLabel(job.status)}${counts}`;
}

function pipelineCard(project: ProjectUiModel, width: number): string[] {
  const counts = project.overview.counts;
  const total = project.overview.episodeStates.length;
  const percent = total === 0 ? 0 : Math.round((counts.completed / total) * 100);
  const openQa = project.qaIssues.filter((issue) => !issue.resolved).length;
  return box(
    "파이프라인",
    [
      `${progressLine(percent, 14)}   ${counts.completed}/${total}화`,
      `대기 ${counts.pending}   진행 ${counts.running}   실패 ${counts.failed}   건너뜀 ${counts.skipped}`,
      `용어 후보 ${project.glossaryPulse.candidates}   충돌 ${project.glossaryPulse.conflicts}   검수 ${openQa}`
    ],
    width
  );
}

function actionsCard(project: ProjectUiModel, width: number): string[] {
  const lines = project.nextActions.map((action) => severityBadge(action.severity, `${action.message}  ${action.commandHint}`));
  return box("지금 할 일", lines.length > 0 ? lines : ["할 일이 없습니다."], width);
}

function jobCard(job: Job | null, width: number): string[] {
  if (!job) {
    return box("라이브 잡", ["진행 중인 잡이 없습니다.", "[T] 번역 시작"], width);
  }
  return box("라이브 잡", [`${jobStatusLabel(job.status)}   ${progressLine(jobPercent(job), 14)}`, `완료 ${job.completed}   대기 ${job.queued}   실패 ${job.failed}`], width);
}

function activityCard(project: ProjectUiModel, width: number): string[] {
  const items = project.timeline.slice(-5);
  return box("최근 활동", items.length > 0 ? items.map((item) => item.label) : ["기록이 없습니다."], width);
}

export function renderOverview(project: ProjectUiModel, job: Job | null, width: number): string[] {
  return stack(pipelineCard(project, width), actionsCard(project, width), jobCard(job, width), activityCard(project, width));
}
