import type { Episode } from "../domain/episode.js";
import type { EpisodeState } from "../domain/project.js";
import type { TranslationResult } from "../domain/translation.js";
import { listEpisodes, readTranslation } from "../storage/projectStore.js";
import { projectPaths } from "../storage/projectPaths.js";
import { ProjectStateStore } from "../storage/stateStore.js";

export type ExportableTranslations = {
  episodes: Episode[];
  translations: Map<string, TranslationResult>;
  episodeStates: EpisodeState[];
  hasEpisodeStates: boolean;
};

export async function loadExportableTranslations(projectDir: string): Promise<ExportableTranslations> {
  const episodes = await listEpisodes(projectDir);
  const stateInfo = loadEpisodeStateInfo(projectDir);
  const translations = new Map<string, TranslationResult>();
  for (const episode of episodes) {
    if (!isExportableEpisode(stateInfo, episode.id)) {
      continue;
    }
    const result = await readTranslation(projectDir, episode);
    if (result) {
      translations.set(episode.id, result);
    }
  }
  return { episodes, translations, episodeStates: stateInfo.states, hasEpisodeStates: stateInfo.hasStates };
}

export async function countExportableTranslatedEpisodes(projectDir: string): Promise<number> {
  return (await loadExportableTranslations(projectDir)).translations.size;
}

type EpisodeStateInfo = {
  hasStates: boolean;
  states: EpisodeState[];
  stateById: Map<string, EpisodeState>;
};

function loadEpisodeStateInfo(projectDir: string): EpisodeStateInfo {
  const stateStore = new ProjectStateStore(projectPaths(projectDir).projectDb);
  try {
    const states = stateStore.listEpisodeStates();
    return {
      hasStates: states.length > 0,
      states,
      stateById: new Map(states.map((state) => [state.episodeId, state]))
    };
  } finally {
    stateStore.close();
  }
}

function isExportableEpisode(stateInfo: EpisodeStateInfo, episodeId: string): boolean {
  if (!stateInfo.hasStates) {
    return true;
  }
  return stateInfo.stateById.get(episodeId)?.status === "completed";
}
