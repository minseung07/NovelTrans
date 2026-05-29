import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { NovelTransConfig } from "../domain/config.js";
import { ensureDir, pathExists, readJson, writeJson } from "../storage/jsonFile.js";
import { defaultConfig } from "./defaultConfig.js";
import { recommendedOpenAICompatibleModel } from "./modelPresets.js";

export function getDefaultConfigDir(): string {
  return process.env.NOVELTRANS_CONFIG_DIR ?? join(homedir(), ".config", "noveltrans");
}

export function getConfigPath(configDir = getDefaultConfigDir()): string {
  return join(configDir, "config.json");
}

export async function loadConfig(configDir = getDefaultConfigDir()): Promise<NovelTransConfig> {
  const path = getConfigPath(configDir);
  if (!(await pathExists(path))) {
    return normalizeConfig(defaultConfig);
  }
  const loaded = await readJson<unknown>(path);
  return normalizeConfig(deepMerge(defaultConfig, isRecord(loaded) ? loaded : {}));
}

export async function saveConfig(config: NovelTransConfig, configDir = getDefaultConfigDir()): Promise<void> {
  await ensureDir(configDir);
  await writeJson(getConfigPath(configDir), normalizeConfig(config));
}

export async function initConfig(configDir = getDefaultConfigDir()): Promise<NovelTransConfig> {
  const config = await loadConfig(configDir);
  await saveConfig(config, configDir);
  return config;
}

export function resolveProjectRoot(config: NovelTransConfig, workspace?: string): string {
  const root = workspace ?? config.projectRoot;
  return isAbsolute(root) ? root : resolve(root);
}

function normalizeConfig(config: unknown): NovelTransConfig {
  const input = isRecord(config) ? config : {};
  const qa = isRecord(input.qa) ? input.qa : {};
  const epub = isRecord(input.epub) ? input.epub : {};
  const openAICompatible = isRecord(input.openAICompatible) ? input.openAICompatible : {};
  const codexCli = isRecord(input.codexCli) ? input.codexCli : {};
  const defaultModel = normalizeDefaultModel(stringValue(input.defaultModel));
  const openAICompatibleModel = normalizeDefaultModel(stringValue(openAICompatible.model) || defaultModel);
  return {
    projectRoot: stringValue(input.projectRoot) ?? defaultConfig.projectRoot,
    defaultBackend: normalizeBackend(input.defaultBackend),
    defaultModel,
    translationStyle: normalizeTranslationStyle(input.translationStyle),
    concurrency: normalizePositiveNumber(input.concurrency, defaultConfig.concurrency),
    outputFormats: normalizeOutputFormats(input.outputFormats),
    glossaryStrictness: normalizeGlossaryStrictness(input.glossaryStrictness),
    qa: {
      japaneseRemaining: normalizeBoolean(qa.japaneseRemaining, defaultConfig.qa.japaneseRemaining),
      numberMismatch: normalizeBoolean(qa.numberMismatch, defaultConfig.qa.numberMismatch),
      lengthRatio: normalizeBoolean(qa.lengthRatio, defaultConfig.qa.lengthRatio),
      glossary: normalizeBoolean(qa.glossary, defaultConfig.qa.glossary)
    },
    epub: {
      includeGlossaryAppendix: normalizeBoolean(epub.includeGlossaryAppendix, defaultConfig.epub.includeGlossaryAppendix),
      includeAfterword: normalizeBoolean(epub.includeAfterword, defaultConfig.epub.includeAfterword),
      verticalWriting: normalizeBoolean(epub.verticalWriting, defaultConfig.epub.verticalWriting)
    },
    openAICompatible: {
      baseUrl: stringValue(openAICompatible.baseUrl) ?? defaultConfig.openAICompatible.baseUrl,
      model: openAICompatibleModel,
      temperature: normalizeNumber(openAICompatible.temperature, defaultConfig.openAICompatible.temperature, 0, 2),
      reasoningEffort: normalizeReasoningEffort(openAICompatible.reasoningEffort),
      timeoutMs: Math.max(1000, normalizePositiveNumber(openAICompatible.timeoutMs, defaultConfig.openAICompatible.timeoutMs))
    },
    codexCli: {
      command: stringValue(codexCli.command) ?? "codex",
      model: stringValue(codexCli.model) ?? recommendedOpenAICompatibleModel,
      timeoutMs: Math.max(1000, normalizePositiveNumber(codexCli.timeoutMs, defaultConfig.codexCli.timeoutMs)),
      sandbox: codexCli.sandbox === "workspace-write" ? "workspace-write" : "read-only"
    },
    logLevel: normalizeLogLevel(input.logLevel)
  };
}

function normalizeDefaultModel(model: string | undefined): string {
  if (!model) {
    return recommendedOpenAICompatibleModel;
  }
  return model;
}

function normalizeTranslationStyle(style: unknown): NovelTransConfig["translationStyle"] {
  if (
    style === "fast-draft" ||
    style === "balanced-webnovel" ||
    style === "literary-naturalization" ||
    style === "literal-preserve" ||
    style === "terminology-consistency" ||
    style === "custom"
  ) {
    return style;
  }
  return defaultConfig.translationStyle;
}

function normalizeReasoningEffort(effort: unknown): NovelTransConfig["openAICompatible"]["reasoningEffort"] {
  if (effort === "low" || effort === "medium" || effort === "high" || effort === "xhigh") {
    return effort;
  }
  return "medium";
}

function normalizeBackend(value: unknown): NovelTransConfig["defaultBackend"] {
  if (value === "dry-run" || value === "openai-compatible" || value === "codex-cli") {
    return value;
  }
  return defaultConfig.defaultBackend;
}

function normalizeGlossaryStrictness(value: unknown): NovelTransConfig["glossaryStrictness"] {
  if (value === "low" || value === "medium" || value === "high" || value === "strict") {
    return value;
  }
  return defaultConfig.glossaryStrictness;
}

function normalizeLogLevel(value: unknown): NovelTransConfig["logLevel"] {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }
  return defaultConfig.logLevel;
}

function normalizeOutputFormats(value: unknown): NovelTransConfig["outputFormats"] {
  const values = Array.isArray(value) ? value : defaultConfig.outputFormats;
  const formats = values.filter((item): item is "txt" | "epub" => item === "txt" || item === "epub");
  return Array.from(new Set(formats.length > 0 ? formats : defaultConfig.outputFormats));
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return fallback;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...(isRecord(base) ? base : {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (isRecord(value) && isRecord(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}
