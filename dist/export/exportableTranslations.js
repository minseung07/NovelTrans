import { listEpisodes, readTranslation } from "../storage/projectStore.js";
import { projectPaths } from "../storage/projectPaths.js";
import { ProjectStateStore } from "../storage/stateStore.js";
export async function loadExportableTranslations(projectDir) {
    const episodes = await listEpisodes(projectDir);
    const stateInfo = loadEpisodeStateInfo(projectDir);
    const translations = new Map();
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
export async function countExportableTranslatedEpisodes(projectDir) {
    return (await loadExportableTranslations(projectDir)).translations.size;
}
function loadEpisodeStateInfo(projectDir) {
    const stateStore = new ProjectStateStore(projectPaths(projectDir).projectDb);
    try {
        const states = stateStore.listEpisodeStates();
        return {
            hasStates: states.length > 0,
            states,
            stateById: new Map(states.map((state) => [state.episodeId, state]))
        };
    }
    finally {
        stateStore.close();
    }
}
function isExportableEpisode(stateInfo, episodeId) {
    if (!stateInfo.hasStates) {
        return true;
    }
    return stateInfo.stateById.get(episodeId)?.status === "completed";
}
