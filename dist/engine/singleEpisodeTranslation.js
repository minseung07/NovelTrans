import { loadGlossary, loadProjectMetadata, listEpisodes, readAllQAIssues, saveGlossary, saveProjectMetadata, saveQAIssues, saveTranslation, writeQualityReport } from "../storage/projectStore.js";
import { projectPaths } from "../storage/projectPaths.js";
import { ProjectStateStore } from "../storage/stateStore.js";
import { writeProjectLog } from "../storage/logger.js";
import { runQA } from "../qa/qaEngine.js";
import { mergeTranslationGlossaryCandidates } from "../glossary/glossaryEngine.js";
import { newId } from "../utils/hash.js";
import { nowIso } from "../utils/time.js";
import { translateEpisodeParts } from "./episodeTranslation.js";
export async function translateSingleEpisode(options) {
    const metadata = await loadProjectMetadata(options.projectDir);
    const episodes = await listEpisodes(options.projectDir);
    const episode = episodes.find((candidate) => candidate.id === options.episodeId);
    if (!episode) {
        throw new Error(`Episode not found: ${options.episodeId}`);
    }
    const stateStore = new ProjectStateStore(projectPaths(options.projectDir).projectDb);
    const run = {
        id: newId("run"),
        projectId: metadata.id,
        type: "retry",
        startedAt: nowIso(),
        status: "running",
        backend: options.adapter.id,
        model: metadata.options.model,
        episodeCount: 1
    };
    try {
        stateStore.createRun(run);
        const status = await options.adapter.checkAvailability();
        if (!status.available) {
            throw new Error(status.message);
        }
        options.signal?.throwIfAborted();
        metadata.status = "translating";
        metadata.updatedAt = nowIso();
        await saveProjectMetadata(metadata);
        stateStore.markEpisodeRunning(episode.id);
        await logEpisode(metadata, "translation", "episode_retranslate_started", `${episode.title} retranslation started: ${options.reason}.`, episode.id);
        let glossary = await loadGlossary(options.projectDir);
        const result = await translateEpisodeParts({
            adapter: options.adapter,
            episode,
            glossary,
            glossaryStrictness: metadata.options.glossaryStrictness,
            translationStyle: metadata.options.translationStyle,
            model: metadata.options.model,
            signal: options.signal
        });
        const nextGlossary = mergeTranslationGlossaryCandidates(glossary, result.newGlossaryCandidates, episode.id);
        if (nextGlossary !== glossary) {
            glossary = nextGlossary;
            await saveGlossary(options.projectDir, glossary);
        }
        const issues = runQA(episode, result, glossary, options.qaOptions ?? metadata.options.qa);
        result.qaIssueIds = issues.map((issue) => issue.id);
        await saveTranslation(options.projectDir, episode, result);
        await saveQAIssues(options.projectDir, episode, issues);
        await writeQualityReport(options.projectDir, await readAllQAIssues(options.projectDir));
        stateStore.setEpisodeStatus(episode.id, "completed");
        await logEpisode(metadata, "qa", "episode_checked", `${episode.title} QA completed with ${issues.length} issue(s).`, episode.id, { issueCount: issues.length });
        await logEpisode(metadata, "translation", "episode_retranslate_completed", `${episode.title} retranslation completed.`, episode.id, {
            qaIssueCount: issues.length,
            backend: result.backend,
            model: result.model
        });
        await finishMetadata(metadata, stateStore);
        stateStore.finishRun(run.id, "completed");
        return { episodeId: episode.id, completed: 1, failed: 0, cancelled: 0, qaIssues: issues.length };
    }
    catch (error) {
        if (isAbortError(error) || options.signal?.aborted) {
            stateStore.setEpisodeStatus(episode.id, "pending");
            await finishMetadata(metadata, stateStore);
            stateStore.finishRun(run.id, "cancelled", "Review retranslation cancelled.");
            await logEpisode(metadata, "translation", "episode_retranslate_cancelled", `${episode.title} retranslation cancelled.`, episode.id);
            return { episodeId: episode.id, completed: 0, failed: 0, cancelled: 1, qaIssues: 0 };
        }
        stateStore.setEpisodeStatus(episode.id, "failed", error.message);
        await finishMetadata(metadata, stateStore);
        stateStore.finishRun(run.id, "failed", error.message);
        await logEpisode(metadata, "error", "episode_retranslate_failed", error.message, episode.id);
        return { episodeId: episode.id, completed: 0, failed: 1, cancelled: 0, qaIssues: 0 };
    }
    finally {
        stateStore.close();
    }
}
function isAbortError(error) {
    return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError" || /cancelled|aborted/i.test(error.message));
}
async function finishMetadata(metadata, stateStore) {
    const states = stateStore.listEpisodeStates();
    metadata.status = states.some((state) => state.status === "failed")
        ? "completed_with_issues"
        : states.every((state) => state.status === "completed" || state.status === "skipped")
            ? "completed"
            : "ready";
    metadata.updatedAt = nowIso();
    await saveProjectMetadata(metadata);
}
async function logEpisode(metadata, category, event, message, episodeId, logMetadata) {
    await writeProjectLog({
        projectDir: metadata.projectDir,
        category,
        level: category === "error" ? "error" : "info",
        event,
        message,
        projectId: metadata.id,
        episodeId,
        metadata: logMetadata
    });
}
