import { extractGlossaryCandidates } from "../glossary/glossaryEngine.js";
import { runQA } from "../qa/qaEngine.js";
import { listEpisodes, loadGlossary, loadProjectMetadata, readAllQAIssues, saveGlossary, saveProjectMetadata, saveQAIssues, saveTranslation, writeQualityReport } from "../storage/projectStore.js";
import { projectPaths } from "../storage/projectPaths.js";
import { ProjectStateStore } from "../storage/stateStore.js";
import { writeProjectLog } from "../storage/logger.js";
import { newId } from "../utils/hash.js";
import { nowIso } from "../utils/time.js";
import { translateEpisodeParts } from "./episodeTranslation.js";
import { ProjectGlossaryUpdater } from "./glossaryUpdate.js";
export class TranslationSession {
    metadata;
    adapter;
    mode;
    qaOptions;
    status = "idle";
    queued = 0;
    completed = 0;
    failed = 0;
    skipped = 0;
    activeEpisodes = new Map();
    abortController = new AbortController();
    startedAt = null;
    startedAtMs = null;
    message = null;
    donePromise = null;
    constructor(metadata, adapter, mode, qaOptions) {
        this.metadata = metadata;
        this.adapter = adapter;
        this.mode = mode;
        this.qaOptions = qaOptions ?? metadata.options.qa;
    }
    static async create(options) {
        const metadata = await loadProjectMetadata(options.projectDir);
        return new TranslationSession(metadata, options.adapter, options.mode, options.qaOptions);
    }
    start() {
        if (this.donePromise) {
            return this.donePromise;
        }
        this.startedAtMs = Date.now();
        this.startedAt = new Date(this.startedAtMs).toISOString();
        this.status = "running";
        this.message = "번역 세션을 시작했습니다.";
        this.donePromise = this.run();
        return this.donePromise;
    }
    pause() {
        if (this.status === "running") {
            this.status = "paused";
            this.metadata.status = "paused";
            this.message = "현재 화가 끝나면 일시정지합니다.";
        }
    }
    resume() {
        if (this.status === "paused") {
            this.status = "running";
            this.metadata.status = "translating";
            this.message = "번역을 다시 시작했습니다.";
        }
    }
    cancel() {
        if (this.status === "running" || this.status === "paused") {
            this.status = "cancelled";
            this.abortController.abort();
            this.message = "번역 세션을 취소했습니다.";
        }
    }
    snapshot() {
        return {
            status: this.status,
            queued: this.queued,
            completed: this.completed,
            failed: this.failed,
            skipped: this.skipped,
            startedAt: this.startedAt,
            elapsedMs: this.elapsedMs(),
            estimatedRemainingMs: this.estimatedRemainingMs(),
            currentEpisodeTitle: this.firstActiveEpisodeTitle(),
            activeEpisodeNos: Array.from(this.activeEpisodes.values())
                .map((episode) => episode.episodeNo)
                .sort((left, right) => left - right),
            activeEpisodeTitles: Array.from(this.activeEpisodes.values()).map((episode) => episode.title),
            message: this.message
        };
    }
    async run() {
        const stateStore = new ProjectStateStore(projectPaths(this.metadata.projectDir).projectDb);
        const run = {
            id: newId("run"),
            projectId: this.metadata.id,
            type: this.mode === "retry-failed" ? "retry" : "translate",
            startedAt: this.startedAt ?? nowIso(),
            status: "running",
            backend: this.adapter.id,
            model: this.metadata.options.model,
            episodeCount: 0
        };
        let runCreated = false;
        try {
            const episodes = await listEpisodes(this.metadata.projectDir);
            const states = stateStore.listEpisodeStates();
            const stateById = new Map(states.map((state) => [state.episodeId, state]));
            const queue = episodes.filter((episode) => shouldQueue(stateById.get(episode.id)?.status, this.mode));
            this.queued = queue.length;
            this.skipped = episodes.length - queue.length;
            run.episodeCount = queue.length;
            stateStore.createRun(run);
            runCreated = true;
            const status = await this.adapter.checkAvailability();
            if (!status.available) {
                throw new Error(status.message);
            }
            this.metadata.status = "translating";
            this.metadata.updatedAt = nowIso();
            await saveProjectMetadata(this.metadata);
            await this.log("translation", "session_started", `${queue.length} episode(s) queued.`, run.id);
            let glossary = await loadGlossary(this.metadata.projectDir);
            glossary = extractGlossaryCandidates(episodes, glossary);
            await saveGlossary(this.metadata.projectDir, glossary);
            const glossaryUpdater = new ProjectGlossaryUpdater(this.metadata.projectDir, glossary);
            const workerCount = Math.max(1, Math.min(this.metadata.options.concurrency, queue.length || 1));
            await Promise.all(Array.from({ length: workerCount }, () => this.runWorker(queue, glossaryUpdater, stateStore)));
            await writeQualityReport(this.metadata.projectDir, await readAllQAIssues(this.metadata.projectDir));
            if (this.status !== "cancelled") {
                this.status = this.failed > 0 ? "failed" : "completed";
            }
            this.metadata.status = this.status === "cancelled" ? "paused" : this.failed > 0 ? "completed_with_issues" : "completed";
            this.metadata.updatedAt = nowIso();
            await saveProjectMetadata(this.metadata);
            stateStore.finishRun(run.id, this.failed > 0 ? "failed" : this.status === "cancelled" ? "cancelled" : "completed");
            await this.log("translation", "session_finished", `completed=${this.completed}, failed=${this.failed}.`, run.id);
            this.activeEpisodes.clear();
            this.message = `번역 ${sessionStatusLabel(this.status)}: 완료 ${this.completed}, 실패 ${this.failed}.`;
            return this.snapshot();
        }
        catch (error) {
            this.status = "failed";
            this.message = error.message;
            if (!runCreated) {
                stateStore.createRun(run);
            }
            stateStore.finishRun(run.id, "failed", this.message);
            await this.log("error", "session_failed", this.message, run.id);
            this.metadata.status = "failed";
            this.metadata.updatedAt = nowIso();
            await saveProjectMetadata(this.metadata);
            throw error;
        }
        finally {
            stateStore.close();
        }
    }
    async runWorker(queue, glossaryUpdater, stateStore) {
        while (queue.length > 0) {
            await this.waitWhilePaused();
            if (this.status === "cancelled") {
                return;
            }
            const episode = queue.shift();
            if (!episode) {
                return;
            }
            await this.translateEpisode(episode, glossaryUpdater, stateStore);
        }
    }
    async translateEpisode(episode, glossaryUpdater, stateStore) {
        this.activeEpisodes.set(episode.id, { episodeNo: episode.episodeNo, title: episode.title });
        stateStore.markEpisodeRunning(episode.id);
        await this.log("translation", "episode_started", `${episode.title} started.`, undefined, episode.id);
        try {
            const result = await translateEpisodeParts({
                adapter: this.adapter,
                episode,
                glossary: glossaryUpdater.snapshot(),
                glossaryStrictness: this.metadata.options.glossaryStrictness,
                translationStyle: this.metadata.options.translationStyle,
                model: this.metadata.options.model,
                signal: this.abortController.signal
            });
            const glossary = await glossaryUpdater.mergeCandidates(result.newGlossaryCandidates, episode.id);
            const issues = runQA(episode, result, glossary, this.qaOptions);
            result.qaIssueIds = issues.map((issue) => issue.id);
            await saveTranslation(this.metadata.projectDir, episode, result);
            await saveQAIssues(this.metadata.projectDir, episode, issues);
            stateStore.setEpisodeStatus(episode.id, "completed");
            this.completed += 1;
            this.message = `${episode.title} 완료.`;
            await this.log("translation", "episode_completed", `${episode.title} completed.`, undefined, episode.id);
        }
        catch (error) {
            if (this.status === "cancelled" || isAbortError(error)) {
                stateStore.setEpisodeStatus(episode.id, "pending", "Translation cancelled.");
                this.message = `${episode.title} 취소됨.`;
                await this.log("translation", "episode_cancelled", `${episode.title} cancelled.`, undefined, episode.id);
                return;
            }
            stateStore.setEpisodeStatus(episode.id, "failed", error.message);
            this.failed += 1;
            this.message = `${episode.title} 실패: ${error.message}`;
            await this.log("error", "episode_failed", this.message, undefined, episode.id);
        }
        finally {
            this.activeEpisodes.delete(episode.id);
        }
    }
    async waitWhilePaused() {
        while (this.status === "paused") {
            await sleep(100);
        }
    }
    async log(category, event, message, runId, episodeId) {
        await writeProjectLog({
            projectDir: this.metadata.projectDir,
            category,
            level: category === "error" ? "error" : "info",
            event,
            message,
            projectId: this.metadata.id,
            runId,
            episodeId
        });
    }
    firstActiveEpisodeTitle() {
        return this.activeEpisodes.values().next().value?.title ?? null;
    }
    elapsedMs() {
        return this.startedAtMs === null ? 0 : Math.max(0, Date.now() - this.startedAtMs);
    }
    estimatedRemainingMs() {
        const processed = this.completed + this.failed;
        if (this.queued <= 0 || processed <= 0) {
            return null;
        }
        const remaining = Math.max(0, this.queued - processed);
        return Math.ceil((this.elapsedMs() / processed) * remaining);
    }
}
function sessionStatusLabel(status) {
    if (status === "completed") {
        return "완료";
    }
    if (status === "failed") {
        return "실패";
    }
    if (status === "cancelled") {
        return "취소";
    }
    if (status === "paused") {
        return "일시정지";
    }
    if (status === "running") {
        return "진행 중";
    }
    return "대기";
}
function isAbortError(error) {
    return error instanceof Error && (error.name === "AbortError" || /cancelled|aborted/i.test(error.message));
}
function shouldQueue(status, mode) {
    if (!status) {
        return true;
    }
    if (mode === "retry-failed") {
        return status === "failed";
    }
    if (mode === "pending-only") {
        return status === "pending";
    }
    return status === "pending" || status === "failed" || status === "running";
}
async function sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
