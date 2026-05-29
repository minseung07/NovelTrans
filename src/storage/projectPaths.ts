import { join } from "node:path";
import { padEpisodeNo } from "../utils/path.js";

export type ProjectPaths = {
  root: string;
  projectJson: string;
  projectDb: string;
  sourceDir: string;
  originalSource: string;
  translatedDir: string;
  glossaryDir: string;
  glossaryJson: string;
  conflictsJson: string;
  forbiddenJson: string;
  exportsDir: string;
  logsDir: string;
  qualityReportJson: string;
  qualityReportTxt: string;
};

export function projectPaths(projectDir: string): ProjectPaths {
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

export function episodeSourcePath(projectDir: string, episodeNo: number): string {
  return join(projectDir, "source", `episode_${padEpisodeNo(episodeNo)}.json`);
}

export function translationJsonPath(projectDir: string, episodeNo: number): string {
  return join(projectDir, "translated", `episode_${padEpisodeNo(episodeNo)}.json`);
}

export function translationMarkdownPath(projectDir: string, episodeNo: number): string {
  return join(projectDir, "translated", `episode_${padEpisodeNo(episodeNo)}.md`);
}

export function qaEpisodePath(projectDir: string, episodeNo: number): string {
  return join(projectDir, "logs", `episode_${padEpisodeNo(episodeNo)}.qa.json`);
}
