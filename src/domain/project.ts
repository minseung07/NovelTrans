export type EpisodeStatus = "pending" | "running" | "completed" | "failed" | "skipped";

type ProjectStatus =
  | "created"
  | "analyzed"
  | "ready"
  | "translating"
  | "paused"
  | "completed"
  | "completed_with_issues"
  | "failed"
  | "exported";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type ProjectMetadata = {
  id: string;
  name: string;
  originalTitle: string;
  author?: string;
  sourcePath: string;
  sourceUrl?: string;
  projectDir: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  options: {
    backend: string;
    model?: string;
    translationStyle?: import("./config.js").TranslationStyle;
    concurrency: number;
    glossaryStrictness: "low" | "medium" | "high" | "strict";
    qa?: import("./config.js").NovelTransConfig["qa"];
  };
  outputOptions: {
    formats: Array<"txt" | "epub">;
    includeGlossaryAppendix: boolean;
    includeAfterword: boolean;
    verticalWriting: boolean;
    coverImagePath?: string;
  };
  policy: {
    userConfirmedRights: boolean;
  };
};

export type EpisodeState = {
  episodeId: string;
  episodeNo: number;
  title: string;
  status: EpisodeStatus;
  attempts: number;
  errorMessage: string | null;
  updatedAt: string;
};

export type ProjectOverview = {
  metadata: ProjectMetadata;
  episodeStates: EpisodeState[];
  counts: Record<EpisodeStatus, number>;
  qaIssueCount: number;
  glossaryCandidateCount: number;
  glossaryConflictCount: number;
};

export type RunRecord = {
  id: string;
  projectId: string;
  type: "translate" | "retry" | "export" | "qa" | "glossary";
  startedAt: string;
  endedAt?: string;
  status: "running" | "completed" | "failed" | "cancelled";
  backend?: string;
  model?: string;
  episodeCount?: number;
  errorMessage?: string;
};
