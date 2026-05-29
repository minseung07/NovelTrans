import type { ProjectMetadata } from "../../domain/project.js";
import { exportProject } from "../../export/exporter.js";
import { loadProjectMetadata, saveProjectMetadata } from "../../storage/projectStore.js";
import { projectPaths } from "../../storage/projectPaths.js";
import { nowIso } from "../../utils/time.js";
import type { ProjectUiModel } from "../types.js";
import { openFile, type OpenFileOptions } from "./fileOpenActions.js";

export async function toggleOutputFormat(projectDir: string, format: "txt" | "epub"): Promise<ProjectMetadata> {
  const metadata = await loadProjectMetadata(projectDir);
  const hasFormat = metadata.outputOptions.formats.includes(format);
  const formats = hasFormat ? metadata.outputOptions.formats.filter((item) => item !== format) : [...metadata.outputOptions.formats, format];
  metadata.outputOptions.formats = formats.length > 0 ? formats : [format];
  metadata.updatedAt = nowIso();
  await saveProjectMetadata(metadata);
  return metadata;
}

export async function toggleGlossaryAppendix(projectDir: string): Promise<ProjectMetadata> {
  const metadata = await loadProjectMetadata(projectDir);
  metadata.outputOptions.includeGlossaryAppendix = !metadata.outputOptions.includeGlossaryAppendix;
  metadata.updatedAt = nowIso();
  await saveProjectMetadata(metadata);
  return metadata;
}

export async function toggleAfterword(projectDir: string): Promise<ProjectMetadata> {
  const metadata = await loadProjectMetadata(projectDir);
  metadata.outputOptions.includeAfterword = !metadata.outputOptions.includeAfterword;
  metadata.updatedAt = nowIso();
  await saveProjectMetadata(metadata);
  return metadata;
}

export async function toggleVerticalWriting(projectDir: string): Promise<ProjectMetadata> {
  const metadata = await loadProjectMetadata(projectDir);
  metadata.outputOptions.verticalWriting = !metadata.outputOptions.verticalWriting;
  metadata.updatedAt = nowIso();
  await saveProjectMetadata(metadata);
  return metadata;
}

export async function setCoverImagePath(projectDir: string, coverImagePath: string): Promise<ProjectMetadata> {
  const metadata = await loadProjectMetadata(projectDir);
  metadata.outputOptions.coverImagePath = coverImagePath;
  metadata.updatedAt = nowIso();
  await saveProjectMetadata(metadata);
  return metadata;
}

export async function clearCoverImagePath(projectDir: string): Promise<ProjectMetadata> {
  const metadata = await loadProjectMetadata(projectDir);
  delete metadata.outputOptions.coverImagePath;
  metadata.updatedAt = nowIso();
  await saveProjectMetadata(metadata);
  return metadata;
}

export async function generateConfiguredExports(projectDir: string): Promise<string> {
  const metadata = await loadProjectMetadata(projectDir);
  const summary = await exportProject(metadata, metadata.outputOptions.formats);
  return `${summary.files.length}개 파일을 생성했습니다: ${summary.files.join(", ")}`;
}

export async function generateAllExports(projectDir: string): Promise<string> {
  const metadata = await loadProjectMetadata(projectDir);
  const summary = await exportProject(metadata, ["txt", "epub"]);
  return `${summary.files.length}개 파일을 생성했습니다: ${summary.files.join(", ")}`;
}

export function formatExportPreview(model: ProjectUiModel): string {
  const preview = model.exportPreview;
  const metadata = model.overview.metadata;
  const formats = metadata.outputOptions.formats.map((format) => format.toUpperCase()).join("+");
  return [
    `${preview.title}: ${preview.translatedEpisodeCount}/${preview.episodeCount}화 번역됨`,
    `형식: ${formats}`,
    `용어집 부록: ${metadata.outputOptions.includeGlossaryAppendix ? preview.glossaryAppendixCount : 0}개`,
    `쓰기 방향: ${metadata.outputOptions.verticalWriting ? "세로쓰기" : "가로쓰기"}`,
    `예상 경로: ${preview.expectedTxtPath} / ${preview.expectedEpubPath}`
  ].join(" | ");
}

export async function openOutputFolder(projectDir: string, options: OpenFileOptions = {}): Promise<string> {
  const result = await openFile(projectPaths(projectDir).exportsDir, options);
  return result.message;
}
