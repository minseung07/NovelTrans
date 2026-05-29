import type { NovelTransConfig } from "../domain/config.js";
import { recommendedOpenAICompatibleModel } from "./modelPresets.js";

export const defaultConfig: NovelTransConfig = {
  projectRoot: "projects",
  defaultBackend: "dry-run",
  defaultModel: recommendedOpenAICompatibleModel,
  translationStyle: "balanced-webnovel",
  concurrency: 2,
  outputFormats: ["txt", "epub"],
  glossaryStrictness: "high",
  qa: {
    japaneseRemaining: true,
    numberMismatch: true,
    lengthRatio: true,
    glossary: true
  },
  epub: {
    includeGlossaryAppendix: true,
    includeAfterword: true,
    verticalWriting: false
  },
  openAICompatible: {
    baseUrl: "https://api.openai.com/v1",
    model: recommendedOpenAICompatibleModel,
    temperature: 0.2,
    reasoningEffort: "medium",
    timeoutMs: 120000
  },
  codexCli: {
    command: "codex",
    model: recommendedOpenAICompatibleModel,
    timeoutMs: 300000,
    sandbox: "read-only"
  },
  logLevel: "info"
};
