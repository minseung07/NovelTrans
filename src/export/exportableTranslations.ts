import type { Episode } from "../domain/episode.js";
import type { EpisodeState } from "../domain/project.js";
import type { TranslationResult } from "../domain/translation.js";
import { listEpisodes, readTranslation } from "../storage/projectStore.js";
import { projectPaths } from "../storage/projectPaths.js";
import { ProjectStateStore } from "../storage/stateStore.js";

export type ExportableTranslations = {
  episodes: Episode[];
  translations: Map<string, TranslationResult>;
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
  return { episodes, translations };
}

export async function countExportableTranslatedEpisodes(projectDir: string): Promise<number> {
  return (await loadExportableTranslations(projectDir)).translations.size;
}

function loadEpisodeStateInfo(projectDir: string): { hasStates: boolean; states: Map<string, EpisodeState> } {
  const stateStore = new ProjectStateStore(projectPaths(projectDir).projectDb);
  try {
    const states = new Map(stateStore.listEpisodeStates().map((state) => [state.episodeId, state]));
    return { hasStates: states.size > 0, states };
  } finally {
    stateStore.close();
  }
}

function isExportableEpisode(stateInfo: { hasStates: boolean; states: Map<string, EpisodeState> }, episodeId: string): boolean {
  if (!stateInfo.hasStates) {
    return true;
  }
  return stateInfo.states.get(episodeId)?.status === "completed";
}
