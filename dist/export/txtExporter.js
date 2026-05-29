import { join } from "node:path";
import { writeText } from "../storage/jsonFile.js";
import { projectPaths } from "../storage/projectPaths.js";
import { slugify } from "../utils/path.js";
import { glossaryAppendixEntries } from "./glossaryAppendix.js";
export async function exportTxt(metadata, episodes, translations, glossary) {
    const lines = [metadata.name, "=".repeat(metadata.name.length), ""];
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
        const confirmedEntries = glossaryAppendixEntries(glossary.entries);
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
