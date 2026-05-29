import type { ProjectOverview } from "../domain/project.js";

export function renderProjectStatus(overview: ProjectOverview): string {
  const total = overview.episodeStates.length;
  const completed = overview.counts.completed;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  return [
    overview.metadata.name,
    "번역 작업실",
    "",
    `진행률: ${percent}% (${completed}/${total})`,
    `대기: ${overview.counts.pending}`,
    `실패: ${overview.counts.failed}`,
    `검수 항목: ${overview.qaIssueCount}`,
    `후보 용어: ${overview.glossaryCandidateCount}`,
    `용어 충돌: ${overview.glossaryConflictCount}`,
    "",
    nextAction(overview)
  ].join("\n");
}

function nextAction(overview: ProjectOverview): string {
  if (overview.counts.failed > 0) {
    return `다음 할 일: 실패한 화를 다시 번역하세요. "noveltrans retry --project ${overview.metadata.projectDir}"`;
  }
  if (overview.counts.pending > 0) {
    return `다음 할 일: 남은 화 번역을 이어가세요. "noveltrans translate --project ${overview.metadata.projectDir}"`;
  }
  if (overview.glossaryConflictCount > 0) {
    return "다음 할 일: 용어 충돌을 확인하세요.";
  }
  return "다음 할 일: TXT/EPUB 결과물을 생성하세요.";
}
