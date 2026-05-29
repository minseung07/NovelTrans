import type { BookshelfModel } from "../types.js";
import { box, formatRelativeTime, progressBar, renderScreen } from "../layout.js";

export function renderBookshelfScreen(model: BookshelfModel, selectedIndex = 0, width?: number): string {
  const body: string[] = [];
  const continueProject = model.continueProject;
  const effectiveSelectedIndex = clampIndex(selectedIndex, model.recentProjects.length);
  body.push(
    ...box(
      "이어하기",
      continueProject
        ? [
            continueProject.title,
            `${continueProject.completed} / ${continueProject.total}화 완료   ${continueProject.shelfStatusLabel}   ${formatRelativeTime(continueProject.updatedAt)}`,
            `${continueProject.nextActionLabel}   [G] 용어   [R] 검수`
          ]
        : ["아직 프로젝트가 없습니다.", "[N] 새 작품 가져오기"],
      width
    ),
    ""
  );

  body.push(
    ...box(
      "최근 프로젝트",
      model.recentProjects.length > 0
        ? model.recentProjects.map((project, index) => {
            const selected = index === effectiveSelectedIndex ? ">" : " ";
            const percent = project.total === 0 ? 0 : Math.round((project.completed / project.total) * 100);
            return `${selected} ${index + 1}. ${project.title}  ${progressBar(percent, 8)} ${percent}%  후보 ${project.candidates}  ${project.shelfStatusLabel}`;
          })
        : [`프로젝트 폴더: ${model.projectRoot}`, "[N]으로 원문 경로, URL, 붙여넣기를 시작하세요."],
      width
    )
  );

  if (model.problemProjects.length > 0) {
    body.push(
      "",
      ...box(
        "확인 필요",
        model.problemProjects
          .slice(0, 4)
          .map((project) => `${project.title}  ${project.shelfStatusLabel}  ${project.nextActionLabel}`),
        width
      )
    );
  }

  return renderScreen("NovelTrans", "번역 작업실", body, "[N] 가져오기   [/] 검색   [S] 설정   [:] 명령   [Q] 종료", { width });
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(length - 1, index));
}
