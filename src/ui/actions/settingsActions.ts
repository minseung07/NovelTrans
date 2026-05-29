import type { NovelTransConfig } from "../../domain/config.js";
import { saveConfig } from "../../config/configStore.js";
import { codexCliModelPresets, openAICompatibleModelPresets } from "../../config/modelPresets.js";

export type RecipePresetId = 1 | 2 | 3 | 4 | 5 | 6;

export function applyRecipePreset(config: NovelTransConfig, preset: RecipePresetId): NovelTransConfig {
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

export async function saveRecipePreset(config: NovelTransConfig, preset: RecipePresetId, configDir?: string): Promise<NovelTransConfig> {
  const next = applyRecipePreset(config, preset);
  await saveConfig(next, configDir);
  return next;
}

export async function cycleDefaultBackend(config: NovelTransConfig, configDir?: string): Promise<NovelTransConfig> {
  const backends: NovelTransConfig["defaultBackend"][] = ["dry-run", "openai-compatible", "codex-cli"];
  const currentIndex = backends.indexOf(config.defaultBackend);
  const next = { ...config, defaultBackend: backends[(currentIndex + 1) % backends.length] ?? "dry-run" };
  await saveConfig(next, configDir);
  return next;
}

export async function adjustConcurrency(config: NovelTransConfig, delta: number, configDir?: string): Promise<NovelTransConfig> {
  const next = { ...config, concurrency: Math.max(1, Math.min(16, config.concurrency + delta)) };
  await saveConfig(next, configDir);
  return next;
}

export async function cycleGlossaryStrictness(config: NovelTransConfig, configDir?: string): Promise<NovelTransConfig> {
  const levels: NovelTransConfig["glossaryStrictness"][] = ["low", "medium", "high", "strict"];
  const currentIndex = levels.indexOf(config.glossaryStrictness);
  const next = { ...config, glossaryStrictness: levels[(currentIndex + 1) % levels.length] ?? "high" };
  await saveConfig(next, configDir);
  return next;
}

export async function toggleDefaultOutputFormat(config: NovelTransConfig, format: "txt" | "epub", configDir?: string): Promise<NovelTransConfig> {
  const hasFormat = config.outputFormats.includes(format);
  const formats = hasFormat ? config.outputFormats.filter((item) => item !== format) : [...config.outputFormats, format];
  const next = { ...config, outputFormats: formats.length > 0 ? formats : [format] };
  await saveConfig(next, configDir);
  return next;
}

export async function cycleOpenAICompatibleModel(config: NovelTransConfig, configDir?: string): Promise<NovelTransConfig> {
  const model = nextPreset(openAICompatibleModelPresets, config.openAICompatible.model);
  return setOpenAICompatibleModel(config, model, configDir);
}

export async function setOpenAICompatibleModel(config: NovelTransConfig, model: string, configDir?: string): Promise<NovelTransConfig> {
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

export async function cycleCodexCliModel(config: NovelTransConfig, configDir?: string): Promise<NovelTransConfig> {
  const model = nextPreset(codexCliModelPresets, config.codexCli.model);
  return setCodexCliModel(config, model, configDir);
}

export async function setCodexCliModel(config: NovelTransConfig, model: string, configDir?: string): Promise<NovelTransConfig> {
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

function nextPreset(presets: readonly string[], current: string | undefined): string {
  const currentIndex = current ? presets.indexOf(current) : -1;
  return presets[(currentIndex + 1) % presets.length] ?? presets[0] ?? "gpt-5.5";
}

function normalizeModelInput(model: string): string {
  const normalized = model.trim();
  if (!normalized) {
    throw new Error("모델 이름이 비어 있습니다.");
  }
  return normalized;
}
