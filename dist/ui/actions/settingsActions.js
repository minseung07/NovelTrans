import { saveConfig } from "../../config/configStore.js";
import { codexCliModelPresets, openAICompatibleModelPresets } from "../../config/modelPresets.js";
export function applyRecipePreset(config, preset) {
    if (preset === 1) {
        return { ...config, translationStyle: "fast-draft", concurrency: 4, glossaryStrictness: "medium" };
    }
    if (preset === 2) {
        return { ...config, translationStyle: "balanced-webnovel", concurrency: 4, glossaryStrictness: "high" };
    }
    if (preset === 3) {
        return {
            ...config,
            translationStyle: "literary-naturalization",
            concurrency: 2,
            glossaryStrictness: "medium",
            openAICompatible: { ...config.openAICompatible, temperature: 0.4 }
        };
    }
    if (preset === 4) {
        return {
            ...config,
            translationStyle: "literal-preserve",
            concurrency: 2,
            glossaryStrictness: "high",
            openAICompatible: { ...config.openAICompatible, temperature: 0.1 }
        };
    }
    if (preset === 5) {
        return { ...config, translationStyle: "terminology-consistency", concurrency: 2, glossaryStrictness: "strict" };
    }
    return { ...config, translationStyle: "custom" };
}
export async function saveRecipePreset(config, preset, configDir) {
    const next = applyRecipePreset(config, preset);
    await saveConfig(next, configDir);
    return next;
}
export async function cycleDefaultBackend(config, configDir) {
    const backends = ["dry-run", "openai-compatible", "codex-cli"];
    const currentIndex = backends.indexOf(config.defaultBackend);
    const next = { ...config, defaultBackend: backends[(currentIndex + 1) % backends.length] ?? "dry-run" };
    await saveConfig(next, configDir);
    return next;
}
export async function adjustConcurrency(config, delta, configDir) {
    const next = { ...config, concurrency: Math.max(1, Math.min(16, config.concurrency + delta)) };
    await saveConfig(next, configDir);
    return next;
}
export async function cycleGlossaryStrictness(config, configDir) {
    const levels = ["low", "medium", "high", "strict"];
    const currentIndex = levels.indexOf(config.glossaryStrictness);
    const next = { ...config, glossaryStrictness: levels[(currentIndex + 1) % levels.length] ?? "high" };
    await saveConfig(next, configDir);
    return next;
}
export async function toggleDefaultOutputFormat(config, format, configDir) {
    const hasFormat = config.outputFormats.includes(format);
    const formats = hasFormat ? config.outputFormats.filter((item) => item !== format) : [...config.outputFormats, format];
    const next = { ...config, outputFormats: formats.length > 0 ? formats : [format] };
    await saveConfig(next, configDir);
    return next;
}
export async function cycleOpenAICompatibleModel(config, configDir) {
    const model = nextPreset(openAICompatibleModelPresets, config.openAICompatible.model);
    return setOpenAICompatibleModel(config, model, configDir);
}
export async function setOpenAICompatibleModel(config, model, configDir) {
    const normalized = normalizeModelInput(model);
    const next = {
        ...config,
        defaultModel: normalized,
        openAICompatible: {
            ...config.openAICompatible,
            model: normalized
        }
    };
    await saveConfig(next, configDir);
    return next;
}
export async function cycleCodexCliModel(config, configDir) {
    const model = nextPreset(codexCliModelPresets, config.codexCli.model);
    return setCodexCliModel(config, model, configDir);
}
export async function setCodexCliModel(config, model, configDir) {
    const normalized = normalizeModelInput(model);
    const next = {
        ...config,
        codexCli: {
            ...config.codexCli,
            model: normalized
        }
    };
    await saveConfig(next, configDir);
    return next;
}
function nextPreset(presets, current) {
    const currentIndex = current ? presets.indexOf(current) : -1;
    return presets[(currentIndex + 1) % presets.length] ?? presets[0] ?? "gpt-5.5";
}
function normalizeModelInput(model) {
    const normalized = model.trim();
    if (!normalized) {
        throw new Error("모델 이름이 비어 있습니다.");
    }
    return normalized;
}
