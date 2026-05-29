import { loadOpenAICompatibleApiKey } from "../config/credentialStore.js";
import { loadBookshelfModel } from "./studioData.js";
import { renderBookshelfScreen } from "./screens/bookshelfScreen.js";
import { renderResponsiveStudioScreen } from "./screens/studioScreen.js";
import { renderResponsiveGlossaryLabScreen } from "./screens/glossaryLabScreen.js";
import { renderReviewDeskScreen } from "./screens/reviewDeskScreen.js";
import { renderExportRoomScreen } from "./screens/exportRoomScreen.js";
import { renderFailureRecoveryScreen } from "./screens/failureRecoveryScreen.js";
import { renderCommandPaletteScreen } from "./screens/commandPaletteScreen.js";
import { renderHelpScreen } from "./screens/helpScreen.js";
import { renderProjectSearchScreen } from "./screens/searchScreen.js";
import { renderSettingsScreen } from "./screens/settingsScreen.js";
export async function renderTerminalScreen(input) {
    const { state } = input;
    const width = input.viewport?.width;
    if (state.space === "bookshelf") {
        return renderBookshelfScreen(await loadBookshelfModel(input.projectRoot), state.selectedProjectIndex, width);
    }
    if (state.space === "project-search") {
        return renderProjectSearchScreen(await loadBookshelfModel(input.projectRoot), state.searchQuery, state.selectedProjectIndex, width);
    }
    if (state.space === "settings") {
        return renderSettingsScreen(input.config, width, state.settingsMode, {
            openAICompatibleApiKey: openAICompatibleApiKeyState(input.configDir)
        }, state.settingsSectionIndex, state.selectedSettingsItemIndex, state.settingsPickerItemId, state.selectedSettingsOptionIndex);
    }
    if (state.space === "help") {
        return renderHelpScreen(width);
    }
    if (state.space === "command-palette") {
        return renderCommandPaletteScreen(state.paletteQuery, Boolean(state.projectDir), state.selectedCommandIndex, width);
    }
    const model = await input.loadProjectModel();
    if (state.space === "glossary-lab") {
        return renderResponsiveGlossaryLabScreen(model, state.selectedTermIndex, state.glossaryFilter, state.deferredGlossaryEntryIds, width, input.viewport?.height);
    }
    if (state.space === "review-desk") {
        return renderReviewDeskScreen(model, state.selectedIssueIndex, width);
    }
    if (state.space === "export-room") {
        return renderExportRoomScreen(model, width);
    }
    if (state.space === "failure-recovery") {
        return renderFailureRecoveryScreen(model, width);
    }
    return renderResponsiveStudioScreen(model, input.session, width, input.viewport?.height, input.task);
}
function openAICompatibleApiKeyState(configDir) {
    if (process.env.OPENAI_API_KEY) {
        return "environment";
    }
    try {
        return loadOpenAICompatibleApiKey(configDir) ? "stored" : "missing";
    }
    catch {
        return "unreadable";
    }
}
