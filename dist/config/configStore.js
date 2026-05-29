import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { ensureDir, pathExists, readJson, writeJson } from "../storage/jsonFile.js";
import { defaultConfig } from "./defaultConfig.js";
import { recommendedOpenAICompatibleModel } from "./modelPresets.js";
export function getDefaultConfigDir() {
    return process.env.NOVELTRANS_CONFIG_DIR ?? join(homedir(), ".config", "noveltrans");
}
export function getConfigPath(configDir = getDefaultConfigDir()) {
    return join(configDir, "config.json");
}
export async function loadConfig(configDir = getDefaultConfigDir()) {
    const path = getConfigPath(configDir);
    if (!(await pathExists(path))) {
        return normalizeConfig(defaultConfig);
    }
    const loaded = await readJson(path);
    return normalizeConfig(deepMerge(defaultConfig, loaded));
}
export async function saveConfig(config, configDir = getDefaultConfigDir()) {
    await ensureDir(configDir);
    await writeJson(getConfigPath(configDir), normalizeConfig(config));
}
export async function initConfig(configDir = getDefaultConfigDir()) {
    const config = await loadConfig(configDir);
    await saveConfig(config, configDir);
    return config;
}
export function resolveProjectRoot(config, workspace) {
    const root = workspace ?? config.projectRoot;
    return isAbsolute(root) ? root : resolve(root);
}
function normalizeConfig(config) {
    const defaultModel = normalizeDefaultModel(config.defaultModel);
    const openAICompatibleModel = normalizeDefaultModel(config.openAICompatible.model || defaultModel);
    return {
        ...config,
        defaultModel,
        translationStyle: normalizeTranslationStyle(config.translationStyle),
        concurrency: Math.max(1, Number(config.concurrency) || 1),
        outputFormats: config.outputFormats.length > 0 ? config.outputFormats : ["txt"],
        openAICompatible: {
            ...config.openAICompatible,
            model: openAICompatibleModel,
            reasoningEffort: normalizeReasoningEffort(config.openAICompatible.reasoningEffort),
            timeoutMs: Math.max(1000, Number(config.openAICompatible.timeoutMs) || 120000)
        },
        codexCli: {
            ...config.codexCli,
            command: config.codexCli.command || "codex",
            model: config.codexCli.model || recommendedOpenAICompatibleModel,
            timeoutMs: Math.max(1000, Number(config.codexCli.timeoutMs) || 300000),
            sandbox: config.codexCli.sandbox === "workspace-write" ? "workspace-write" : "read-only"
        }
    };
}
function normalizeDefaultModel(model) {
    if (!model) {
        return recommendedOpenAICompatibleModel;
    }
    return model;
}
function normalizeTranslationStyle(style) {
    if (style === "fast-draft" ||
        style === "balanced-webnovel" ||
        style === "literary-naturalization" ||
        style === "literal-preserve" ||
        style === "terminology-consistency" ||
        style === "custom") {
        return style;
    }
    return defaultConfig.translationStyle;
}
function normalizeReasoningEffort(effort) {
    if (effort === "low" || effort === "medium" || effort === "high" || effort === "xhigh") {
        return effort;
    }
    return "medium";
}
function deepMerge(base, patch) {
    const result = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        if (value && typeof value === "object" && !Array.isArray(value) && result[key] && typeof result[key] === "object" && !Array.isArray(result[key])) {
            result[key] = deepMerge(result[key], value);
        }
        else if (value !== undefined) {
            result[key] = value;
        }
    }
    return result;
}
