import type { TranslationSessionSnapshot } from "../engine/translationSession.js";
import type { ProjectUiModel } from "./types.js";
import { formatClock, progressBar, table } from "./layout.js";
import { formatDuration } from "./timeFormat.js";

export function studioActionLines(model: ProjectUiModel, session?: TranslationSessionSnapshot | null): string[] {
  if (session && (session.status === "running" || session.status === "paused")) {
    return [
      `번역 ${sessionStatusLabel(session.status)}`,
      session.currentEpisodeTitle ? `현재 ${session.currentEpisodeTitle}` : "현재 화를 확인 중입니다.",
      sessionTimeLine(session)
    ];
  }
  const primary = model.nextActions[0];
  const lines = primary ? [`${severityLabel(primary.severity)} ${primary.commandHint}`, primary.message] : ["- 지금 필요한 작업이 없습니다."];
  if (model.nextActions.length > 1) {
    lines.push("", ...model.nextActions.slice(1, 3).map((action) => `${severityLabel(action.severity)} ${action.commandHint} ${action.message}`));
  }
  return lines;
}

export function studioProgressLines(model: ProjectUiModel): string[] {
  const overview = model.overview;
  const total = overview.episodeStates.length;
  const completed = overview.counts.completed;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  const running = overview.episodeStates.filter((state) => state.status === "running").map((state) => state.episodeNo);
  const pending = overview.episodeStates.filter((state) => state.status === "pending").map((state) => state.episodeNo);
  const failed = overview.episodeStates.filter((state) => state.status === "failed").map((state) => state.episodeNo);

  return [
    `${progressBar(percent, 18)} ${percent}%`,
    "",
    ...table([
      ["완료", `${completed}/${total}`],
      ["진행", summarizeRange(running)],
      ["대기", summarizeRange(pending)],
      ["실패", summarizeRange(failed)]
    ], 7)
  ];
}

export function studioWorkflowLines(model: ProjectUiModel): string[] {
  const queue = model.studioQueue;
  const lines = [
    ...queuePreview("작업 중", queue.active),
    ...queuePreview("다음", queue.next),
    ...queuePreview("실패", queue.failed)
  ];
  return lines.length > 0 ? lines : ["대기 중인 작업이 없습니다."];
}

export function studioQualityLines(model: ProjectUiModel): string[] {
  const source = model.sourceStatus;
  const pulse = model.glossaryPulse;
  const unresolvedQa = model.qaIssues.filter((issue) => !issue.resolved).length;
  const lines = table([
    ["원문", `${source.episodeCount}화, ${source.characterCount}자`],
    ["구조", source.structureLabel],
    ["후기", source.afterwordCount],
    ["긴 화", source.longEpisodeCount],
    ["용어", `${pulse.confirmed} 확정 / ${pulse.candidates} 후보`],
    ["충돌", pulse.conflicts],
    ["검수", unresolvedQa]
  ], 7);
  if (source.warnings.length > 0) {
    lines.push("", `주의: ${sourceWarningLabel(source.warnings[0]!)}`);
  }
  if (pulse.topConflict) {
    lines.push("", `확인 필요: ${pulse.topConflict}`);
  }
  return lines;
}

export function studioTimelineLines(model: ProjectUiModel): string[] {
  if (model.timeline.length === 0) {
    return ["아직 기록된 작업 내역이 없습니다."];
  }
  return model.timeline.slice(0, 5).map((item) => `${timelineMarker(item.severity)} ${formatClock(item.timestamp)} ${item.label}`);
}

export function studioSessionLines(session: TranslationSessionSnapshot): string[] {
  return table([
    ["상태", sessionStatusLabel(session.status)],
    ["대기", session.queued],
    ["완료", session.completed],
    ["실패", session.failed],
    ["작업 중", session.activeEpisodeNos.length > 0 ? session.activeEpisodeNos.join(", ") : "-"],
    ["현재", session.currentEpisodeTitle ?? "-"],
    ["메시지", session.message ?? "-"]
  ], 8);
}

function queuePreview(label: string, items: ProjectUiModel["studioQueue"]["next"]): string[] {
  if (items.length === 0) {
    return [`${label}: 없음`];
  }
  const preview = items.slice(0, 3).map((item) => `${item.episodeNo}. ${item.title}`);
  const suffix = items.length > preview.length ? ` 외 ${items.length - preview.length}개` : "";
  return [`${label}: ${preview.join(" / ")}${suffix}`];
}

function severityLabel(severity: ProjectUiModel["nextActions"][number]["severity"]): string {
  if (severity === "critical") {
    return "긴급";
  }
  if (severity === "warning") {
    return "주의";
  }
  return "안내";
}

function sessionTimeLine(session: TranslationSessionSnapshot): string {
  const elapsed = formatDuration(session.elapsedMs ?? 0);
  const remaining = session.estimatedRemainingMs === null || session.estimatedRemainingMs === undefined
    ? "계산 중"
    : `약 ${formatDuration(session.estimatedRemainingMs)}`;
  return `경과 ${elapsed} · 남은 시간 ${remaining}`;
}

function timelineMarker(severity: ProjectUiModel["timeline"][number]["severity"]): string {
  if (severity === "error") {
    return "!";
  }
  if (severity === "warning") {
    return "*";
  }
  return "-";
}

function sessionStatusLabel(status: TranslationSessionSnapshot["status"]): string {
  if (status === "running") {
    return "진행 중";
  }
  if (status === "paused") {
    return "일시정지";
  }
  if (status === "completed") {
    return "완료";
  }
  if (status === "failed") {
    return "실패";
  }
  if (status === "cancelled") {
    return "취소";
  }
  return "대기";
}

function sourceWarningLabel(warning: string): string {
  const longEpisode = warning.match(/^(\d+) long episode\(s\) detected\.$/);
  if (longEpisode) {
    return `긴 화 ${longEpisode[1]}개가 감지됐습니다.`;
  }
  const afterword = warning.match(/^(\d+) author afterword\(s\) detected\.$/);
  if (afterword) {
    return `작가 후기가 ${afterword[1]}개 감지됐습니다.`;
  }
  if (warning === "No repeated episode heading pattern was detected; imported as a single episode.") {
    return "반복되는 화 제목 패턴이 없어 단일 화로 가져왔습니다.";
  }
  return warning;
}

function summarizeRange(values: number[]): string {
  if (values.length === 0) {
    return "없음";
  }
  if (values.length <= 6) {
    return values.join(", ");
  }
  return `${values[0]}-${values.at(-1)} (${values.length}개)`;
}
