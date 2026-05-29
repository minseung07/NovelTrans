import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { ensureDir, pathExists, readJson, writeJson, writeText } from "./jsonFile.js";
import { episodeSourcePath, projectPaths, qaEpisodePath, translationJsonPath, translationMarkdownPath } from "./projectPaths.js";
export async function createProjectDirectories(projectDir) {
    const paths = projectPaths(projectDir);
    await Promise.all([
        ensureDir(paths.sourceDir),
        ensureDir(paths.translatedDir),
        ensureDir(paths.glossaryDir),
        ensureDir(paths.exportsDir),
        ensureDir(paths.logsDir)
    ]);
}
export async function saveProjectMetadata(metadata) {
    await writeJson(projectPaths(metadata.projectDir).projectJson, metadata);
}
export async function loadProjectMetadata(projectDir) {
    return readJson(projectPaths(projectDir).projectJson);
}
export async function saveOriginalSource(projectDir, text) {
    await writeText(projectPaths(projectDir).originalSource, text);
}
export async function saveEpisodes(projectDir, episodes) {
    await Promise.all(episodes.map((episode) => writeJson(episodeSourcePath(projectDir, episode.episodeNo), episode)));
}
export async function listEpisodes(projectDir) {
    const paths = projectPaths(projectDir);
    const names = await readdir(paths.sourceDir);
    const episodeFiles = names.filter((name) => /^episode_\d+\.json$/.test(name)).sort();
    return Promise.all(episodeFiles.map((name) => readJson(join(paths.sourceDir, name))));
}
export async function saveGlossary(projectDir, glossary) {
    const paths = projectPaths(projectDir);
    await writeJson(paths.glossaryJson, glossary);
    await writeJson(paths.conflictsJson, glossary.conflicts);
    const forbidden = glossary.entries
        .filter((entry) => entry.forbiddenTargets.length > 0 || entry.status === "forbidden")
        .map((entry) => ({
        source: entry.source,
        allowedTarget: entry.target,
        forbiddenTargets: entry.forbiddenTargets
    }));
    await writeJson(paths.forbiddenJson, forbidden);
}
export async function loadGlossary(projectDir) {
    const paths = projectPaths(projectDir);
    if (!(await pathExists(paths.glossaryJson))) {
        return { version: 1, entries: [], conflicts: [], updatedAt: new Date(0).toISOString() };
    }
    return readJson(paths.glossaryJson);
}
export async function saveTranslation(projectDir, episode, result) {
    await writeJson(translationJsonPath(projectDir, episode.episodeNo), result);
    await writeText(translationMarkdownPath(projectDir, episode.episodeNo), renderTranslationMarkdown(result));
}
export async function readTranslation(projectDir, episode) {
    const path = translationJsonPath(projectDir, episode.episodeNo);
    if (!(await pathExists(path))) {
        return null;
    }
    const result = await readJson(path);
    const markdownPath = translationMarkdownPath(projectDir, episode.episodeNo);
    if (!(await isMarkdownNewer(markdownPath, path))) {
        return result;
    }
    return applyMarkdownEdit(result, await readFile(markdownPath, "utf8"));
}
export async function listTranslations(projectDir, episodes) {
    const results = [];
    for (const episode of episodes) {
        const result = await readTranslation(projectDir, episode);
        if (result) {
            results.push(result);
        }
    }
    return results;
}
export async function saveQAIssues(projectDir, episode, issues) {
    await writeJson(qaEpisodePath(projectDir, episode.episodeNo), issues);
}
export async function updateQAIssue(projectDir, issueId, patch) {
    const episodes = await listEpisodes(projectDir);
    for (const episode of episodes) {
        const path = qaEpisodePath(projectDir, episode.episodeNo);
        if (!(await pathExists(path))) {
            continue;
        }
        const issues = await readJson(path);
        const index = issues.findIndex((issue) => issue.id === issueId);
        if (index < 0) {
            continue;
        }
        const current = issues[index];
        if (!current) {
            continue;
        }
        const updated = { ...current, ...patch };
        issues[index] = updated;
        await writeJson(path, issues);
        await writeQualityReport(projectDir, await readAllQAIssues(projectDir));
        return updated;
    }
    return null;
}
export async function readAllQAIssues(projectDir) {
    const paths = projectPaths(projectDir);
    if (!(await pathExists(paths.logsDir))) {
        return [];
    }
    const names = await readdir(paths.logsDir);
    const issueFiles = names.filter((name) => /^episode_\d+\.qa\.json$/.test(name)).sort();
    const nested = await Promise.all(issueFiles.map((name) => readJson(join(paths.logsDir, name))));
    return nested.flat();
}
export async function writeQualityReport(projectDir, issues) {
    const paths = projectPaths(projectDir);
    const bySeverity = issues.reduce((accumulator, issue) => {
        accumulator[issue.severity] = (accumulator[issue.severity] ?? 0) + 1;
        return accumulator;
    }, {});
    await writeJson(paths.qualityReportJson, {
        issueCount: issues.length,
        bySeverity,
        generatedAt: new Date().toISOString(),
        issues
    });
    const lines = [
        "NovelTrans QA Report",
        `Issues: ${issues.length}`,
        `Errors: ${bySeverity.error ?? 0}`,
        `Warnings: ${bySeverity.warning ?? 0}`,
        `Info: ${bySeverity.info ?? 0}`,
        "",
        ...issues.map((issue) => `- [${issue.severity}] ${issue.episodeId} ${issue.type}: ${issue.message}`)
    ];
    await writeText(paths.qualityReportTxt, `${lines.join("\n")}\n`);
}
export async function discoverProjectDirs(projectRoot) {
    if (!(await pathExists(projectRoot))) {
        return [];
    }
    const entries = await readdir(projectRoot, { withFileTypes: true });
    const projectDirs = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        const projectDir = join(projectRoot, entry.name);
        if (await pathExists(projectPaths(projectDir).projectJson)) {
            projectDirs.push(projectDir);
        }
    }
    return projectDirs.sort((left, right) => basename(left).localeCompare(basename(right)));
}
function renderTranslationMarkdown(result) {
    const parts = [`# ${result.titleKo}`, ""];
    if (result.forewordKo) {
        parts.push("## Foreword", "", result.forewordKo, "");
    }
    if (result.forewordKo || result.afterwordKo) {
        parts.push("## Body", "");
    }
    parts.push(result.bodyKo, "");
    if (result.afterwordKo) {
        parts.push("## Afterword", "", result.afterwordKo, "");
    }
    parts.push(`<!-- backend=${result.backend} model=${result.model} createdAt=${result.createdAt} -->`, "");
    return parts.join("\n");
}
async function isMarkdownNewer(markdownPath, jsonPath) {
    if (!(await pathExists(markdownPath))) {
        return false;
    }
    const [markdownStat, jsonStat] = await Promise.all([stat(markdownPath), stat(jsonPath)]);
    return markdownStat.mtimeMs > jsonStat.mtimeMs;
}
function applyMarkdownEdit(result, markdown) {
    const lines = markdown.replace(/\r\n/g, "\n").split("\n");
    const heading = lines[0]?.startsWith("# ") ? lines.shift()?.slice(2).trim() : null;
    const contentLines = lines
        .filter((line) => !/^<!--\s*backend=/.test(line.trim()))
        .join("\n");
    const parts = splitMarkdownSections(contentLines);
    return {
        ...result,
        titleKo: heading || result.titleKo,
        forewordKo: parts.forewordKo ?? result.forewordKo,
        bodyKo: parts.bodyKo || result.bodyKo,
        afterwordKo: parts.afterwordKo ?? result.afterwordKo
    };
}
function splitMarkdownSections(markdown) {
    const lines = markdown.split("\n");
    const forewordIndex = lines.findIndex((line) => /^##\s+Foreword\s*$/i.test(line.trim()));
    const bodyIndex = lines.findIndex((line) => /^##\s+Body\s*$/i.test(line.trim()));
    const afterwordIndex = lines.findIndex((line) => /^##\s+Afterword\s*$/i.test(line.trim()));
    if (forewordIndex < 0 && bodyIndex < 0 && afterwordIndex < 0) {
        return { bodyKo: markdown.trim() };
    }
    const bodyStart = bodyIndex >= 0 ? bodyIndex + 1 : forewordIndex >= 0 ? nextSectionIndex(lines, forewordIndex) : 0;
    const bodyEnd = afterwordIndex >= 0 ? afterwordIndex : lines.length;
    return {
        forewordKo: forewordIndex >= 0 ? lines.slice(forewordIndex + 1, bodyIndex >= 0 ? bodyIndex : nextSectionIndex(lines, forewordIndex)).join("\n").trim() || undefined : undefined,
        bodyKo: lines.slice(bodyStart, bodyEnd).join("\n").trim(),
        afterwordKo: afterwordIndex >= 0 ? lines.slice(afterwordIndex + 1).join("\n").trim() || undefined : undefined
    };
}
function nextSectionIndex(lines, headingIndex) {
    const index = lines.findIndex((line, lineIndex) => lineIndex > headingIndex && /^##\s+/.test(line.trim()));
    return index >= 0 ? index : lines.length;
}
