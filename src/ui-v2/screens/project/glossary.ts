// Glossary triage stage: a review queue (conflict/candidate/confirmed/locked
// with severity badges and "N remaining") beside the selected term's detail
// (confidence bar, target candidates, forbidden targets).

import type { ProjectUiModel, GlossaryQueueFilter } from "../../../ui/types.js";
import type { GlossaryEntry } from "../../../domain/glossary.js";
import { buildGlossaryQueue } from "../../data/glossary.js";
import { columns, visibleWindow, clamp } from "../../components/geometry.js";
import { selectionRow } from "../../components/list.js";
import { severityBadge, type Severity } from "../../components/badge.js";
import { progressLine } from "../../components/progress.js";

const LIMIT = 10;

function filterLabel(filter: GlossaryQueueFilter): string {
  return filter === "conflicts" ? "충돌만" : filter === "candidates" ? "후보만" : "전체";
}

function labelSeverity(label: string): Severity {
  return label === "conflict" ? "critical" : label === "candidate" ? "warning" : label === "confirmed" || label === "locked" ? "success" : "info";
}

function confidence(entry: GlossaryEntry): number {
  const total = entry.targetCandidates.reduce((sum, candidate) => sum + candidate.count, 0);
  if (total === 0) {
    return 0;
  }
  return Math.round((Math.max(...entry.targetCandidates.map((candidate) => candidate.count)) / total) * 100);
}

function detailLines(entry: GlossaryEntry): string[] {
  const lines = [
    `원문: ${entry.source}`,
    `상태: ${entry.status}${entry.locked ? " (고정)" : ""}`,
    `등장: ${entry.occurrenceCount}회`,
    `번역: ${entry.target ?? "(미확정)"}`,
    `신뢰도 ${progressLine(confidence(entry), 10)}`,
    "",
    "번역 후보:",
    ...(entry.targetCandidates.length > 0 ? entry.targetCandidates.slice(0, 5).map((candidate, index) => `${index + 1}. ${candidate.target}  ${candidate.count}회`) : ["(없음)"])
  ];
  if (entry.forbiddenTargets.length > 0) {
    lines.push("", `금지: ${entry.forbiddenTargets.join(", ")}`);
  }
  return lines;
}

export function renderGlossary(project: ProjectUiModel, selected: number, filter: GlossaryQueueFilter, deferred: string[], width: number): string[] {
  const queue = buildGlossaryQueue(project, filter, deferred);
  if (queue.length === 0) {
    return columns("검토 큐", [`필터 ${filterLabel(filter)}`, "", "검토할 용어가 없습니다."], "용어 상세", ["용어집이 비어 있습니다."], width);
  }
  const selectedIndex = clamp(selected, 0, queue.length - 1);
  const window = visibleWindow(queue, selectedIndex, LIMIT);
  const queueLines = [
    `필터 ${filterLabel(filter)} · ${queue.length} 남음`,
    "",
    ...window.items.map((item, index) => selectionRow(`${item.entry.source}  ${severityBadge(labelSeverity(item.label), item.label)}`, index === window.selectedOffset)),
    "",
    "[c]확정 [l]고정 [f]금칙 [e]편집 [d]폐기 [a]필터"
  ];
  return columns("검토 큐", queueLines, "용어 상세", detailLines(queue[selectedIndex]!.entry), width);
}
