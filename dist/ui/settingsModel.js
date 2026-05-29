import { translationStyleLabel } from "./recipeStyle.js";
import { recipeSummary } from "./studioData.js";
import { codexCliModelPresets, openAICompatibleModelPresets } from "../config/modelPresets.js";
const presets = [
    { id: 1, label: "빠른 초벌", description: "구조 점검과 초안 확인에 맞춤" },
    { id: 2, label: "균형 번역", description: "대부분의 웹소설에 권장" },
    { id: 3, label: "문학적 자연화", description: "문장 흐름과 독서감을 우선" },
    { id: 4, label: "직역 보존", description: "원문 표현과 고유한 어감을 보존" },
    { id: 5, label: "용어 일관성", description: "이름과 설정 용어 흔들림을 최소화" },
    { id: 6, label: "커스텀", description: "현재 수동 조정을 유지" }
];
export function settingsTitle(mode) {
    return mode === "advanced" ? "세부 설정" : "번역 설정";
}
export function settingsSubtitle(mode) {
    return mode === "advanced" ? "새 작품 기본값 · 직접 조정" : "새 작품 기본값";
}
export function settingsFooter(mode) {
    if (mode === "advanced") {
        return "[←/→] 섹션   [↑/↓] 항목   [Enter] 설정   [A] 기본   [B] 뒤로";
    }
    return "[1-6] 레시피 선택   [A] 고급 설정   [B] 뒤로";
}
export function settingsPickerFooter(item) {
    if (item.kind === "number") {
        return "[↑/↓] 값 선택   [Enter] 적용   [Esc] 닫기";
    }
    return "[↑/↓] 선택   [Enter] 적용   [Esc] 닫기";
}
export function buildSettingsSections(config, mode, connectionState) {
    if (mode === "advanced") {
        return buildAdvancedSettingsSections(config, connectionState);
    }
    return buildBasicSettingsSections(config);
}
function buildBasicSettingsSections(config) {
    return [
        {
            title: "현재 레시피",
            lines: [
                recipeSummary(config),
                `톤          ${translationStyleLabel(config.translationStyle)}`,
                `엔진        ${backendLabel(config.defaultBackend)}`,
                `모델        ${modelLabel(config)}`,
                `처리        ${config.concurrency}개 화 동시 · 용어 ${strictnessLabel(config.glossaryStrictness)} · ${outputLabel(config.outputFormats)}`
            ]
        },
        {
            title: "빠른 선택",
            lines: presets.map((preset) => `${preset.id}. ${preset.label} - ${preset.description}`)
        }
    ];
}
function buildAdvancedSettingsSections(config, connectionState) {
    return buildAdvancedSettingsForm(config, connectionState).map((section) => ({
        title: section.title,
        lines: section.items.map((item) => `${item.label}  ${item.value}`)
    }));
}
export function buildAdvancedSettingsForm(config, connectionState) {
    return [
        {
            id: "engine",
            title: "엔진",
            items: [
                {
                    id: "default-backend",
                    label: "기본 엔진",
                    value: backendLabel(config.defaultBackend),
                    rawValue: config.defaultBackend,
                    kind: "enum",
                    options: [
                        { label: "Dry-run 테스트", value: "dry-run" },
                        { label: "OpenAI 호환", value: "openai-compatible" },
                        { label: "Codex CLI", value: "codex-cli" }
                    ]
                },
                {
                    id: "codex-command",
                    label: "Codex CLI 실행",
                    value: config.codexCli.command,
                    rawValue: config.codexCli.command,
                    kind: "enum",
                    options: [
                        { label: "codex (PATH에서 실행)", value: "codex" },
                        { label: "직접 입력...", value: "__custom__", custom: true }
                    ]
                }
            ]
        },
        {
            id: "model-auth",
            title: "모델/인증",
            items: [
                { id: "api-key", label: "API 키", value: apiKeyLabel(connectionState?.openAICompatibleApiKey ?? "unknown"), kind: "secret" },
                {
                    id: "openai-model",
                    label: "OpenAI 모델",
                    value: config.openAICompatible.model,
                    rawValue: config.openAICompatible.model,
                    kind: "enum",
                    options: [...openAICompatibleModelPresets.map((model) => ({ label: model, value: model })), { label: "직접 입력...", value: "__custom__", custom: true }]
                },
                {
                    id: "codex-model",
                    label: "Codex 모델",
                    value: config.codexCli.model ?? "Codex 기본값",
                    rawValue: config.codexCli.model,
                    kind: "enum",
                    options: [...codexCliModelPresets.map((model) => ({ label: model, value: model })), { label: "직접 입력...", value: "__custom__", custom: true }]
                },
                {
                    id: "openai-base-url",
                    label: "OpenAI URL",
                    value: config.openAICompatible.baseUrl,
                    rawValue: config.openAICompatible.baseUrl,
                    kind: "input"
                }
            ]
        },
        {
            id: "translation",
            title: "번역",
            items: [
                {
                    id: "concurrency",
                    label: "동시 작업",
                    value: `${config.concurrency}`,
                    rawValue: `${config.concurrency}`,
                    kind: "enum",
                    options: [1, 2, 4, 6, 8].map((value) => ({ label: `${value}`, value: `${value}` }))
                },
                {
                    id: "temperature",
                    label: "온도",
                    value: `${config.openAICompatible.temperature}`,
                    rawValue: `${config.openAICompatible.temperature}`,
                    kind: "input"
                },
                {
                    id: "reasoning-effort",
                    label: "Reasoning",
                    value: config.openAICompatible.reasoningEffort,
                    rawValue: config.openAICompatible.reasoningEffort,
                    kind: "enum",
                    options: [
                        { label: "low", value: "low" },
                        { label: "medium", value: "medium" },
                        { label: "high", value: "high" },
                        { label: "xhigh", value: "xhigh" }
                    ]
                }
            ]
        },
        {
            id: "quality",
            title: "품질",
            items: [
                {
                    id: "glossary-strictness",
                    label: "용어 기준",
                    value: strictnessLabel(config.glossaryStrictness),
                    rawValue: config.glossaryStrictness,
                    kind: "enum",
                    options: [
                        { label: "낮음", value: "low" },
                        { label: "보통", value: "medium" },
                        { label: "높음", value: "high" },
                        { label: "매우 엄격", value: "strict" }
                    ]
                },
                { id: "qa-japanese", label: "QA 일본어", value: enabledLabel(config.qa.japaneseRemaining), kind: "toggle" },
                { id: "qa-number", label: "QA 숫자", value: enabledLabel(config.qa.numberMismatch), kind: "toggle" },
                { id: "qa-length", label: "QA 길이", value: enabledLabel(config.qa.lengthRatio), kind: "toggle" },
                { id: "qa-glossary", label: "QA 용어", value: enabledLabel(config.qa.glossary), kind: "toggle" }
            ]
        },
        {
            id: "output",
            title: "출력",
            items: [
                { id: "output-txt", label: "TXT", value: enabledLabel(config.outputFormats.includes("txt")), kind: "toggle" },
                { id: "output-epub", label: "EPUB", value: enabledLabel(config.outputFormats.includes("epub")), kind: "toggle" },
                { id: "epub-afterword", label: "후기 포함", value: enabledLabel(config.epub.includeAfterword), kind: "toggle" },
                { id: "epub-vertical-writing", label: "세로쓰기", value: enabledLabel(config.epub.verticalWriting), kind: "toggle" },
                { id: "epub-glossary-appendix", label: "용어집 부록", value: enabledLabel(config.epub.includeGlossaryAppendix), kind: "toggle" }
            ]
        }
    ];
}
export function advancedSettingsOptions(item) {
    if (item.kind === "number") {
        return numberOptions(item);
    }
    return item.options ?? [];
}
export function selectedAdvancedSettingsOptionIndex(item) {
    const options = advancedSettingsOptions(item);
    const rawValue = item.rawValue ?? item.value;
    const index = options.findIndex((option) => option.value === rawValue);
    if (index >= 0) {
        return index;
    }
    if (item.kind === "number") {
        return nearestNumberOptionIndex(options, rawValue);
    }
    const customIndex = options.findIndex((option) => option.custom);
    return customIndex >= 0 ? customIndex : 0;
}
function numberOptions(item) {
    const min = item.min ?? 0;
    const max = item.max ?? min;
    const step = item.step ?? 1;
    const options = [];
    const decimals = decimalPlaces(step);
    for (let value = min; value <= max + step / 10; value += step) {
        const normalized = Number(value.toFixed(decimals));
        const label = decimals === 0 ? `${normalized}` : normalized.toFixed(decimals);
        options.push({ label, value: label });
    }
    return options;
}
function nearestNumberOptionIndex(options, rawValue) {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
        return 0;
    }
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [index, option] of options.entries()) {
        const candidate = Number(option.value);
        const distance = Math.abs(candidate - value);
        if (distance < bestDistance) {
            bestIndex = index;
            bestDistance = distance;
        }
    }
    return bestIndex;
}
function decimalPlaces(value) {
    const text = `${value}`;
    const decimal = text.split(".")[1];
    return decimal?.length ?? 0;
}
export function backendLabel(backend) {
    if (backend === "openai-compatible") {
        return "OpenAI 호환";
    }
    if (backend === "codex-cli") {
        return "Codex CLI";
    }
    return "Dry-run 테스트";
}
export function strictnessLabel(strictness) {
    if (strictness === "strict") {
        return "매우 엄격";
    }
    if (strictness === "high") {
        return "높음";
    }
    if (strictness === "medium") {
        return "보통";
    }
    return "낮음";
}
export function outputLabel(formats) {
    return formats.map((format) => format.toUpperCase()).join(", ");
}
function modelLabel(config) {
    if (config.defaultBackend === "openai-compatible") {
        return config.openAICompatible.model;
    }
    if (config.defaultBackend === "codex-cli") {
        return config.codexCli.model ?? "기본값";
    }
    return config.defaultModel;
}
function enabledLabel(enabled) {
    return enabled ? "켜짐" : "꺼짐";
}
function apiKeyLabel(state) {
    if (state === "environment") {
        return "환경 변수";
    }
    if (state === "stored") {
        return "저장됨";
    }
    if (state === "unreadable") {
        return "저장소 오류";
    }
    if (state === "unknown") {
        return "확인 전";
    }
    return "없음";
}
