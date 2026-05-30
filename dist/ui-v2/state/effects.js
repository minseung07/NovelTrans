// Effects: side-effecting work described as data by `update` and executed here.
// Translation jobs are driven via TranslationSession (progress polled). Glossary
// /QA/export/import/config actions reuse existing functions, then refresh the
// project or library so the UI reflects the change.
import { confirmSelectedGlossaryTerm, forbidSelectedGlossaryTarget, discardSelectedGlossaryTerm, exportGlossaryJson, relatedTermsForEpisode } from "../../ui/actions/glossaryActions.js";
import { markSelectedIssueIgnored, openSelectedIssueTranslation, recheckReviewDeskQA, retrySelectedIssueEpisodeResult, retryIssueEpisodesResult } from "../../ui/actions/reviewActions.js";
import { toggleOutputFormat, toggleGlossaryAppendix, toggleAfterword, toggleVerticalWriting, generateConfiguredExports, generateAllExports } from "../../ui/actions/exportActions.js";
import { errorLogPath, skipFailedAndExport } from "../../ui/actions/failureActions.js";
import { cycleActiveBackendModel, cycleDefaultBackend, cycleGlossaryStrictness, adjustConcurrency, toggleDefaultOutputFormat } from "../../ui/actions/settingsActions.js";
import { importSourceForUi } from "../../ui/actions/importActions.js";
import { createProjectAdapter, createProjectTranslationSession } from "../../ui/actions/translationJobActions.js";
import { loadProjectUiModel } from "../data/project.js";
import { loadBookshelfModel } from "../data/library.js";
const POLL_INTERVAL_MS = 200;
export function createEffectRunner(deps) {
    let session = null;
    let currentConfig = deps.config;
    let poll = null;
    const stopPoll = () => {
        if (poll) {
            clearInterval(poll);
            poll = null;
        }
    };
    const runtime = () => ({ config: currentConfig, configDir: deps.configDir });
    const refreshProject = async (projectDir, dispatch) => {
        dispatch({ type: "project-loaded", model: await loadProjectUiModel(projectDir) });
    };
    const refreshLibrary = async (dispatch) => {
        dispatch({ type: "library-loaded", model: await loadBookshelfModel(deps.projectRoot) });
    };
    const runAndRefresh = (projectDir, run, dispatch) => {
        void (async () => {
            try {
                const message = await run();
                await refreshProject(projectDir, dispatch);
                await refreshLibrary(dispatch);
                dispatch({ type: "action-done", message });
            }
            catch (error) {
                dispatch({ type: "action-done", message: error.message });
            }
        })();
    };
    const runGlossary = (effect) => {
        const { projectDir, model, selectedIndex, filter, deferred, target } = effect;
        if (effect.op === "confirm") {
            return confirmSelectedGlossaryTerm(projectDir, model, selectedIndex, target ?? "", false, filter, deferred);
        }
        if (effect.op === "lock") {
            return confirmSelectedGlossaryTerm(projectDir, model, selectedIndex, target ?? "", true, filter, deferred);
        }
        if (effect.op === "forbid") {
            return forbidSelectedGlossaryTarget(projectDir, model, selectedIndex, target ?? "", filter, deferred);
        }
        return discardSelectedGlossaryTerm(projectDir, model, selectedIndex, filter, deferred);
    };
    const runQa = async (effect) => {
        const { projectDir, model, selectedIndex } = effect;
        if (effect.op === "ignore") {
            return markSelectedIssueIgnored(projectDir, model, selectedIndex);
        }
        if (effect.op === "recheck") {
            return recheckReviewDeskQA(projectDir, undefined, currentConfig.qa);
        }
        return (await retrySelectedIssueEpisodeResult(projectDir, model, selectedIndex, await createProjectAdapter(projectDir, runtime()), undefined, currentConfig.qa)).message;
    };
    const runQaBatch = async (effect) => {
        return (await retryIssueEpisodesResult(effect.projectDir, effect.model, effect.selectedIndex, effect.scope, await createProjectAdapter(effect.projectDir, runtime()), undefined, currentConfig.qa)).message;
    };
    const runExportToggle = async (projectDir, what) => {
        if (what === "txt" || what === "epub") {
            await toggleOutputFormat(projectDir, what);
        }
        else if (what === "appendix") {
            await toggleGlossaryAppendix(projectDir);
        }
        else if (what === "afterword") {
            await toggleAfterword(projectDir);
        }
        else {
            await toggleVerticalWriting(projectDir);
        }
    };
    const runConfig = (op, config) => {
        const dir = deps.configDir;
        if (op === "cycle-backend")
            return cycleDefaultBackend(config, dir);
        if (op === "cycle-model")
            return cycleActiveBackendModel(config, dir);
        if (op === "cycle-strictness")
            return cycleGlossaryStrictness(config, dir);
        if (op === "inc-concurrency")
            return adjustConcurrency(config, 1, dir);
        if (op === "dec-concurrency")
            return adjustConcurrency(config, -1, dir);
        return toggleDefaultOutputFormat(config, op === "toggle-txt" ? "txt" : "epub", dir);
    };
    return (effect, dispatch) => {
        if (effect.kind === "load-project") {
            loadProjectUiModel(effect.projectDir)
                .then((model) => dispatch({ type: "project-loaded", model }))
                .catch((error) => dispatch({ type: "project-load-failed", message: error.message }));
            return;
        }
        if (effect.kind === "load-library") {
            loadBookshelfModel(deps.projectRoot)
                .then((model) => dispatch({ type: "library-loaded", model }))
                .catch((error) => dispatch({ type: "action-done", message: error.message }));
            return;
        }
        if (effect.kind === "glossary-action") {
            runAndRefresh(effect.projectDir, () => runGlossary(effect), dispatch);
            return;
        }
        if (effect.kind === "glossary-export") {
            runAndRefresh(effect.projectDir, () => exportGlossaryJson(effect.projectDir), dispatch);
            return;
        }
        if (effect.kind === "qa-action") {
            runAndRefresh(effect.projectDir, () => runQa(effect), dispatch);
            return;
        }
        if (effect.kind === "qa-batch-action") {
            runAndRefresh(effect.projectDir, () => runQaBatch(effect), dispatch);
            return;
        }
        if (effect.kind === "review-open-translation") {
            runAndRefresh(effect.projectDir, () => openSelectedIssueTranslation(effect.projectDir, effect.model, effect.selectedIndex), dispatch);
            return;
        }
        if (effect.kind === "related-terms") {
            dispatch({ type: "action-done", message: relatedTermsForEpisode(effect.model, null) });
            return;
        }
        if (effect.kind === "show-error-log") {
            dispatch({ type: "action-done", message: errorLogPath(effect.projectDir) });
            return;
        }
        if (effect.kind === "export-toggle") {
            void (async () => {
                try {
                    await runExportToggle(effect.projectDir, effect.what);
                    await refreshProject(effect.projectDir, dispatch);
                    await refreshLibrary(dispatch);
                }
                catch (error) {
                    dispatch({ type: "action-done", message: error.message });
                }
            })();
            return;
        }
        if (effect.kind === "export") {
            runAndRefresh(effect.projectDir, () => (effect.mode === "all" ? generateAllExports(effect.projectDir) : generateConfiguredExports(effect.projectDir)), dispatch);
            return;
        }
        if (effect.kind === "skip-export") {
            runAndRefresh(effect.projectDir, () => skipFailedAndExport(effect.projectDir), dispatch);
            return;
        }
        if (effect.kind === "import") {
            void (async () => {
                try {
                    const message = await importSourceForUi(effect.source, currentConfig, deps.projectRoot, { webImport: effect.webImport });
                    await refreshLibrary(dispatch);
                    dispatch({ type: "action-done", message });
                }
                catch (error) {
                    dispatch({ type: "action-done", message: error.message });
                }
            })();
            return;
        }
        if (effect.kind === "config") {
            void (async () => {
                try {
                    currentConfig = await runConfig(effect.op, currentConfig);
                    dispatch({ type: "config-updated", config: currentConfig });
                }
                catch (error) {
                    dispatch({ type: "action-done", message: error.message });
                }
            })();
            return;
        }
        if (effect.kind === "cancel-job") {
            stopPoll();
            session?.cancel();
            return;
        }
        if (effect.kind === "pause-job") {
            session?.pause();
            return;
        }
        if (effect.kind === "resume-job") {
            session?.resume();
            return;
        }
        if (effect.kind === "dismiss") {
            const timer = setTimeout(() => dispatch({ type: "clear-message" }), 3000);
            return () => clearTimeout(timer);
        }
        void (async () => {
            try {
                session = await createProjectTranslationSession(effect.projectDir, effect.mode, runtime());
                const done = session.start();
                poll = setInterval(() => {
                    if (session) {
                        dispatch({ type: "job-progress", snapshot: session.snapshot() });
                    }
                }, POLL_INTERVAL_MS);
                const snapshot = await done;
                stopPoll();
                dispatch({ type: "job-done", snapshot });
            }
            catch (error) {
                stopPoll();
                dispatch({ type: "job-failed", message: error.message });
            }
        })();
        return () => {
            stopPoll();
            session?.cancel();
        };
    };
}
