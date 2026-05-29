import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { analyzeSource } from "./sourceAnalyzer.js";
import { splitEpisodes } from "./episodeSplitter.js";
import { createEmptyGlossary, detectGlossaryConflicts, extractGlossaryCandidates } from "../glossary/glossaryEngine.js";
import { runQA } from "../qa/qaEngine.js";
import { createProjectDirectories, loadGlossary, loadProjectMetadata, readAllQAIssues, readTranslation, saveEpisodes, saveGlossary, saveOriginalSource, saveProjectMetadata, saveQAIssues, writeQualityReport } from "../storage/projectStore.js";
import { projectPaths } from "../storage/projectPaths.js";
import { ProjectStateStore } from "../storage/stateStore.js";
import { writeProjectLog } from "../storage/logger.js";
import { newId } from "../utils/hash.js";
import { slugify } from "../utils/path.js";
import { nowIso } from "../utils/time.js";
import { translateProjectQueue } from "./translationOrchestrator.js";
export async function createProjectFromTxt(options) {
    const sourcePath = resolve(options.sourcePath);
    const sourceText = await readFile(sourcePath, "utf8");
    return createProjectFromSourceText({
        ...options,
        sourceText,
        sourceLabel: sourcePath,
        defaultName: basename(sourcePath, ".txt")
    });
}
export async function createProjectFromText(options) {
    return createProjectFromSourceText({
        ...options,
        sourceLabel: options.sourceLabel,
        defaultName: options.name ?? "Pasted Novel"
    });
}
async function createProjectFromSourceText(options) {
    const sourceText = options.sourceText;
    const sourcePath = options.sourceLabel;
    const analysis = analyzeSource(sourceText);
    const episodes = splitEpisodes(sourceText);
    const name = options.name ?? analysis.titleGuess ?? options.defaultName;
    const slug = await uniqueProjectSlug(options.projectRoot, slugify(name));
    const projectDir = join(resolve(options.projectRoot), slug);
    const now = nowIso();
    const metadata = {
        id: newId("project"),
        name,
        originalTitle: analysis.titleGuess,
        sourcePath,
        projectDir,
        status: "ready",
        createdAt: now,
        updatedAt: now,
        options: {
            backend: options.backend,
            model: options.model,
            translationStyle: options.translationStyle ?? "balanced-webnovel",
            concurrency: options.concurrency,
            glossaryStrictness: options.glossaryStrictness,
            ...(options.qaOptions ? { qa: options.qaOptions } : {})
        },
        outputOptions: {
            formats: options.outputOptions?.formats ?? ["txt", "epub"],
            includeGlossaryAppendix: options.outputOptions?.includeGlossaryAppendix ?? true,
            includeAfterword: options.outputOptions?.includeAfterword ?? true,
            verticalWriting: options.outputOptions?.verticalWriting ?? false,
            ...(options.outputOptions?.coverImagePath ? { coverImagePath: options.outputOptions.coverImagePath } : {})
        },
        policy: {
            userConfirmedRights: Boolean(options.userConfirmedRights)
        }
    };
    await createProjectDirectories(projectDir);
    await saveOriginalSource(projectDir, sourceText);
    await saveEpisodes(projectDir, episodes);
    const glossary = extractGlossaryCandidates(episodes, createEmptyGlossary());
    await saveGlossary(projectDir, glossary);
    await saveProjectMetadata(metadata);
    await writeProjectLog({
        projectDir,
        category: "translation",
        event: "project_created",
        message: `${episodes.length} episode(s) imported from source text.`,
        projectId: metadata.id,
        metadata: { sourcePath, glossaryCandidates: glossary.entries.length }
    });
    await writeProjectLog({
        projectDir,
        category: "glossary",
        event: "initial_candidates_extracted",
        message: `${glossary.entries.length} glossary candidate(s) extracted.`,
        projectId: metadata.id,
        metadata: { conflictCount: glossary.conflicts.length }
    });
    const stateStore = new ProjectStateStore(projectPaths(projectDir).projectDb);
    try {
        stateStore.initializeEpisodeStates(episodes);
    }
    finally {
        stateStore.close();
    }
    return { metadata, analysis, glossary };
}
export async function loadProjectOverview(projectDir) {
    const metadata = await loadProjectMetadata(projectDir);
    const stateStore = new ProjectStateStore(projectPaths(projectDir).projectDb);
    try {
        const episodeStates = stateStore.listEpisodeStates();
        const glossary = await loadGlossary(projectDir);
        const issues = await readAllQAIssues(projectDir);
        return {
            metadata,
            episodeStates,
            counts: {
                pending: episodeStates.filter((state) => state.status === "pending").length,
                running: episodeStates.filter((state) => state.status === "running").length,
                completed: episodeStates.filter((state) => state.status === "completed").length,
                failed: episodeStates.filter((state) => state.status === "failed").length,
                skipped: episodeStates.filter((state) => state.status === "skipped").length
            },
            qaIssueCount: issues.filter((issue) => !issue.resolved).length,
            glossaryCandidateCount: glossary.entries.filter((entry) => entry.status === "candidate").length,
            glossaryConflictCount: glossary.conflicts.length
        };
    }
    finally {
        stateStore.close();
    }
}
export async function runTranslation(projectDir, adapter, mode, concurrency, qaOptions) {
    const metadata = await loadProjectMetadata(projectDir);
    return translateProjectQueue({
        metadata,
        adapter,
        mode,
        concurrency: concurrency ?? metadata.options.concurrency,
        qaOptions: qaOptions ?? metadata.options.qa
    });
}
export async function rerunProjectQA(projectDir, onProgress, qaOptions) {
    const { listEpisodes } = await import("../storage/projectStore.js");
    const metadata = await loadProjectMetadata(projectDir);
    const episodes = await listEpisodes(projectDir);
    const glossary = await loadGlossary(projectDir);
    const effectiveQAOptions = qaOptions ?? metadata.options.qa;
    const allIssues = [];
    for (const [index, episode] of episodes.entries()) {
        onProgress?.({ completed: index, total: episodes.length, episodeTitle: episode.title });
        const result = await readTranslation(projectDir, episode);
        if (!result) {
            await saveQAIssues(projectDir, episode, []);
            onProgress?.({ completed: index + 1, total: episodes.length, episodeTitle: episode.title });
            continue;
        }
        const issues = runQA(episode, result, glossary, effectiveQAOptions);
        await saveQAIssues(projectDir, episode, issues);
        allIssues.push(...issues);
        onProgress?.({ completed: index + 1, total: episodes.length, episodeTitle: episode.title });
    }
    await writeQualityReport(projectDir, allIssues);
    return allIssues;
}
export async function refreshGlossaryConflicts(projectDir) {
    const glossary = await loadGlossary(projectDir);
    const next = {
        ...glossary,
        conflicts: detectGlossaryConflicts(glossary.entries),
        updatedAt: nowIso()
    };
    await saveGlossary(projectDir, next);
    await writeProjectLog({
        projectDir,
        category: "glossary",
        event: "conflicts_refreshed",
        message: `${next.conflicts.length} glossary conflict(s) detected.`,
        projectId: (await loadProjectMetadata(projectDir)).id,
        metadata: { conflictCount: next.conflicts.length }
    });
    return next;
}
async function uniqueProjectSlug(projectRoot, baseSlug) {
    const { pathExists } = await import("../storage/jsonFile.js");
    const root = resolve(projectRoot);
    let slug = baseSlug;
    let counter = 2;
    while (await pathExists(join(root, slug))) {
        slug = `${baseSlug}-${counter}`;
        counter += 1;
    }
    return slug;
}
