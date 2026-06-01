// QA triage stage: open issues grouped by episode beside issue details and a
// source/translation compare panel for the selected episode.

import type { ProjectUiModel, ReviewEpisodeGroup, ReviewIssueFilter } from "../../../ui/types.js";
import type { QAIssue, QAIssueType } from "../../../domain/qa.js";
import { filterReviewEpisodeGroups, filterReviewIssues, reviewFilterLabel, reviewIssueFilterOrder } from "../../../ui/reviewDeskModel.js";
import { columns, visibleWindow, clamp } from "../../components/geometry.js";
import { selectionRow } from "../../components/list.js";
import { severityBadge, type Severity } from "../../components/badge.js";

const LIMIT = 10;

const TYPE_LABELS: Record<QAIssueType, string> = {
  empty_translation: "빈 번역",
  missing_paragraph: "문단 누락",
  japanese_remaining: "일본어 잔존",
  number_mismatch: "숫자 불일치",
  length_ratio: "길이 비율",
  glossary_mismatch: "용어 불일치",
  locked_term_violation: "고정 용어 위반",
  forbidden_term: "금지어",
  name_inconsistency: "이름 불일치",
  repetition: "반복",
  other: "기타"
};

function issueSeverity(issue: QAIssue): Severity {
  return issue.severity === "error" ? "critical" : issue.severity === "warning" ? "warning" : "info";
}

function groupSeverity(group: ReviewEpisodeGroup): Severity {
  return group.issues.some((issue) => issue.severity === "error") ? "critical" : group.issues.some((issue) => issue.severity === "warning") ? "warning" : "info";
}

function episodeLabel(group: ReviewEpisodeGroup): string {
  const prefix = group.episodeNo === null ? group.episodeId : `${group.episodeNo}화`;
  return `${prefix} ${group.title}`;
}

function visibleIssueGroups(project: ProjectUiModel, filter: ReviewIssueFilter, hiddenEpisodeIds: string[]): ReviewEpisodeGroup[] {
  const hidden = new Set(hiddenEpisodeIds);
  return filterReviewEpisodeGroups(project.reviewDesk, filter).filter((group) => !hidden.has(group.episodeId));
}

function visibleOpenIssues(project: ProjectUiModel, hiddenEpisodeIds: string[]): QAIssue[] {
  const hidden = new Set(hiddenEpisodeIds);
  return project.reviewDesk.openIssues.filter((issue) => !hidden.has(issue.episodeId));
}

function bucketLine(project: ProjectUiModel, hiddenEpisodeIds: string[]): string {
  const openIssues = visibleOpenIssues(project, hiddenEpisodeIds);
  const parts = [
    `전체 ${openIssues.length}`,
    ...reviewIssueFilterOrder
      .filter((filter) => filter !== "all")
      .map((filter) => ({ label: reviewFilterLabel(filter), count: filterReviewIssues(openIssues, filter).length }))
      .filter((bucket) => bucket.count > 0)
      .map((bucket) => `${bucket.label} ${bucket.count}`)
  ];
  return parts.join(" · ");
}

function issueLine(issue: QAIssue): string {
  return `${severityBadge(issueSeverity(issue), TYPE_LABELS[issue.type])} ${issue.message}`;
}

function compareLines(group: ReviewEpisodeGroup): string[] {
  const issue = group.issues[0];
  if (!issue) {
    return [`화: ${episodeLabel(group)}`, "", "표시할 검수 항목이 없습니다."];
  }
  return [
    `화: ${episodeLabel(group)}`,
    `이슈: ${group.issues.length}개`,
    "",
    ...group.issues.slice(0, 6).map(issueLine),
    ...(group.issues.length > 6 ? [`외 ${group.issues.length - 6}개`] : []),
    "",
    "대조:",
    `유형: ${TYPE_LABELS[issue.type]}`,
    "",
    "원문:",
    issue.sourceSnippet ?? "(없음)",
    "",
    "번역:",
    issue.targetSnippet ?? "(없음)"
  ];
}

export function renderQa(project: ProjectUiModel, selected: number, filter: ReviewIssueFilter, width: number, hiddenEpisodeIds: string[] = []): string[] {
  const groups = visibleIssueGroups(project, filter, hiddenEpisodeIds);
  const issueCount = groups.reduce((sum, group) => sum + group.issues.length, 0);
  if (groups.length === 0) {
    return columns("검수 큐", [`필터 ${reviewFilterLabel(filter)}`, bucketLine(project, hiddenEpisodeIds), "", "검수 항목이 없습니다."], "원문 / 번역 대조", ["대조할 항목이 없습니다."], width);
  }
  const selectedIndex = clamp(selected, 0, groups.length - 1);
  const window = visibleWindow(groups, selectedIndex, LIMIT);
  const listLines = [
    `필터 ${reviewFilterLabel(filter)} · ${groups.length}화 · ${issueCount}개`,
    bucketLine(project, hiddenEpisodeIds),
    "",
    ...window.items.map((group, index) => selectionRow(severityBadge(groupSeverity(group), `${episodeLabel(group)}  ${group.issues.length}개`), index === window.selectedOffset)),
    "",
    "[i]무시 [r]재검사 [t]재번역",
    "[g]용어 [a]필터"
  ];
  return columns("검수 큐", listLines, "원문 / 번역 대조", compareLines(groups[selectedIndex]!), width);
}
