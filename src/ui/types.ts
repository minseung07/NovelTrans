import type { LogEntry } from "../domain/log.js";
import type { Episode } from "../domain/episode.js";
import type { GlossaryData, GlossaryEntry } from "../domain/glossary.js";
import type { ProjectOverview } from "../domain/project.js";
import type { QAIssue } from "../domain/qa.js";

export type BookshelfProject = {
  projectDir: string;
  title: string;
  completed: number;
  total: number;
  failed: number;
  running: number;
  skipped: number;
  qaIssues: number;
  candidates: number;
  conflicts: number;
  txtExists: boolean;
  epubExists: boolean;
  shelfStatusLabel: string;
  nextActionLabel: string;
  statusText: string;
  updatedAt: string;
};

export type BookshelfModel = {
  projectRoot: string;
  continueProject: BookshelfProject | null;
  allProjects: BookshelfProject[];
  recentProjects: BookshelfProject[];
  problemProjects: BookshelfProject[];
};

export type GlossaryPulse = {
  confirmed: number;
  locked: number;
  candidates: number;
  conflicts: number;
  forbiddenViolations: number;
  topConflict: string | null;
  healthScore: number;
  lockCoveragePercent: number;
};

export type ExportPreview = {
  title: string;
  episodeCount: number;
  translatedEpisodeCount: number;
  glossaryAppendixCount: number;
  expectedTxtPath: string;
  expectedEpubPath: string;
  txtExists: boolean;
  epubExists: boolean;
};

export type SourceStatus = {
  sourcePath: string;
  originalTitle: string;
  languageGuess: string;
  characterCount: number;
  episodeCount: number;
  structureLabel: string;
  longEpisodeCount: number;
  afterwordCount: number;
  warnings: string[];
};

export type StudioQueueItem = {
  episodeNo: number;
  title: string;
  status: string;
  detail: string;
};

export type StudioQueue = {
  active: StudioQueueItem[];
  next: StudioQueueItem[];
  failed: StudioQueueItem[];
  skipped: StudioQueueItem[];
};

export type ProjectTimelineItem = {
  timestamp: string;
  label: string;
  severity: "info" | "warning" | "error";
};

type ReviewIssueBucket = {
  id: ReviewIssueBucketId;
  label: string;
  count: number;
};

export type ReviewIssueBucketId = "missing" | "japanese" | "names" | "terms" | "numbers" | "length" | "other";

export type ReviewIssueFilter = "all" | ReviewIssueBucketId;

export type ReviewEpisodeGroup = {
  episodeId: string;
  episodeNo: number | null;
  title: string;
  issues: QAIssue[];
};

export type ReviewDeskModel = {
  openIssues: QAIssue[];
  buckets: ReviewIssueBucket[];
  episodeGroups: ReviewEpisodeGroup[];
};

export type ProjectUiModel = {
  overview: ProjectOverview;
  episodes: Episode[];
  glossary: GlossaryData;
  glossaryPulse: GlossaryPulse;
  qaIssues: QAIssue[];
  sourceStatus: SourceStatus;
  studioQueue: StudioQueue;
  timeline: ProjectTimelineItem[];
  reviewDesk: ReviewDeskModel;
  liveEvents: LogEntry[];
  exportPreview: ExportPreview;
  nextActions: NextActionRecommendation[];
  failureRecovery: FailureRecoveryModel;
};

export type GlossaryQueueItem = {
  entry: GlossaryEntry;
  label: string;
  priority: number;
};

export type GlossaryQueueFilter = "all" | "conflicts" | "candidates" | "confirmed";

export type PaletteCommand = {
  id: string;
  label: string;
  hint: string;
  requiresProject: boolean;
  requiresConfirmation?: boolean;
};

export type NextActionRecommendation = {
  priority: number;
  severity: "info" | "warning" | "critical";
  commandId: string;
  message: string;
  commandHint: string;
};

type FailureRecoveryItem = {
  episodeId: string;
  episodeNo: number;
  title: string;
  reason: string;
  attempts: number;
  updatedAt: string;
};

export type FailureRecoveryModel = {
  failedCount: number;
  items: FailureRecoveryItem[];
  logPath: string;
};
