import { readFile, stat } from "node:fs/promises";
import type { SourceAnalysis } from "../domain/episode.js";
import { analyzeSource } from "../engine/sourceAnalyzer.js";
import { pathExists } from "../storage/jsonFile.js";
import { projectPaths } from "../storage/projectPaths.js";

type CacheEntry = {
  mtimeMs: number;
  size: number;
  analysis: SourceAnalysis;
};

const cache = new Map<string, CacheEntry>();

export async function loadCachedSourceAnalysis(projectDir: string): Promise<SourceAnalysis | null> {
  const path = projectPaths(projectDir).originalSource;
  if (!(await pathExists(path))) {
    cache.delete(projectDir);
    return null;
  }
  const info = await stat(path);
  const cached = cache.get(projectDir);
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
    return cached.analysis;
  }
  const analysis = analyzeSource(await readFile(path, "utf8"));
  cache.set(projectDir, {
    mtimeMs: info.mtimeMs,
    size: info.size,
    analysis
  });
  return analysis;
}
