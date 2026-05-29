import type { ProjectUiModel } from "../types.js";
import { box, renderScreen } from "../layout.js";

export function renderFailureRecoveryScreen(model: ProjectUiModel, width?: number): string {
  const recovery = model.failureRecovery;
  const body = [
    ...box(
      `실패한 화 ${recovery.failedCount}개`,
      recovery.items.length > 0
        ? recovery.items.map((item) => `${item.episodeNo}. ${item.title}  시도 ${item.attempts}회  ${item.reason}`)
        : ["실패한 화가 없습니다."],
      width
    ),
    "",
    ...box("권장 복구", [
      "[R] 실패한 화만 다시 번역",
      "[S] 실패한 화를 건너뛰고 완료분만 결과물 생성",
      "[L] 에러 로그 경로 보기",
      "",
      `로그: ${recovery.logPath}`
    ], width)
  ];

  return renderScreen("실패 복구", model.overview.metadata.name, body, "[R] 재시도   [S] 건너뛰고 생성   [L] 로그   [B] 뒤로", { width });
}
