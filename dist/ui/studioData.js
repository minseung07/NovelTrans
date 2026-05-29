import { join } from "node:path";
import { loadProjectOverview } from "../engine/projectWorkflow.js";
import { loadGlossary, listEpisodes, readAllQAIssues } from "../storage/projectStore.js";
import { pathExists } from "../storage/jsonFile.js";
import { readProjectLogTail } from "../storage/logger.js";
import { discoverProjectDirs } from "../storage/projectStore.js";
import { projectPaths } from "../storage/projectPaths.js";
import { slugify } from "../utils/path.js";
import { countExportableTranslatedEpisodes } from "../export/exportableTranslations.js";
import { buildFailureRecovery, buildNextActions } from "./nextActions.js";
import { buildSourceStatus } from "./sourceStatus.js";
import { buildStudioQueue } from "./studioQueue.js";
import { buildProjectTimeline } from "./projectTimeline.js";
import { buildReviewDeskModel } from "./reviewDeskModel.js";
import { buildBookshelfProject } from "./bookshelfProject.js";
import { translationStyleLabel } from "./recipeStyle.js";
import { loadCachedSourceAnalysis } from "./sourceAnalysisCache.js";
export async function loadBookshelfModel(projectRoot) {
    const projectDirs = await discoverProjectDirs(projectRoot);
    const overviews = await Promise.all(projectDirs.map((projectDir) => loadProjectOverview(projectDir)));
    const projects = (await Promise.all(overviews.map((overview) => buildBookshelfProject(overview)))).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return {
        projectRoot,
        continueProject: projects[0] ?? null,
        allProjects: projects,
        recentProjects: projects.slice(0, 8),
        problemProjects: projects.filter((project) => project.failed > 0 || project.running > 0 || project.skipped > 0 || project.qaIssues > 0 || project.conflicts > 0)
    };
}
export async function loadProjectUiModel(projectDir) {
    const overview = await loadProjectOverview(projectDir);
    const [glossary, qaIssues, episodes, translationEvents, errorEvents, glossaryEvents, exportEvents] = await Promise.all([
        loadGlossary(projectDir),
        readAllQAIssues(projectDir),
        listEpisodes(projectDir),
        readProjectLogTail(projectDir, "translation", 40),
        readProjectLogTail(projectDir, "error", 4),
        readProjectLogTail(projectDir, "glossary", 3),
        readProjectLogTail(projectDir, "export", 3)
    ]);
    const liveEvents = [...translationEvents.slice(-6), ...errorEvents, ...glossaryEvents, ...exportEvents]
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
        .slice(-8);
    const sourceAnalysis = await loadCachedSourceAnalysis(projectDir);
    const baseModel = {
        overview,
        episodes,
        glossary,
        glossaryPulse: buildGlossaryPulse(glossary, qaIssues),
        qaIssues,
        sourceStatus: buildSourceStatus(overview.metadata, episodes, sourceAnalysis),
        studioQueue: buildStudioQueue(overview),
        timeline: buildProjectTimeline(liveEvents),
        reviewDesk: buildReviewDeskModel(qaIssues),
        liveEvents,
        exportPreview: await buildExportPreview(projectDir, overview.metadata.name, episodes.length, glossary.entries.filter((entry) => entry.target).length)
    };
    return {
        ...baseModel,
        nextActions: buildNextActions({ ...baseModel, liveEvents: translationEvents }),
        failureRecovery: buildFailureRecovery(baseModel)
    };
}
export function recipeSummary(config) {
    return `${translationStyleLabel(config.translationStyle)} · ${config.concurrency}화 병렬 · 용어 ${strictnessSummary(config.glossaryStrictness)} · ${config.outputFormats.join("+").toUpperCase()} · ${backendSummary(config.defaultBackend)}`;
}
function backendSummary(backend) {
    if (backend === "openai-compatible") {
        return "OpenAI 호환";
    }
    if (backend === "codex-cli") {
        return "Codex CLI";
    }
    return "Dry-run";
}
function strictnessSummary(strictness) {
    if (strictness === "strict") {
        return "매우 엄격";
    }
    if (strictness === "high") {
        return "높음";
    }
    if (strictness === "medium") {
        return "보통";
    }
    return "낮음";
}
function buildGlossaryPulse(glossary, qaIssues) {
    const confirmed = glossary.entries.filter((entry) => entry.status === "confirmed" || entry.status === "locked").length;
    const locked = glossary.entries.filter((entry) => entry.locked).length;
    const candidates = glossary.entries.filter((entry) => entry.status === "candidate").length;
    const forbiddenViolations = qaIssues.filter((issue) => issue.type === "forbidden_term").length;
    const consistencyScore = Math.max(0, 100 - glossary.conflicts.length * 12 - forbiddenViolations * 15);
    const lockCoveragePercent = confirmed === 0 ? 0 : Math.round((locked / confirmed) * 100);
    const firstConflict = glossary.conflicts[0];
    return {
        confirmed,
        locked,
        candidates,
        conflicts: glossary.conflicts.length,
        forbiddenViolations,
        topConflict: firstConflict ? `${firstConflict.source} -> ${firstConflict.targets.join(" / ")}` : null,
        healthScore: consistencyScore,
        lockCoveragePercent
    };
}
async function buildExportPreview(projectDir, title, episodeCount, glossaryAppendixCount) {
    const paths = projectPaths(projectDir);
    const slug = slugify(title);
    const expectedTxtPath = join(paths.exportsDir, `${slug}.txt`);
    const expectedEpubPath = join(paths.exportsDir, `${slug}.epub`);
    const translatedEpisodeCount = await countExportableTranslatedEpisodes(projectDir);
    return {
        title,
        episodeCount,
        translatedEpisodeCount,
        glossaryAppendixCount,
        expectedTxtPath,
        expectedEpubPath,
        txtExists: await pathExists(expectedTxtPath),
        epubExists: await pathExists(expectedEpubPath)
    };
}
