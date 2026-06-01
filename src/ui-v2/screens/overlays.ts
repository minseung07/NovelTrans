// Global overlays: Help (keymap-derived), Settings (config summary + editing
// keys), and the Command Palette (fuzzy-filtered command list).

import type { NovelTransConfig } from "../../domain/config.js";
import type { SetupStep, SetupValidation } from "../state/model.js";
import { box } from "../components/box.js";
import { selectionRow } from "../components/list.js";
import { severityBadge } from "../components/badge.js";
import { clamp } from "../components/geometry.js";
import { keyBindings } from "../state/keymap.js";
import { filterPaletteCommands } from "../data/palette.js";

const STAGE_LEGEND = [
  "공통 · 이동 ↑↓/jk · 선택 Enter · 뒤로 Esc/b · 단계 1~6",
  "원문 · ↑↓ 화 선택",
  "번역 · t 이어가기 · y 실패 재시도 · p 일시정지 · x 취소 · s 건너뛰고 내보내기",
  "용어 · c 확정 · l 고정 · f 금칙 · e 편집 · d 폐기 · a 필터",
  "검수 · i 무시 · r 재검사 · t 재번역 · g 용어 · a 필터",
  "내보내기 · t/e/p/v/a 토글 · g 생성",
  "설정 · b 엔진 · m 모델 · g 엄격도 · +/- 동시성 · t/e 출력 · w 마법사"
];

export function renderHelp(width: number): string[] {
  const hints = Array.from(new Set(keyBindings.map((binding) => binding.hint).filter((hint): hint is string => Boolean(hint))));
  return box("도움말", [...hints, "", ...STAGE_LEGEND, "", "[Esc] 닫기"], width);
}

export function renderSettings(config: NovelTransConfig, width: number): string[] {
  return box(
    "설정",
    [
      `백엔드: ${config.defaultBackend}`,
      `모델: ${config.defaultModel}`,
      `동시성: ${config.concurrency}`,
      `번역 스타일: ${config.translationStyle}`,
      `용어 엄격도: ${config.glossaryStrictness}`,
      `출력: ${config.outputFormats.join("+").toUpperCase()}`,
      `API 키: [k]로 입력 (로컬 파일에 저장)`,
      `Base URL: ${config.openAICompatible.baseUrl}`,
      "",
      "[b]엔진 [m]모델 [g]엄격도 [+/-]동시성 [t]TXT [e]EPUB [k]API키 [u]BaseURL [w]설정마법사 [Esc]닫기"
    ],
    width
  );
}

export function renderPalette(query: string, selected: number, hasProject: boolean, width: number): string[] {
  const commands = filterPaletteCommands(query, hasProject);
  const lines: string[] = [`> ${query}`, ""];
  if (commands.length === 0) {
    lines.push("일치하는 명령이 없습니다.");
  } else {
    const active = clamp(selected, 0, commands.length - 1);
    commands.forEach((command, index) => {
      const tag = command.requiresConfirmation ? `  ${severityBadge("warning", "확인")}` : "";
      lines.push(selectionRow(`${command.label}${tag}`, index === active));
    });
  }
  return box("명령 팔레트", lines, width);
}

const SETUP_STEP_LABELS: Record<SetupStep, string> = { engine: "1.엔진", model: "2.모델", credentials: "3.인증", validate: "4.점검" };

export function renderSetup(config: NovelTransConfig, step: SetupStep, validation: SetupValidation, width: number): string[] {
  const steps = (Object.keys(SETUP_STEP_LABELS) as SetupStep[])
    .map((key) => (key === step ? `[${SETUP_STEP_LABELS[key]}]` : SETUP_STEP_LABELS[key]))
    .join("  ");
  const lines: string[] = ["첫 실행 설정 마법사", steps, ""];
  if (step === "engine") {
    lines.push(`현재 엔진: ${config.defaultBackend}`, "", "[b] 엔진 변경   [Enter] 다음");
  } else if (step === "model") {
    lines.push(`현재 모델: ${config.defaultModel}`, "", "[m] 모델 변경   [Enter] 다음");
  } else if (step === "credentials") {
    if (config.defaultBackend === "openai-compatible") {
      lines.push(`Base URL: ${config.openAICompatible.baseUrl}`, "API 키는 [k]로 입력하면 로컬 파일에 저장됩니다.", "", "[k] API 키   [u] Base URL   [Enter] 점검");
    } else if (config.defaultBackend === "codex-cli") {
      lines.push("codex CLI는 터미널에서 'codex login'으로 먼저 로그인하세요.", "", "[Enter] 점검");
    } else {
      lines.push("dry-run은 별도 인증이 필요 없습니다.", "", "[Enter] 점검");
    }
  } else {
    const label = validation.state === "ok" ? "성공" : validation.state === "fail" ? "실패" : validation.state === "checking" ? "확인 중…" : "대기";
    lines.push(`점검 결과: ${label}`);
    if (validation.message) {
      lines.push(...validation.message.split("\n"));
    }
    lines.push("", "[t] 실제 1줄 테스트   [Enter] 완료(닫기)");
  }
  lines.push("", "[Esc] 취소");
  return box("설정 마법사", lines, width);
}
