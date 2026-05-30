// Library screen: a "continue" hero card plus the project list with progress
// gauges, an instant search filter, and a problem-projects panel.

import type { AppModel } from "../state/model.js";
import { currentList } from "../state/update.js";
import { box } from "../components/box.js";
import { selectionRow } from "../components/list.js";
import { progressLine } from "../components/progress.js";
import { severityBadge } from "../components/badge.js";
import { stack, visibleWindow } from "../components/geometry.js";
import { formatRelativeTime } from "../components/text.js";
import { getTheme } from "../theme/theme.js";
import type { BookshelfProject } from "../../ui/types.js";

function percentOf(project: BookshelfProject): number {
  return project.total === 0 ? 0 : Math.round((project.completed / project.total) * 100);
}

function heroCard(model: AppModel, width: number): string[] {
  const project = model.library.continueProject;
  if (!project) {
    return box("이어하기", ["아직 프로젝트가 없습니다.", "[N] 새 작품 가져오기"], width);
  }
  return box(
    "이어하기",
    [
      getTheme().bold(project.title),
      `${progressLine(percentOf(project), 12)}   ${project.completed}/${project.total}화`,
      `${project.shelfStatusLabel}   ${project.nextActionLabel}   ${formatRelativeTime(project.updatedAt)}`
    ],
    width
  );
}

function listCard(model: AppModel, width: number, rows: number): string[] {
  const projects = currentList(model);
  if (projects.length === 0) {
    return box("프로젝트", [model.query ? "일치하는 프로젝트가 없습니다.   [Esc] 검색 해제" : `프로젝트 폴더: ${model.library.projectRoot}`], width);
  }
  const limit = Math.max(3, rows - 14);
  const window = visibleWindow(projects, model.selected, limit);
  const lines: string[] = [];
  if (window.hiddenBefore > 0) {
    lines.push(getTheme().muted(`↑ 위 ${window.hiddenBefore}개`));
  }
  window.items.forEach((project, index) => {
    const flag = project.failed > 0 || project.conflicts > 0 ? severityBadge("critical", "") : project.qaIssues > 0 ? severityBadge("warning", "") : "  ";
    lines.push(selectionRow(`${flag}${project.title}  ${progressLine(percentOf(project), 8)}  후보 ${project.candidates}  ${project.shelfStatusLabel}`, index === window.selectedOffset));
  });
  if (window.hiddenAfter > 0) {
    lines.push(getTheme().muted(`↓ 아래 ${window.hiddenAfter}개`));
  }
  return box("프로젝트", lines, width);
}

function problemCard(model: AppModel, width: number): string[] {
  if (model.library.problemProjects.length === 0) {
    return [];
  }
  return box(
    "확인 필요",
    model.library.problemProjects.slice(0, 4).map((project) => `${project.title}  ${project.shelfStatusLabel}  ${project.nextActionLabel}`),
    width
  );
}

export function renderLibrary(model: AppModel, width: number, rows: number): string[] {
  const searchLine = model.searching || model.query ? box("검색", [`${model.query}${model.searching ? getTheme().accent("▌") : ""}`], width) : [];
  return stack(searchLine, heroCard(model, width), listCard(model, width, rows), problemCard(model, width));
}
