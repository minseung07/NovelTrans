import { appendFile, open, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { LogCategory, LogEntry, LogLevel } from "../domain/log.js";
import { ensureDir, pathExists } from "./jsonFile.js";
import { projectPaths } from "./projectPaths.js";

type WriteLogOptions = {
  projectDir: string;
  category: LogCategory;
  level?: LogLevel;
  event: string;
  message: string;
  projectId?: string;
  runId?: string;
  episodeId?: string;
  metadata?: Record<string, unknown>;
};

const logFileByCategory: Record<LogCategory, string> = {
  translation: "translation.log",
  qa: "qa.log",
  glossary: "glossary.log",
  export: "export.log",
  error: "error.log"
};

export async function writeProjectLog(options: WriteLogOptions): Promise<void> {
  const paths = projectPaths(options.projectDir);
  await ensureDir(paths.logsDir);
  const entry: LogEntry = {
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

export async function readProjectLogTail(projectDir: string, category: LogCategory, limit = 10): Promise<LogEntry[]> {
  const path = join(projectPaths(projectDir).logsDir, logFileByCategory[category]);
  if (!(await pathExists(path))) {
    return [];
  }
  const content = await readLogTailContent(path, limit);
  const lines = content
    .trim()
    .split("\n")
    .filter(Boolean)
    .slice(-limit);
  const entries: LogEntry[] = [];
  let malformedLineCount = 0;
  for (const line of lines) {
    const entry = parseLogLine(line);
    if (entry) {
      entries.push(entry);
    } else {
      malformedLineCount += 1;
    }
  }
  if (malformedLineCount > 0) {
    entries.push({
      timestamp: new Date().toISOString(),
      level: "warn",
      category,
      event: "malformed_log_lines_skipped",
      message: `${malformedLineCount} malformed ${category} log line(s) were skipped.`,
      metadata: { malformedLineCount }
    });
  }
  return entries.slice(-limit);
}

function parseLogLine(line: string): LogEntry | null {
  try {
    return JSON.parse(line) as LogEntry;
  } catch {
    return null;
  }
}

async function readLogTailContent(path: string, limit: number): Promise<string> {
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
  } finally {
    await handle.close();
  }
}
