// Application model. Library + Project (stage rail) routes, loaded project data,
// per-project Jobs, per-stage triage selections, a text-input modal, global
// overlays (help/settings/palette/confirm), and a transient action message.

import type { NovelTransConfig } from "../../domain/config.js";
import type { BookshelfModel, GlossaryQueueFilter, ProjectUiModel, ReviewIssueFilter } from "../../ui/types.js";
import type { TranslationSessionStatus } from "../../engine/translationSession.js";
import type { Severity } from "../theme/theme.js";

export interface AppMessage {
  text: string;
  level: Severity;
}

export type Stage = "overview" | "source" | "translate" | "glossary" | "qa" | "export";

type Route = { screen: "library" } | { screen: "project"; projectDir: string; stage: Stage };

type JobKind = "translate" | "retry" | "export" | "web-import" | "qa-retranslate" | "qa-batch-retranslate";

export interface Job {
  kind: JobKind;
  projectDir: string;
  status: TranslationSessionStatus;
  queued: number;
  completed: number;
  failed: number;
  label?: string;
  current?: string | null;
  episodeIds?: string[];
}

type InputState =
  | {
      kind: "glossary-edit" | "import" | "api-key" | "base-url";
      label: string;
      value: string;
      mask?: boolean;
    }
  | {
      kind: "web-import-episodes";
      label: string;
      value: string;
      url: string;
    };

export type ConfirmAction =
  | "skip-export"
  | "retry-failed"
  | "quit"
  | "export-all"
  | "export-configured"
  | "web-import"
  | "dry-run-resume"
  | "dry-run-retry"
  | "review-ignore"
  | "review-retranslate"
  | "review-retranslate-all"
  | "review-retranslate-same-type";

export type SetupStep = "engine" | "model" | "credentials" | "validate";

export interface SetupValidation {
  state: "idle" | "checking" | "ok" | "fail";
  message: string;
}

export type Overlay =
  | { kind: "help" }
  | { kind: "settings" }
  | { kind: "palette"; query: string; selected: number }
  | { kind: "notice"; message: string; level: Severity }
  | { kind: "setup"; step: SetupStep; validation: SetupValidation }
  | { kind: "confirm"; message: string; action: ConfirmAction };

export interface AppModel {
  config: NovelTransConfig;
  library: BookshelfModel;
  route: Route;
  query: string;
  searching: boolean;
  selected: number;
  project: ProjectUiModel | null;
  projectLoading: boolean;
  jobsByProjectDir: Record<string, Job>;
  importJob: Job | null;
  glossarySelected: number;
  glossaryFilter: GlossaryQueueFilter;
  deferred: string[];
  qaSelected: number;
  qaFilter: ReviewIssueFilter;
  sourceSelected: number;
  input: InputState | null;
  overlay: Overlay | null;
  message: AppMessage | null;
  tick: number;
  dryRunAcknowledged: boolean;
  hasApiKey: boolean;
  libraryLoading: boolean;
}

export function initModel(config: NovelTransConfig, library: BookshelfModel, hasApiKey = false): AppModel {
  return {
    config,
    library,
    route: { screen: "library" },
    query: "",
    searching: false,
    selected: 0,
    project: null,
    projectLoading: false,
    jobsByProjectDir: {},
    importJob: null,
    glossarySelected: 0,
    glossaryFilter: "all",
    deferred: [],
    qaSelected: 0,
    qaFilter: "all",
    sourceSelected: 0,
    input: null,
    overlay: null,
    message: null,
    tick: 0,
    dryRunAcknowledged: false,
    hasApiKey,
    libraryLoading: false
  };
}
