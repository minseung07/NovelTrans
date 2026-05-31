import type { NovelTransConfig } from "../../domain/config.js";
import type { TranslatorAdapter } from "../../domain/translation.js";
import { loadOpenAICompatibleApiKey } from "../../config/credentialStore.js";
import { CodexCliAdapter } from "./codexCliAdapter.js";
import { DryRunAdapter } from "./dryRunAdapter.js";
import { OpenAICompatibleAdapter } from "./openAICompatibleAdapter.js";

type AdapterFactoryOptions = {
  failEpisodeIds?: string[];
  credentialConfigDir?: string;
};

export function createTranslatorAdapter(backend: string, config: NovelTransConfig, options: AdapterFactoryOptions = {}): TranslatorAdapter {
  if (backend === "dry-run") {
    return new DryRunAdapter({ failEpisodeIds: options.failEpisodeIds });
  }
  if (backend === "openai-compatible") {
    return new OpenAICompatibleAdapter({
      apiKey: process.env.OPENAI_API_KEY ?? loadOpenAICompatibleApiKey(options.credentialConfigDir),
      baseUrl: process.env.NOVELTRANS_API_BASE_URL ?? config.openAICompatible.baseUrl,
      model: config.openAICompatible.model || config.defaultModel,
      temperature: config.openAICompatible.temperature,
      reasoningEffort: config.openAICompatible.reasoningEffort,
      timeoutMs: config.openAICompatible.timeoutMs
    });
  }
  if (backend === "codex-cli") {
    return new CodexCliAdapter({
      command: config.codexCli.command,
      model: config.codexCli.model,
      timeoutMs: config.codexCli.timeoutMs,
      sandbox: config.codexCli.sandbox
    });
  }
  throw new Error(`알 수 없는 번역 백엔드입니다: ${backend}`);
}
