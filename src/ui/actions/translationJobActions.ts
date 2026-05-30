import type { NovelTransConfig } from "../../domain/config.js";
import { TranslationSession } from "../../engine/translationSession.js";
import type { TranslationMode } from "../../engine/translationOrchestrator.js";
import { loadProjectMetadata, saveProjectMetadata } from "../../storage/projectStore.js";
import { createTranslatorAdapter } from "../../translation/adapters/adapterFactory.js";
import { nowIso } from "../../utils/time.js";

type TranslationJobRuntime = {
  config: NovelTransConfig;
  configDir?: string;
};

export async function createProjectAdapter(projectDir: string, runtime: TranslationJobRuntime) {
  const metadata = await loadRuntimeProjectMetadata(projectDir, runtime);
  const backend = metadata.options.backend ?? runtime.config.defaultBackend;
  return createTranslatorAdapter(backend, runtime.config, { credentialConfigDir: runtime.configDir });
}

export async function createProjectTranslationSession(projectDir: string, mode: TranslationMode, runtime: TranslationJobRuntime): Promise<TranslationSession> {
  return TranslationSession.create({
    projectDir,
    adapter: await createProjectAdapter(projectDir, runtime),
    mode,
    qaOptions: runtime.config.qa
  });
}

async function loadRuntimeProjectMetadata(projectDir: string, runtime: TranslationJobRuntime) {
  const metadata = await loadProjectMetadata(projectDir);
  const backend = metadata.options.backend ?? runtime.config.defaultBackend;
  if (backend !== "codex-cli" || !metadata.options.model) {
    return metadata;
  }

  const genericOpenAIModels = new Set([runtime.config.defaultModel, runtime.config.openAICompatible.model].filter(Boolean));
  if (metadata.options.model === runtime.config.codexCli.model || !genericOpenAIModels.has(metadata.options.model)) {
    return metadata;
  }

  const next = {
    ...metadata,
    updatedAt: nowIso(),
    options: {
      ...metadata.options,
      model: undefined
    }
  };
  await saveProjectMetadata(next);
  return next;
}
