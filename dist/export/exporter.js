import { loadGlossary, saveProjectMetadata } from "../storage/projectStore.js";
import { writeProjectLog } from "../storage/logger.js";
import { nowIso } from "../utils/time.js";
import { exportEpub } from "./epubExporter.js";
import { exportTxt } from "./txtExporter.js";
import { loadExportableTranslations } from "./exportableTranslations.js";
export async function exportProject(metadata, formats) {
    const { episodes, translations } = await loadExportableTranslations(metadata.projectDir);
    const glossary = await loadGlossary(metadata.projectDir);
    const files = [];
    if (formats.includes("txt")) {
        files.push(await exportTxt(metadata, episodes, translations, glossary));
    }
    if (formats.includes("epub")) {
        files.push(await exportEpub(metadata, episodes, translations, glossary));
    }
    metadata.status = "exported";
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
