import { join } from "node:path";
import { padEpisodeNo } from "../utils/path.js";
export function projectPaths(projectDir) {
    return {
        root: projectDir,
        projectJson: join(projectDir, "project.json"),
        projectDb: join(projectDir, "project.db"),
        sourceDir: join(projectDir, "source"),
        originalSource: join(projectDir, "source", "original.txt"),
        translatedDir: join(projectDir, "translated"),
        glossaryDir: join(projectDir, "glossary"),
        glossaryJson: join(projectDir, "glossary", "glossary.json"),
        conflictsJson: join(projectDir, "glossary", "conflicts.json"),
        forbiddenJson: join(projectDir, "glossary", "forbidden.json"),
        exportsDir: join(projectDir, "exports"),
        logsDir: join(projectDir, "logs"),
        qualityReportJson: join(projectDir, "logs", "quality_report.json"),
        qualityReportTxt: join(projectDir, "logs", "quality_report.txt")
    };
}
export function episodeSourcePath(projectDir, episodeNo) {
    return join(projectDir, "source", `episode_${padEpisodeNo(episodeNo)}.json`);
}
export function translationJsonPath(projectDir, episodeNo) {
    return join(projectDir, "translated", `episode_${padEpisodeNo(episodeNo)}.json`);
}
export function translationMarkdownPath(projectDir, episodeNo) {
    return join(projectDir, "translated", `episode_${padEpisodeNo(episodeNo)}.md`);
}
export function qaEpisodePath(projectDir, episodeNo) {
    return join(projectDir, "logs", `episode_${padEpisodeNo(episodeNo)}.qa.json`);
}
