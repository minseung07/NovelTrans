import type { QAIssue } from "../../domain/qa.js";
import type { ProjectUiModel } from "../types.js";
import { box, columns, renderScreen, table } from "../layout.js";
import { visibleWindow } from "../visibleWindow.js";

const visibleIssueLimit = 12;

export function renderReviewDeskScreen(model: ProjectUiModel, selectedIndex = 0, width?: number): string {
  const issues = model.reviewDesk.openIssues;
  const window = visibleWindow(issues, selectedIndex, visibleIssueLimit);
  const selected = issues[window.selectedIndex] ?? issues[0];
  const issueLines =
    issues.length > 0
      ? [
          ...hiddenBeforeLine(window.hiddenBefore),
          ...window.items.map((issue, index) => formatIssue(issue, index === window.selectedOffset)),
          ...hiddenAfterLine(window.hiddenAfter)
        ]
      : ["열린 검수 항목이 없습니다."];
  const detailLines = selected ? issueDetailLines(selected) : ["검수함이 비어 있습니다.", "번역 후 QA를 다시 실행하거나 결과물을 만들 수 있습니다."];

  const body = [
    ...columns("검수 항목", issueLines, "상세", detailLines, width),
    "",
    ...box("검수 초점", reviewFocusLines(model), width)
  ];

  return renderScreen(
    "검수 작업대",
    model.overview.metadata.name,
    body,
    "[Enter] 열기   [T] 선택 재번역   [A] 전체 재번역   [F] 같은 유형   [M] 무시   [C] 재검사   [G] 용어   [B] 뒤로",
    { width }
  );
}

function formatIssue(issue: QAIssue, selected: boolean): string {
  const marker = selected ? ">" : " ";
  return `${marker} ${issue.episodeId}  ${labelIssue(issue.type)}  ${issue.severity}`;
}

function issueDetailLines(issue: QAIssue): string[] {
  const lines = table([
    ["화", issue.episodeId],
    ["유형", issue.type],
    ["심각도", issue.severity],
    ["위치", locationLabel(issue)],
    ["해결", issue.resolved ? "예" : "아니오"]
  ], 9);
  lines.push("", issue.message);
  if (issue.sourceSnippet) {
    lines.push("", `원문: ${issue.sourceSnippet}`);
  }
  if (issue.targetSnippet) {
    lines.push("", `번역문: ${issue.targetSnippet}`);
  }
  return lines;
}

function reviewFocusLines(model: ProjectUiModel): string[] {
  if (model.reviewDesk.openIssues.length === 0) {
    return ["검사된 번역문에 열린 문제가 없습니다."];
  }
  return [
    ...model.reviewDesk.buckets.filter((bucket) => bucket.count > 0).map((bucket) => `${bucket.label} ${bucket.count}`),
    "번역문을 열어 수정하거나, 무시/재검사/재번역으로 정리합니다."
  ];
}

function labelIssue(type: QAIssue["type"]): string {
  return type.replaceAll("_", " ");
}

function locationLabel(issue: QAIssue): string {
  const parts: string[] = [];
  if (issue.sourceParagraphIndex !== undefined) {
    parts.push(`원문 문단 ${issue.sourceParagraphIndex}`);
  }
  if (issue.targetParagraphIndex !== undefined) {
    parts.push(`번역문 문단 ${issue.targetParagraphIndex}`);
  }
  return parts.length > 0 ? parts.join(" / ") : "-";
}

function hiddenBeforeLine(count: number): string[] {
  return count > 0 ? [`... 위 ${count}개`] : [];
}

function hiddenAfterLine(count: number): string[] {
  return count > 0 ? [`... 아래 ${count}개`] : [];
}
