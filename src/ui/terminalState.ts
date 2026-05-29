import type { ReadStream, WriteStream } from "node:tty";
import type { NovelTransConfig } from "../domain/config.js";
import type { AdvancedSettingsItemId, GlossaryQueueFilter, SettingsViewMode, StudioSpace } from "./types.js";

export type TerminalAppOptions = {
  config: NovelTransConfig;
  configDir?: string;
  projectRoot?: string;
  input?: ReadStream;
  output?: WriteStream;
};

export type TerminalState = {
  space: StudioSpace;
  selectedProjectIndex: number;
  selectedTermIndex: number;
  selectedIssueIndex: number;
  selectedCommandIndex: number;
  projectDir: string | null;
  paletteQuery: string;
  searchQuery: string;
  glossaryFilter: GlossaryQueueFilter;
  settingsMode: SettingsViewMode;
  settingsSectionIndex: number;
  selectedSettingsItemIndex: number;
  settingsPickerItemId: AdvancedSettingsItemId | null;
  selectedSettingsOptionIndex: number;
  deferredGlossaryEntryIds: string[];
  previousSpace: StudioSpace;
  message: string | null;
};

export function createInitialTerminalState(): TerminalState {
  return {
    space: "bookshelf",
    selectedProjectIndex: 0,
    selectedTermIndex: 0,
    selectedIssueIndex: 0,
    selectedCommandIndex: 0,
    projectDir: null,
    paletteQuery: "",
    searchQuery: "",
    glossaryFilter: "all",
    settingsMode: "basic",
    settingsSectionIndex: 0,
    selectedSettingsItemIndex: 0,
    settingsPickerItemId: null,
    selectedSettingsOptionIndex: 0,
    deferredGlossaryEntryIds: [],
    previousSpace: "bookshelf",
    message: null
  };
}

export function moveTerminalSelection(state: TerminalState, delta: number, maxIndex = Number.MAX_SAFE_INTEGER): void {
  const nextIndex = (current: number) => Math.max(0, Math.min(maxIndex, current + delta));
  if (state.space === "bookshelf") {
    state.selectedProjectIndex = nextIndex(state.selectedProjectIndex);
  } else if (state.space === "glossary-lab") {
    state.selectedTermIndex = nextIndex(state.selectedTermIndex);
  } else if (state.space === "review-desk") {
    state.selectedIssueIndex = nextIndex(state.selectedIssueIndex);
  } else if (state.space === "command-palette") {
    state.selectedCommandIndex = nextIndex(state.selectedCommandIndex);
  }
}

export function backFromTerminalSpace(state: TerminalState): void {
  if (state.space === "bookshelf") {
    return;
  }
  if (state.space === "settings" || state.space === "help" || state.space === "project-search") {
    state.space = state.previousSpace === "command-palette" ? "bookshelf" : state.previousSpace;
    return;
  }
  state.space = state.projectDir ? "studio" : "bookshelf";
}
