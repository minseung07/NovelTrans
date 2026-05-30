// Application model. Library + Project (stage rail) routes, loaded project data,
// a global Job, per-stage triage selections, a text-input modal, global
// overlays (help/settings/palette/confirm), and a transient action message.

import type { NovelTransConfig } from "../../domain/config.js";
import type { BookshelfModel, GlossaryQueueFilter, ProjectUiModel } from "../../ui/types.js";
import type { TranslationSessionStatus } from "../../engine/translationSession.js";

export type Stage = "overview" | "source" | "translate" | "glossary" | "qa" | "export";

export type Route = { screen: "library" } | { screen: "project"; projectDir: string; stage: Stage };

export type JobKind = "translate" | "retry";

export interface Job {
  kind: JobKind;
  projectDir: string;
  status: TranslationSessionStatus;
  queued: number;
  completed: number;
  failed: number;
}

export type InputState =
  | {
      kind: "glossary-edit" | "import";
      label: string;
      value: string;
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
  | "export-all"
  | "source-reimport"
  | "review-ignore"
  | "review-retranslate"
  | "review-retranslate-all"
  | "review-retranslate-same-type";

export type Overlay =
  | { kind: "help" }
  | { kind: "settings" }
  | { kind: "palette"; query: string; selected: number }
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
  job: Job | null;
  glossarySelected: number;
  glossaryFilter: GlossaryQueueFilter;
  deferred: string[];
  qaSelected: number;
  sourceSelected: number;
  input: InputState | null;
  overlay: Overlay | null;
  message: string | null;
}

export function initModel(config: NovelTransConfig, library: BookshelfModel): AppModel {
  return {
    config,
    library,
    route: { screen: "library" },
    query: "",
    searching: false,
    selected: 0,
    project: null,
    projectLoading: false,
    job: null,
    glossarySelected: 0,
    glossaryFilter: "all",
    deferred: [],
    qaSelected: 0,
    sourceSelected: 0,
    input: null,
    overlay: null,
    message: null
  };
}
