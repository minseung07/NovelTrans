export type NovelTransConfig = {
  projectRoot: string;
  defaultBackend: "dry-run" | "openai-compatible" | "codex-cli";
  defaultModel: string;
  translationStyle: TranslationStyle;
  concurrency: number;
  outputFormats: Array<"txt" | "epub">;
  glossaryStrictness: "low" | "medium" | "high" | "strict";
  qa: {
    japaneseRemaining: boolean;
    numberMismatch: boolean;
    lengthRatio: boolean;
    glossary: boolean;
  };
  epub: {
    includeGlossaryAppendix: boolean;
    includeAfterword: boolean;
    verticalWriting: boolean;
  };
  openAICompatible: {
    baseUrl: string;
    model: string;
    temperature: number;
    reasoningEffort: "low" | "medium" | "high" | "xhigh";
    timeoutMs: number;
  };
  codexCli: {
    command: string;
    model?: string;
    timeoutMs: number;
    sandbox: "read-only" | "workspace-write";
  };
  logLevel: "debug" | "info" | "warn" | "error";
};

export type TranslationStyle =
  | "fast-draft"
  | "balanced-webnovel"
  | "literary-naturalization"
  | "literal-preserve"
  | "terminology-consistency"
  | "custom";
