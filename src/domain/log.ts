export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogCategory = "translation" | "qa" | "glossary" | "export" | "error";

export type LogEntry = {
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  event: string;
  message: string;
  projectId?: string;
  runId?: string;
  episodeId?: string;
  metadata?: Record<string, unknown>;
};
