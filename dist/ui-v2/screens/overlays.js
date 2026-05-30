// Global overlays: Help (keymap-derived), Settings (config summary + editing
// keys), and the Command Palette (fuzzy-filtered command list).
import { box } from "../components/box.js";
import { selectionRow } from "../components/list.js";
import { severityBadge } from "../components/badge.js";
import { clamp } from "../components/geometry.js";
import { keyBindings } from "../state/keymap.js";
import { filterPaletteCommands } from "../data/palette.js";
const STAGE_LEGEND = [
    "이동: ↑↓ / j k     선택: Enter     뒤로: Esc / b",
    "단계 이동: 1~6",
    "Glossary: c확정 l고정 f금칙 e편집 d폐기 a필터",
    "QA: i무시 r재검사 t재번역 g용어",
    "Translate: t이어가기 y실패재시도 p일시정지 s건너뛰고내보내기",
    "Export: t/e/p/v/a 토글  g 생성",
    "Source: ↑↓ 화 선택  i원문 다시 가져오기",
    "Settings: b엔진 m모델 g엄격도 +/-동시성 t/e출력"
];
export function renderHelp(width) {
    const hints = Array.from(new Set(keyBindings.map((binding) => binding.hint).filter((hint) => Boolean(hint))));
    return box("도움말", [...hints, "", ...STAGE_LEGEND, "", "[Esc] 닫기"], width);
}
export function renderSettings(config, width) {
    return box("설정", [
        `백엔드: ${config.defaultBackend}`,
        `모델: ${config.defaultModel}`,
        `동시성: ${config.concurrency}`,
        `번역 스타일: ${config.translationStyle}`,
        `용어 엄격도: ${config.glossaryStrictness}`,
        `출력: ${config.outputFormats.join("+").toUpperCase()}`,
        "API 키: 환경 변수 또는 auth 명령으로 설정",
        "",
        "[b]엔진 [m]모델 [g]엄격도 [+/-]동시성 [t]TXT [e]EPUB [Esc]닫기"
    ], width);
}
export function renderPalette(query, selected, hasProject, width) {
    const commands = filterPaletteCommands(query, hasProject);
    const lines = [`> ${query}`, ""];
    if (commands.length === 0) {
        lines.push("일치하는 명령이 없습니다.");
    }
    else {
        const active = clamp(selected, 0, commands.length - 1);
        commands.forEach((command, index) => {
            const tag = command.requiresConfirmation ? `  ${severityBadge("warning", "확인")}` : "";
            lines.push(selectionRow(`${command.label}${tag}`, index === active));
        });
    }
    return box("명령 팔레트", lines, width);
}
