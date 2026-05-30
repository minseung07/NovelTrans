// Static (non-interactive) renderers used by CLI subcommands. They build a
// throwaway model and reuse the v2 pure views, so command output matches the
// interactive app. Theme is detected from stdout (honors NO_COLOR/TERM=dumb).
import { createTheme, setTheme } from "./theme/theme.js";
import { detectColorLevel, detectUnicode } from "./theme/capabilities.js";
import { initModel } from "./state/model.js";
import { renderLibrary } from "./screens/library.js";
import { renderProject } from "./screens/project/index.js";
import { renderPalette } from "./screens/overlays.js";
import { loadBookshelfModel } from "./data/library.js";
import { loadProjectUiModel } from "./data/project.js";
const STATIC_ROWS = 200;
const emptyLibrary = { projectRoot: "", continueProject: null, allProjects: [], recentProjects: [], problemProjects: [] };
function applyTheme() {
    setTheme(createTheme(detectColorLevel(process.stdout), detectUnicode(process.stdout)));
}
function width() {
    return Math.min(process.stdout.columns ?? 80, 100);
}
export async function renderLibraryStatic(config, projectRoot) {
    applyTheme();
    const library = await loadBookshelfModel(projectRoot);
    return renderLibrary(initModel(config, library), width(), STATIC_ROWS).join("\n");
}
export async function renderProjectStageStatic(config, projectDir, stage) {
    applyTheme();
    const project = await loadProjectUiModel(projectDir);
    const model = { ...initModel(config, emptyLibrary), route: { screen: "project", projectDir, stage }, project };
    return renderProject(model, width(), STATIC_ROWS).join("\n");
}
export function renderPaletteStatic(query, hasProject) {
    applyTheme();
    return renderPalette(query, 0, hasProject, width()).join("\n");
}
