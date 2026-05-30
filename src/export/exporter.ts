import type { ProjectMetadata } from "../domain/project.js";
import { loadGlossary, saveProjectMetadata } from "../storage/projectStore.js";
import { writeProjectLog } from "../storage/logger.js";
import { nowIso } from "../utils/time.js";
import { exportEpub } from "./epubExporter.js";
import { exportTxt } from "./txtExporter.js";
import { loadExportableTranslations, type ExportableTranslations } from "./exportableTranslations.js";

export type ExportFormat = "txt" | "epub";

type ExportSummary = {
  files: string[];
  translatedEpisodeCount: number;
};

export async function exportProject(metadata: ProjectMetadata, formats: ExportFormat[]): Promise<ExportSummary> {
  const exportable = await loadExportableTranslations(metadata.projectDir);
  const { episodes, translations } = exportable;
  const glossary = await loadGlossary(metadata.projectDir);
  const files: string[] = [];
  if (formats.includes("txt")) {
    files.push(await exportTxt(metadata, episodes, translations, glossary));
  }
  if (formats.includes("epub")) {
    files.push(await exportEpub(metadata, episodes, translations, glossary));
  }

  metadata.status = statusAfterExport(metadata, exportable);
  metadata.updatedAt = nowIso();
  await saveProjectMetadata(metadata);
  await writeProjectLog({
    projectDir: metadata.projectDir,
    category: "export",
    event: "export_completed",
    message: `Exported ${files.length} file(s).`,
    projectId: metadata.id,
    metadata: { formats, files, translatedEpisodeCount: translations.size }
  });

  return {
    files,
    translatedEpisodeCount: translations.size
  };
}

function statusAfterExport(metadata: ProjectMetadata, exportable: ExportableTranslations): ProjectMetadata["status"] {
  if (isCompleteExport(exportable)) {
    return "exported";
  }
  if (exportable.hasEpisodeStates && exportable.episodeStates.some((state) => state.status === "failed")) {
    return "completed_with_issues";
  }
  return metadata.status === "exported" ? "ready" : metadata.status;
}

function isCompleteExport(exportable: ExportableTranslations): boolean {
  if (exportable.translations.size === 0) {
    return false;
  }
  if (!exportable.hasEpisodeStates) {
    return exportable.episodes.length > 0 && exportable.translations.size === exportable.episodes.length;
  }
  return (
    exportable.episodeStates.length > 0 &&
    exportable.episodeStates.every((state) => state.status === "completed" || state.status === "skipped")
  );
}
