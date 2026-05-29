import { appendFile, open, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { ensureDir, pathExists } from "./jsonFile.js";
import { projectPaths } from "./projectPaths.js";
const logFileByCategory = {
    translation: "translation.log",
    qa: "qa.log",
    glossary: "glossary.log",
    export: "export.log",
    error: "error.log"
};
export async function writeProjectLog(options) {
    const paths = projectPaths(options.projectDir);
    await ensureDir(paths.logsDir);
    const entry = {
        timestamp: new Date().toISOString(),
        level: options.level ?? "info",
        category: options.category,
        event: options.event,
        message: options.message,
        projectId: options.projectId,
        runId: options.runId,
        episodeId: options.episodeId,
        metadata: options.metadata
    };
    const line = `${JSON.stringify(entry)}\n`;
    await appendFile(join(paths.logsDir, logFileByCategory[options.category]), line, "utf8");
    if (entry.level === "error" && entry.category !== "error") {
        await appendFile(join(paths.logsDir, logFileByCategory.error), line, "utf8");
    }
}
export async function readProjectLogTail(projectDir, category, limit = 10) {
    const path = join(projectPaths(projectDir).logsDir, logFileByCategory[category]);
    if (!(await pathExists(path))) {
        return [];
    }
    const content = await readLogTailContent(path, limit);
    return content
        .trim()
        .split("\n")
        .filter(Boolean)
        .slice(-limit)
        .map((line) => JSON.parse(line));
}
async function readLogTailContent(path, limit) {
    const info = await stat(path);
    const maxBytes = Math.max(16 * 1024, Math.min(512 * 1024, limit * 8192));
    if (info.size <= maxBytes) {
        return readFile(path, "utf8");
    }
    const handle = await open(path, "r");
    try {
        const length = Math.min(info.size, maxBytes);
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, info.size - length);
        const content = buffer.toString("utf8");
        const firstNewline = content.indexOf("\n");
        return firstNewline >= 0 ? content.slice(firstNewline + 1) : content;
    }
    finally {
        await handle.close();
    }
}
