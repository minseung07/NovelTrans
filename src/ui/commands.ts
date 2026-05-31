import type { PaletteCommand } from "./types.js";

export const paletteCommands: PaletteCommand[] = [
  { id: "open-bookshelf", label: "책장 열기", hint: "프로젝트 목록", requiresProject: false },
  { id: "import-source", label: "새 작품 가져오기", hint: "원문 가져오기", requiresProject: false },
  { id: "search-projects", label: "프로젝트 검색", hint: "책장 검색", requiresProject: false },
  { id: "open-settings", label: "번역 레시피와 설정", hint: "기본 설정", requiresProject: false },
  { id: "open-setup", label: "번역 엔진 설정 마법사", hint: "엔진 모델 인증 설정", requiresProject: false },
  { id: "open-help", label: "도움말", hint: "키 안내", requiresProject: false },
  { id: "open-studio", label: "작업실 열기", hint: "현재 프로젝트", requiresProject: true },
  { id: "continue-translation", label: "멈춘 작업 이어가기", hint: "대기 화 번역", requiresProject: true },
  { id: "retry-failed", label: "실패 화만 재시도", hint: "실패 화 재번역", requiresProject: true, requiresConfirmation: true },
  { id: "open-failure-recovery", label: "실패 복구 화면", hint: "복구 작업", requiresProject: true },
  { id: "skip-failed-export", label: "실패 화 건너뛰고 결과물 제작", hint: "완료분만 내보내기", requiresProject: true, requiresConfirmation: true },
  { id: "show-error-log", label: "에러 로그 위치 보기", hint: "로그 경로", requiresProject: true },
  { id: "open-glossary", label: "용어집 연구실", hint: "전체 용어", requiresProject: true },
  { id: "glossary-conflicts", label: "충돌 용어만 보기", hint: "충돌 검토", requiresProject: true },
  { id: "glossary-candidates", label: "후보 용어 검토", hint: "후보 정리", requiresProject: true },
  { id: "glossary-export-json", label: "용어집 JSON 내보내기", hint: "JSON 저장", requiresProject: true },
  { id: "glossary-current-terms", label: "현재 화의 관련 용어 보기", hint: "현재 화 용어", requiresProject: true },
  { id: "open-review", label: "검수 작업대", hint: "QA 확인", requiresProject: true },
  { id: "review-open-translation", label: "선택 QA 번역문 열기", hint: "번역문 열기", requiresProject: true },
  { id: "review-ignore-issue", label: "선택 QA 이슈 무시", hint: "무시 처리", requiresProject: true, requiresConfirmation: true },
  { id: "review-retranslate-issue", label: "선택 QA 화 재번역", hint: "선택 화 재번역", requiresProject: true, requiresConfirmation: true },
  { id: "review-retranslate-all", label: "열린 검수 화 모두 재번역", hint: "전체 재번역 큐", requiresProject: true, requiresConfirmation: true },
  { id: "review-retranslate-same-type", label: "같은 유형 검수 화 재번역", hint: "유형별 재번역 큐", requiresProject: true, requiresConfirmation: true },
  { id: "rerun-qa", label: "수정 후 재검사", hint: "QA 재검사", requiresProject: true },
  { id: "open-export", label: "결과물 제작실", hint: "출력 준비", requiresProject: true },
  { id: "export-all", label: "TXT/EPUB 생성", hint: "결과물 생성", requiresProject: true, requiresConfirmation: true },
  { id: "export-toggle-txt", label: "TXT 출력 토글", hint: "TXT 켜기/끄기", requiresProject: true },
  { id: "export-toggle-epub", label: "EPUB 출력 토글", hint: "EPUB 켜기/끄기", requiresProject: true },
  { id: "export-toggle-vertical", label: "세로쓰기 토글", hint: "EPUB 방향", requiresProject: true },
  { id: "export-toggle-appendix", label: "용어집 부록 토글", hint: "부록 포함", requiresProject: true },
  { id: "export-toggle-afterword", label: "후기 출력 토글", hint: "후기 포함", requiresProject: true },
  { id: "settings-cycle-backend", label: "기본 번역 엔진 변경", hint: "고급 설정", requiresProject: false },
  { id: "settings-cycle-model", label: "기본 모델 변경", hint: "고급 설정", requiresProject: false },
  { id: "settings-inc-concurrency", label: "동시 처리 늘리기", hint: "고급 설정", requiresProject: false },
  { id: "settings-dec-concurrency", label: "동시 처리 줄이기", hint: "고급 설정", requiresProject: false },
  { id: "settings-cycle-strictness", label: "용어집 엄격도 변경", hint: "고급 설정", requiresProject: false }
];

export function filterPaletteCommands(query: string, hasProject: boolean): PaletteCommand[] {
  const normalized = query.trim().toLowerCase();
  const commands = paletteCommands
    .filter((command) => hasProject || !command.requiresProject)
    .filter((command) => {
      if (!normalized) {
        return true;
      }
      return `${command.id} ${command.label} ${command.hint}`.toLowerCase().includes(normalized);
    });
  if (!normalized) {
    return commands.slice(0, 8);
  }
  return commands
    .map((command) => ({ command, score: paletteScore(command, normalized) }))
    .sort((left, right) => left.score - right.score || left.command.label.localeCompare(right.command.label))
    .map((item) => item.command)
    .slice(0, 8);
}

function paletteScore(command: PaletteCommand, normalized: string): number {
  const id = command.id.toLowerCase();
  const label = command.label.toLowerCase();
  const hint = command.hint.toLowerCase();
  let score = 100;
  if (id === normalized || label === normalized || hint === normalized) {
    score = 0;
  } else if (id === `open-${normalized}`) {
    score = 5;
  } else if (id.startsWith(normalized)) {
    score = 10;
  } else if (label.startsWith(normalized)) {
    score = 15;
  } else if (hint.startsWith(normalized)) {
    score = 20;
  } else if (id.includes(normalized)) {
    score = 40;
  } else if (label.includes(normalized)) {
    score = 45;
  } else if (hint.includes(normalized)) {
    score = 50;
  }
  if (command.requiresConfirmation) {
    score += 20;
  }
  if (id.startsWith("open-")) {
    score -= 3;
  }
  return score;
}
