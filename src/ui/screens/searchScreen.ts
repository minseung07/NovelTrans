import type { BookshelfModel } from "../types.js";
import { box, renderScreen } from "../layout.js";
import { visibleWindow } from "../visibleWindow.js";

const visibleSearchLimit = 10;

export function renderProjectSearchScreen(model: BookshelfModel, query: string, selectedIndex = 0, width?: number): string {
  const normalized = query.trim().toLowerCase();
  const matches = model.allProjects.filter((project) => {
    if (!normalized) {
      return true;
    }
    return `${project.title} ${project.statusText} ${project.shelfStatusLabel} ${project.projectDir}`.toLowerCase().includes(normalized);
  });
  const window = visibleWindow(matches, selectedIndex, visibleSearchLimit);
  const lines =
    matches.length > 0
      ? [
          ...hiddenBeforeLine(window.hiddenBefore),
          ...window.items.map((project, index) => `${index === window.selectedOffset ? ">" : " "} ${project.title}  ${project.completed}/${project.total}  ${project.shelfStatusLabel}`),
          ...hiddenAfterLine(window.hiddenAfter)
        ]
      : ["일치하는 프로젝트가 없습니다."];
  const body = [
    ...box("검색", [`> ${query}`, "", ...lines], width)
  ];
  return renderScreen("프로젝트 검색", model.projectRoot, body, "[입력] 필터   [↑/↓] 선택   [Enter] 열기   [Esc] 닫기", { width });
}

function hiddenBeforeLine(count: number): string[] {
  return count > 0 ? [`... 위 ${count}개`] : [];
}

function hiddenAfterLine(count: number): string[] {
  return count > 0 ? [`... 아래 ${count}개`] : [];
}
