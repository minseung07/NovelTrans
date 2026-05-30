// State transition messages dispatched by the input layer and effects.

import type { NovelTransConfig } from "../../domain/config.js";
import type { BookshelfModel, GlossaryQueueFilter, ProjectUiModel } from "../../ui/types.js";
import type { TranslationSessionSnapshot } from "../../engine/translationSession.js";
import type { Overlay, Stage } from "./model.js";

type GlossaryOp = "confirm" | "lock" | "forbid" | "discard";
type QaOp = "ignore" | "recheck" | "retranslate";
export type SettingsOp = "cycle-backend" | "cycle-model" | "cycle-strictness" | "inc-concurrency" | "dec-concurrency" | "toggle-txt" | "toggle-epub";
export type ExportToggle = "txt" | "epub" | "appendix" | "afterword" | "vertical";

export type Msg =
  | { type: "move"; delta: number }
  | { type: "open-selected" }
  | { type: "back" }
  | { type: "go-stage"; stage: Stage }
  | { type: "start-translate"; mode: "resume" | "retry-failed" }
  | { type: "translate-pause" }
  | { type: "export-toggle"; what: ExportToggle }
  | { type: "export-generate" }
  | { type: "settings-op"; op: SettingsOp }
  | { type: "start-search" }
  | { type: "search-char"; value: string }
  | { type: "search-backspace" }
  | { type: "end-search" }
  | { type: "open-library-search" }
  | { type: "import-open" }
  | { type: "glossary-filter" }
  | { type: "go-glossary-filter"; filter: GlossaryQueueFilter }
  | { type: "glossary-op"; op: GlossaryOp }
  | { type: "glossary-edit-open" }
  | { type: "qa-op"; op: QaOp }
  | { type: "qa-jump-glossary" }
  | { type: "source-reimport" }
  | { type: "input-char"; value: string }
  | { type: "input-backspace" }
  | { type: "input-cancel" }
  | { type: "input-submit" }
  | { type: "open-overlay"; overlay: Overlay }
  | { type: "close-overlay" }
  | { type: "palette-input"; value: string }
  | { type: "palette-backspace" }
  | { type: "palette-move"; delta: number }
  | { type: "palette-run" }
  | { type: "confirm-yes" }
  | { type: "project-loaded"; model: ProjectUiModel }
  | { type: "project-load-failed"; message: string }
  | { type: "library-loaded"; model: BookshelfModel }
  | { type: "config-updated"; config: NovelTransConfig }
  | { type: "action-done"; message: string }
  | { type: "clear-message" }
  | { type: "job-progress"; snapshot: TranslationSessionSnapshot }
  | { type: "job-done"; snapshot: TranslationSessionSnapshot }
  | { type: "job-failed"; message: string };
