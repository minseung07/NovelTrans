import { join } from "node:path";
import type { Episode } from "../domain/episode.js";
import type { GlossaryData } from "../domain/glossary.js";
import type { ProjectMetadata } from "../domain/project.js";
import type { TranslationResult } from "../domain/translation.js";
import { writeText } from "../storage/jsonFile.js";
import { projectPaths } from "../storage/projectPaths.js";
import { slugify } from "../utils/path.js";

export async function exportTxt(
  metadata: ProjectMetadata,
  episodes: Episode[],
  translations: Map<string, TranslationResult>,
  glossary: GlossaryData
): Promise<string> {
  const lines: string[] = [metadata.name, "=".repeat(metadata.name.length), ""];

  for (const episode of episodes) {
    const translation = translations.get(episode.id);
    if (!translation) {
      continue;
    }
    lines.push(translation.titleKo, "-".repeat(translation.titleKo.length), "");
    if (translation.forewordKo?.trim()) {
      lines.push("Foreword", "--------", "", translation.forewordKo.trim(), "");
    }
    lines.push(translation.bodyKo.trim(), "");
    if (metadata.outputOptions.includeAfterword && translation.afterwordKo?.trim()) {
      lines.push("Afterword", "---------", "", translation.afterwordKo.trim(), "");
    }
  }

  if (metadata.outputOptions.includeGlossaryAppendix) {
    const confirmedEntries = glossary.entries.filter((entry) => entry.target && (entry.status === "confirmed" || entry.status === "locked"));
    if (confirmedEntries.length > 0) {
      lines.push("Glossary", "--------", "");
      for (const entry of confirmedEntries) {
        lines.push(`${entry.source} -> ${entry.target}`);
      }
      lines.push("");
    }
  }

  const path = join(projectPaths(metadata.projectDir).exportsDir, `${slugify(metadata.name)}.txt`);
  await writeText(path, `${lines.join("\n").trimEnd()}\n`);
  return path;
}
