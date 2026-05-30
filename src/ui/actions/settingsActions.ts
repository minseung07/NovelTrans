import type { NovelTransConfig } from "../../domain/config.js";
import { saveConfig } from "../../config/configStore.js";
import { codexCliModelPresets, openAICompatibleModelPresets } from "../../config/modelPresets.js";

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

async function cycleOpenAICompatibleModel(config: NovelTransConfig, configDir?: string): Promise<NovelTransConfig> {
  const model = nextPreset(openAICompatibleModelPresets, config.openAICompatible.model);
  return setOpenAICompatibleModel(config, model, configDir);
}

export async function cycleActiveBackendModel(config: NovelTransConfig, configDir?: string): Promise<NovelTransConfig> {
  if (config.defaultBackend === "codex-cli") {
    return cycleCodexCliModel(config, configDir);
  }
  return cycleOpenAICompatibleModel(config, configDir);
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

async function cycleCodexCliModel(config: NovelTransConfig, configDir?: string): Promise<NovelTransConfig> {
  const model = nextPreset(codexCliModelPresets, config.codexCli.model);
  return setCodexCliModel(config, model, configDir);
}

export async function setCodexCliModel(config: NovelTransConfig, model: string, configDir?: string): Promise<NovelTransConfig> {
  const normalized = normalizeModelInput(model);
  const next = {
    ...config,
    defaultModel: normalized,
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
