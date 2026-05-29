import { adjustConcurrency, cycleCodexCliModel, cycleDefaultBackend, cycleGlossaryStrictness, cycleOpenAICompatibleModel, saveRecipePreset, toggleDefaultOutputFormat } from "../actions/settingsActions.js";
export async function handleSettingsKey(input) {
    const mode = input.mode ?? "basic";
    const preset = Number(input.key);
    if (mode === "basic" && preset >= 1 && preset <= 6) {
        const config = await saveRecipePreset(input.config, preset, input.configDir);
        return { config, message: `레시피 ${preset}번을 적용했습니다.` };
    }
    if (mode === "basic") {
        return { config: input.config, message: null };
    }
    if (input.key.toLowerCase() === "m") {
        const config = await cycleDefaultBackend(input.config, input.configDir);
        return { config, message: `기본 번역 엔진: ${config.defaultBackend}.` };
    }
    if (input.key.toLowerCase() === "o") {
        const config = await cycleOpenAICompatibleModel(input.config, input.configDir);
        return { config, message: `OpenAI 호환 모델: ${config.openAICompatible.model}.` };
    }
    if (input.key.toLowerCase() === "c") {
        const config = await cycleCodexCliModel(input.config, input.configDir);
        return { config, message: `Codex 모델: ${config.codexCli.model ?? "기본값"}.` };
    }
    if (input.key === "+") {
        const config = await adjustConcurrency(input.config, 1, input.configDir);
        return { config, message: `동시 작업 수: ${config.concurrency}.` };
    }
    if (input.key === "-") {
        const config = await adjustConcurrency(input.config, -1, input.configDir);
        return { config, message: `동시 작업 수: ${config.concurrency}.` };
    }
    if (input.key.toLowerCase() === "g") {
        const config = await cycleGlossaryStrictness(input.config, input.configDir);
        return { config, message: `용어 엄격도: ${config.glossaryStrictness}.` };
    }
    if (input.key.toLowerCase() === "t") {
        const config = await toggleDefaultOutputFormat(input.config, "txt", input.configDir);
        return { config, message: `기본 결과물: ${config.outputFormats.join(", ")}.` };
    }
    if (input.key.toLowerCase() === "e") {
        const config = await toggleDefaultOutputFormat(input.config, "epub", input.configDir);
        return { config, message: `기본 결과물: ${config.outputFormats.join(", ")}.` };
    }
    return { config: input.config, message: null };
}
