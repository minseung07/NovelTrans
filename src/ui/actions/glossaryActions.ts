import { addForbiddenTarget, confirmGlossaryTerm, deprecateGlossaryTerm } from "../../glossary/glossaryEngine.js";
import { loadGlossary, loadProjectMetadata, saveGlossary } from "../../storage/projectStore.js";
import { writeJson } from "../../storage/jsonFile.js";
import { writeProjectLog } from "../../storage/logger.js";
import { projectPaths } from "../../storage/projectPaths.js";
import { selectedGlossaryQueueItem } from "../glossaryQueue.js";
import type { GlossaryQueueFilter, ProjectUiModel } from "../types.js";

export async function confirmSelectedGlossaryTerm(
  projectDir: string,
  model: ProjectUiModel,
  selectedIndex: number,
  target: string,
  lock = false,
  filter: GlossaryQueueFilter = "all",
  deferredEntryIds: string[] = []
): Promise<string> {
  const normalizedTarget = target.trim();
  if (!normalizedTarget) {
    throw new Error("번역을 먼저 입력하세요.");
  }
  const selected = selectedGlossaryQueueItem(model, selectedIndex, filter, deferredEntryIds);
  if (!selected) {
    return "선택된 용어가 없습니다.";
  }
  const glossary = await loadGlossary(projectDir);
  const next = confirmGlossaryTerm(glossary, selected.entry.source, normalizedTarget, lock);
  await saveGlossary(projectDir, next);
  const metadata = await loadProjectMetadata(projectDir);
  await writeProjectLog({
    projectDir,
    category: "glossary",
    event: lock ? "term_locked" : "term_confirmed",
    message: `${selected.entry.source} -> ${normalizedTarget}`,
    projectId: metadata.id,
    metadata: { source: selected.entry.source, target: normalizedTarget, locked: lock }
  });
  return lock ? `용어를 고정했습니다: ${selected.entry.source} -> ${normalizedTarget}` : `용어를 확정했습니다: ${selected.entry.source} -> ${normalizedTarget}`;
}

export async function forbidSelectedGlossaryTarget(
  projectDir: string,
  model: ProjectUiModel,
  selectedIndex: number,
  target: string,
  filter: GlossaryQueueFilter = "all",
  deferredEntryIds: string[] = []
): Promise<string> {
  const normalizedTarget = target.trim();
  if (!normalizedTarget) {
    throw new Error("번역을 먼저 입력하세요.");
  }
  const selected = selectedGlossaryQueueItem(model, selectedIndex, filter, deferredEntryIds);
  if (!selected) {
    return "선택된 용어가 없습니다.";
  }
  const glossary = await loadGlossary(projectDir);
  const next = addForbiddenTarget(glossary, selected.entry.source, normalizedTarget);
  await saveGlossary(projectDir, next);
  const metadata = await loadProjectMetadata(projectDir);
  await writeProjectLog({
    projectDir,
    category: "glossary",
    event: "forbidden_target_added",
    message: `${selected.entry.source} !-> ${normalizedTarget}`,
    projectId: metadata.id,
    metadata: { source: selected.entry.source, target: normalizedTarget }
  });
  return `금지 번역을 저장했습니다: ${selected.entry.source} !-> ${normalizedTarget}`;
}

export async function discardSelectedGlossaryTerm(
  projectDir: string,
  model: ProjectUiModel,
  selectedIndex: number,
  filter: GlossaryQueueFilter = "all",
  deferredEntryIds: string[] = []
): Promise<string> {
  const selected = selectedGlossaryQueueItem(model, selectedIndex, filter, deferredEntryIds);
  if (!selected) {
    return "선택된 용어가 없습니다.";
  }
  const glossary = await loadGlossary(projectDir);
  const next = deprecateGlossaryTerm(glossary, selected.entry.source);
  await saveGlossary(projectDir, next);
  const metadata = await loadProjectMetadata(projectDir);
  await writeProjectLog({
    projectDir,
    category: "glossary",
    event: "term_deprecated",
    message: `${selected.entry.source} removed from review queue.`,
    projectId: metadata.id,
    metadata: { source: selected.entry.source }
  });
  return `후보 용어를 폐기했습니다: ${selected.entry.source}`;
}

export function suggestedGlossaryTarget(model: ProjectUiModel, selectedIndex: number, filter: GlossaryQueueFilter = "all", deferredEntryIds: string[] = []): string | null {
  const selected = selectedGlossaryQueueItem(model, selectedIndex, filter, deferredEntryIds);
  if (!selected) {
    return null;
  }
  const [candidate] = [...selected.entry.targetCandidates].sort((left, right) => right.count - left.count);
  return candidate?.target ?? selected.entry.target ?? null;
}

export async function exportGlossaryJson(projectDir: string): Promise<string> {
  const glossary = await loadGlossary(projectDir);
  const outputPath = `${projectPaths(projectDir).exportsDir}/glossary.json`;
  await writeJson(outputPath, glossary);
  const metadata = await loadProjectMetadata(projectDir);
  await writeProjectLog({
    projectDir,
    category: "glossary",
    event: "glossary_json_exported",
    message: `Glossary JSON exported: ${outputPath}`,
    projectId: metadata.id,
    metadata: { outputPath, entryCount: glossary.entries.length }
  });
  return outputPath;
}

export function relatedTermsForEpisode(model: ProjectUiModel, episodeTitle: string | null): string {
  const episode =
    (episodeTitle ? model.episodes.find((candidate) => candidate.title === episodeTitle) : null) ??
    model.episodes.find((candidate) => model.overview.episodeStates.find((state) => state.episodeId === candidate.id && state.status === "running")) ??
    model.episodes.find((candidate) => model.overview.episodeStates.find((state) => state.episodeId === candidate.id && state.status === "pending")) ??
    model.episodes[0];
  if (!episode) {
    return "표시할 화가 없습니다.";
  }
  return formatRelatedTerms(model, episode.id, episode.title, episode.sourceText);
}

function formatRelatedTerms(model: ProjectUiModel, episodeId: string, episodeTitle: string, sourceText: string): string {
  const terms = model.glossary.entries.filter((entry) => sourceText.includes(entry.source)).slice(0, 12);
  if (terms.length === 0) {
    return `${episodeTitle}에 연결된 용어가 없습니다.`;
  }
  return `${episodeTitle} (${episodeId}) 관련 용어: ${terms.map((entry) => `${entry.source}${entry.target ? ` -> ${entry.target}` : ""}`).join(", ")}`;
}
