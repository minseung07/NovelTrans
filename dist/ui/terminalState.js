export function createInitialTerminalState() {
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
export function moveTerminalSelection(state, delta, maxIndex = Number.MAX_SAFE_INTEGER) {
    const nextIndex = (current) => Math.max(0, Math.min(maxIndex, current + delta));
    if (state.space === "bookshelf") {
        state.selectedProjectIndex = nextIndex(state.selectedProjectIndex);
    }
    else if (state.space === "glossary-lab") {
        state.selectedTermIndex = nextIndex(state.selectedTermIndex);
    }
    else if (state.space === "review-desk") {
        state.selectedIssueIndex = nextIndex(state.selectedIssueIndex);
    }
    else if (state.space === "command-palette") {
        state.selectedCommandIndex = nextIndex(state.selectedCommandIndex);
    }
}
export function backFromTerminalSpace(state) {
    if (state.space === "bookshelf") {
        return;
    }
    if (state.space === "settings" || state.space === "help" || state.space === "project-search") {
        state.space = state.previousSpace === "command-palette" ? "bookshelf" : state.previousSpace;
        return;
    }
    state.space = state.projectDir ? "studio" : "bookshelf";
}
