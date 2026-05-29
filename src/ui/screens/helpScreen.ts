import { box, renderScreen } from "../layout.js";

export function renderHelpScreen(width?: number): string {
  const body = [
    ...box("공간", [
      "책장 -> 작업실 -> 용어 연구실 -> 검수 작업대 -> 결과물 제작실",
      "프로젝트 상태, 용어 상태, 검수 항목, 결과물 준비를 한 흐름에서 관리합니다."
    ], width),
    "",
    ...box("키", [
      "[Enter] 열기 또는 생성",
      "[N] 새 작품 가져오기",
      "[T] 번역 이어가기",
      "[G] 용어 연구실",
      "[R] 검수 작업대",
      "[E] 결과물 제작실",
      "[/] 프로젝트 검색",
      "[S] 설정",
      "[:] 또는 Ctrl+K 명령 팔레트",
      "[B] 뒤로",
      "[U] 되돌리기",
      "[Q] 종료"
    ], width),
    "",
    ...box("실패 복구", [
      "실패한 화는 완료분을 유지한 채 따로 처리합니다.",
      "[R] 실패한 화만 다시 번역합니다.",
      "[S] 실패한 화를 건너뛰고 완료분만 결과물로 만듭니다.",
      "[L] 에러 로그 경로를 보여줍니다."
    ], width)
  ];
  return renderScreen("도움말", "번역 작업실", body, "[B] 뒤로   [:] 명령   [Q] 종료", { width });
}
