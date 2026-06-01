// Effects: side-effecting work described as data by `update` and executed here.
// Translation jobs are driven via TranslationSession (progress polled). Glossary
// /QA/export/import/config actions reuse existing functions, then refresh the
// project or library so the UI reflects the change.

import type { Dispatch } from "../runtime/loop.js";
import type { NovelTransConfig } from "../../domain/config.js";
import type { TranslationSession, TranslationSessionSnapshot, TranslationSessionStatus } from "../../engine/translationSession.js";
import type { GlossaryQueueFilter, ProjectUiModel, ReviewIssueFilter } from "../../ui/types.js";
import { confirmSelectedGlossaryTerm, forbidSelectedGlossaryTarget, discardSelectedGlossaryTerm, exportGlossaryJson, relatedTermsForEpisode } from "../../ui/actions/glossaryActions.js";
import {
  markSelectedIssueIgnored,
  openSelectedIssueTranslation,
  recheckReviewDeskQA,
  retrySelectedIssueEpisodeResult,
  retryIssueEpisodesResult,
  type RetryIssueProgress,
  type RetryIssueScope
} from "../../ui/actions/reviewActions.js";
import { toggleOutputFormat, toggleGlossaryAppendix, toggleAfterword, toggleVerticalWriting, generateConfiguredExports, generateAllExports } from "../../ui/actions/exportActions.js";
import { errorLogPath, skipFailedAndExport } from "../../ui/actions/failureActions.js";
import { cycleActiveBackendModel, cycleDefaultBackend, cycleGlossaryStrictness, adjustConcurrency, toggleDefaultOutputFormat } from "../../ui/actions/settingsActions.js";
import { importSourceForUi, importBaseOptions, type UiWebImportOptions } from "../../ui/actions/importActions.js";
import { WebImportService, webImportConsentMessage } from "../../webImport/webImportService.js";
import type { WebImportPreview } from "../../webImport/types.js";
import { createProjectAdapter, createProjectTranslationSession } from "../../ui/actions/translationJobActions.js";
import { createTranslatorAdapter } from "../../translation/adapters/adapterFactory.js";
import { saveOpenAICompatibleApiKey } from "../../config/credentialStore.js";
import { saveConfig } from "../../config/configStore.js";
import { loadProjectUiModel } from "../data/project.js";
import { loadBookshelfModel } from "../data/library.js";
import type { Msg, SettingsOp, ExportToggle } from "./msg.js";

export type Effect =
  | { kind: "load-project"; projectDir: string }
  | { kind: "load-library" }
  | { kind: "start-job"; projectDir: string; mode: "resume" | "retry-failed" }
  | { kind: "cancel-job"; projectDir: string }
  | { kind: "pause-job"; projectDir: string }
  | { kind: "resume-job"; projectDir: string }
  | { kind: "glossary-action"; op: "confirm" | "lock" | "forbid" | "discard"; projectDir: string; model: ProjectUiModel; selectedIndex: number; filter: GlossaryQueueFilter; deferred: string[]; target: string | null; entryId?: string }
  | { kind: "glossary-export"; projectDir: string }
  | { kind: "qa-action"; op: "ignore" | "recheck" | "retranslate"; projectDir: string; model: ProjectUiModel; selectedIndex: number; filter: ReviewIssueFilter; excludeEpisodeIds?: string[] }
  | { kind: "qa-batch-action"; scope: RetryIssueScope; projectDir: string; model: ProjectUiModel; selectedIndex: number; filter: ReviewIssueFilter }
  | { kind: "review-open-translation"; projectDir: string; model: ProjectUiModel; selectedIndex: number; filter: ReviewIssueFilter }
  | { kind: "related-terms"; model: ProjectUiModel }
  | { kind: "show-error-log"; projectDir: string }
  | { kind: "export-toggle"; projectDir: string; what: ExportToggle }
  | { kind: "export"; projectDir: string; mode: "configured" | "all" }
  | { kind: "skip-export"; projectDir: string }
  | { kind: "import"; source: string; webImport?: UiWebImportOptions }
  | { kind: "web-import-preview"; url: string; episodes: string }
  | { kind: "web-import-run" }
  | { kind: "config"; op: SettingsOp }
  | { kind: "save-api-key"; apiKey: string }
  | { kind: "save-base-url"; baseUrl: string }
  | { kind: "setup-validate"; real: boolean }
  | { kind: "dismiss" };

interface EffectDeps {
  config: NovelTransConfig;
  configDir?: string;
  projectRoot: string;
}

const POLL_INTERVAL_MS = 200;
const TICK_INTERVAL_MS = 120;

export function createEffectRunner(deps: EffectDeps): (effect: Effect, dispatch: Dispatch<Msg>) => void | (() => void) {
  const sessions = new Map<string, TranslationSession>();
  const qaControllers = new Map<string, AbortController>();
  let currentConfig = deps.config;
  const polls = new Map<string, NodeJS.Timeout>();
  let dismissTimer: NodeJS.Timeout | null = null;
  const clearDismissTimer = () => {
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
  };
  const stopPoll = (projectDir: string) => {
    const poll = polls.get(projectDir);
    if (poll) {
      clearInterval(poll);
      polls.delete(projectDir);
    }
  };
  let ticker: NodeJS.Timeout | null = null;
  let tickerRefs = 0;
  const stopTicker = () => {
    tickerRefs = Math.max(0, tickerRefs - 1);
    if (tickerRefs > 0) {
      return;
    }
    if (ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  };
  const startTicker = (dispatch: Dispatch<Msg>) => {
    tickerRefs += 1;
    if (!ticker) {
      ticker = setInterval(() => dispatch({ type: "tick" }), TICK_INTERVAL_MS);
    }
  };
  let pendingWebImport: WebImportPreview | null = null;
  const runtime = () => ({ config: currentConfig, configDir: deps.configDir });

  const refreshProject = async (projectDir: string, dispatch: Dispatch<Msg>) => {
    dispatch({ type: "project-loaded", model: await loadProjectUiModel(projectDir) });
  };
  const refreshLibrary = async (dispatch: Dispatch<Msg>) => {
    dispatch({ type: "library-loaded", model: await loadBookshelfModel(deps.projectRoot) });
  };
  const runAndRefresh = (projectDir: string, run: () => Promise<string>, dispatch: Dispatch<Msg>) => {
    void (async () => {
      try {
        const message = await run();
        await refreshProject(projectDir, dispatch);
        await refreshLibrary(dispatch);
        dispatch({ type: "action-done", message, level: "success" });
      } catch (error) {
        dispatch({ type: "action-done", message: (error as Error).message, level: "critical" });
      }
    })();
  };

  const runGlossary = (effect: Extract<Effect, { kind: "glossary-action" }>): Promise<string> => {
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

  const runQa = async (effect: Extract<Effect, { kind: "qa-action" }>): Promise<string> => {
    const { projectDir, model, selectedIndex, filter } = effect;
    if (effect.op === "ignore") {
      return markSelectedIssueIgnored(projectDir, model, selectedIndex, filter);
    }
    if (effect.op === "recheck") {
      return recheckReviewDeskQA(projectDir, undefined, currentConfig.qa, { excludeEpisodeIds: effect.excludeEpisodeIds });
    }
    return (await retrySelectedIssueEpisodeResult(projectDir, model, selectedIndex, await createProjectAdapter(projectDir, runtime()), undefined, currentConfig.qa, filter)).message;
  };

  const qaSnapshot = (progress: RetryIssueProgress, status: TranslationSessionStatus): TranslationSessionSnapshot => ({
    status,
    queued: progress.total,
    completed: progress.completed,
    failed: progress.failed,
    skipped: progress.cancelled,
    currentEpisodeTitle: status === "running" ? progress.currentEpisodeTitle : null,
    activeEpisodeNos: [],
    activeEpisodeTitles: status === "running" && progress.currentEpisodeTitle ? [progress.currentEpisodeTitle] : [],
    message: null
  });

  const runQaRetranslateJob = (effect: (Extract<Effect, { kind: "qa-action" }> & { op: "retranslate" }) | Extract<Effect, { kind: "qa-batch-action" }>, dispatch: Dispatch<Msg>) => {
    if (sessions.has(effect.projectDir) || qaControllers.has(effect.projectDir)) {
      return;
    }
    const controller = new AbortController();
    qaControllers.set(effect.projectDir, controller);
    startTicker(dispatch);
    void (async () => {
      const progressState: { last: RetryIssueProgress | null } = { last: null };
      const onProgress = (progress: RetryIssueProgress) => {
        progressState.last = progress;
        dispatch({ type: "job-progress", projectDir: effect.projectDir, snapshot: qaSnapshot(progress, "running") });
      };
      try {
        const adapter = await createProjectAdapter(effect.projectDir, runtime());
        const result =
          effect.kind === "qa-batch-action"
            ? await retryIssueEpisodesResult(effect.projectDir, effect.model, effect.selectedIndex, effect.scope, adapter, controller.signal, currentConfig.qa, effect.filter, onProgress)
            : await retrySelectedIssueEpisodeResult(effect.projectDir, effect.model, effect.selectedIndex, adapter, controller.signal, currentConfig.qa, effect.filter, onProgress);
        const total = progressState.last?.total ?? (result.episodeId ? result.episodeId.split(",").filter(Boolean).length : 0);
        const progress: RetryIssueProgress = {
          total,
          completed: result.completed,
          failed: result.failed,
          cancelled: result.cancelled,
          currentEpisodeId: null,
          currentEpisodeTitle: null
        };
        const status: TranslationSessionStatus = controller.signal.aborted || result.cancelled > 0 ? "cancelled" : result.failed > 0 ? "failed" : "completed";
        dispatch({ type: "job-done", projectDir: effect.projectDir, snapshot: qaSnapshot(progress, status) });
        dispatch({ type: "action-done", message: result.message, level: status === "completed" ? "success" : "warning" });
      } catch (error) {
        dispatch({ type: "job-failed", projectDir: effect.projectDir, message: (error as Error).message });
      } finally {
        qaControllers.delete(effect.projectDir);
        stopTicker();
      }
    })();
    return () => {
      controller.abort();
      stopTicker();
    };
  };

  const runExportToggle = async (projectDir: string, what: ExportToggle): Promise<void> => {
    if (what === "txt" || what === "epub") {
      await toggleOutputFormat(projectDir, what);
    } else if (what === "appendix") {
      await toggleGlossaryAppendix(projectDir);
    } else if (what === "afterword") {
      await toggleAfterword(projectDir);
    } else {
      await toggleVerticalWriting(projectDir);
    }
  };

  const runConfig = (op: SettingsOp, config: NovelTransConfig): Promise<NovelTransConfig> => {
    const dir = deps.configDir;
    if (op === "cycle-backend") return cycleDefaultBackend(config, dir);
    if (op === "cycle-model") return cycleActiveBackendModel(config, dir);
    if (op === "cycle-strictness") return cycleGlossaryStrictness(config, dir);
    if (op === "inc-concurrency") return adjustConcurrency(config, 1, dir);
    if (op === "dec-concurrency") return adjustConcurrency(config, -1, dir);
    return toggleDefaultOutputFormat(config, op === "toggle-txt" ? "txt" : "epub", dir);
  };

  return (effect, dispatch) => {
    if (effect.kind === "load-project") {
      loadProjectUiModel(effect.projectDir)
        .then((model) => dispatch({ type: "project-loaded", model }))
        .catch((error: unknown) => dispatch({ type: "project-load-failed", message: (error as Error).message }));
      return;
    }
    if (effect.kind === "load-library") {
      loadBookshelfModel(deps.projectRoot)
        .then((model) => dispatch({ type: "library-loaded", model }))
        .catch((error: unknown) => dispatch({ type: "action-done", message: (error as Error).message }));
      return;
    }
    if (effect.kind === "glossary-action") {
      void (async () => {
        try {
          await runGlossary(effect);
          await refreshProject(effect.projectDir, dispatch);
          await refreshLibrary(dispatch);
        } catch (error) {
          const message = (error as Error).message;
          if (effect.entryId) {
            dispatch({ type: "glossary-action-failed", entryId: effect.entryId, message });
          } else {
            dispatch({ type: "action-done", message, level: "critical" });
          }
        }
      })();
      return;
    }
    if (effect.kind === "glossary-export") {
      runAndRefresh(effect.projectDir, () => exportGlossaryJson(effect.projectDir), dispatch);
      return;
    }
    if (effect.kind === "qa-action") {
      if (effect.op === "retranslate") {
        return runQaRetranslateJob(effect as Extract<Effect, { kind: "qa-action" }> & { op: "retranslate" }, dispatch);
      }
      runAndRefresh(effect.projectDir, () => runQa(effect), dispatch);
      return;
    }
    if (effect.kind === "qa-batch-action") {
      return runQaRetranslateJob(effect, dispatch);
    }
    if (effect.kind === "review-open-translation") {
      runAndRefresh(effect.projectDir, () => openSelectedIssueTranslation(effect.projectDir, effect.model, effect.selectedIndex, effect.filter), dispatch);
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
        } catch (error) {
          dispatch({ type: "action-done", message: (error as Error).message, level: "critical" });
        }
      })();
      return;
    }
    if (effect.kind === "export") {
      startTicker(dispatch);
      void (async () => {
        try {
          const message = await (effect.mode === "all" ? generateAllExports(effect.projectDir) : generateConfiguredExports(effect.projectDir));
          await refreshProject(effect.projectDir, dispatch);
          await refreshLibrary(dispatch);
          dispatch({ type: "action-done", message, level: "success" });
        } catch (error) {
          dispatch({ type: "action-done", message: (error as Error).message, level: "critical" });
        } finally {
          stopTicker();
          dispatch({ type: "job-clear", projectDir: effect.projectDir });
        }
      })();
      return stopTicker;
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
          dispatch({ type: "action-done", message, level: "success" });
        } catch (error) {
          dispatch({ type: "action-done", message: (error as Error).message, level: "critical" });
        }
      })();
      return;
    }
    if (effect.kind === "web-import-preview") {
      void (async () => {
        try {
          const service = new WebImportService();
          const work = await service.loadWork(effect.url);
          const preview = service.buildPreview(work, effect.episodes);
          pendingWebImport = preview;
          dispatch({ type: "web-import-previewed", consent: webImportConsentMessage(work, preview.selection, preview.selectedEpisodes.length) });
        } catch (error) {
          dispatch({ type: "action-done", message: (error as Error).message, level: "critical" });
        }
      })();
      return;
    }
    if (effect.kind === "web-import-run") {
      const preview = pendingWebImport;
      pendingWebImport = null;
      if (!preview) {
        dispatch({ type: "import-job-clear" });
        return;
      }
      startTicker(dispatch);
      void (async () => {
        try {
          const service = new WebImportService();
          const base = importBaseOptions(currentConfig, deps.projectRoot);
          const result = await service.importProject(preview, { ...base, userConfirmedRights: true }, (event) =>
            dispatch({ type: "import-progress", completed: event.completed, total: event.total })
          );
          await refreshLibrary(dispatch);
          dispatch({ type: "action-done", message: `웹 프로젝트 생성: ${result.created.metadata.name} (${result.created.analysis.episodeCount}화)`, level: "success" });
        } catch (error) {
          dispatch({ type: "action-done", message: (error as Error).message, level: "critical" });
        } finally {
          stopTicker();
          dispatch({ type: "import-job-clear" });
        }
      })();
      return stopTicker;
    }
    if (effect.kind === "save-api-key") {
      void (async () => {
        try {
          await saveOpenAICompatibleApiKey(effect.apiKey, deps.configDir);
          dispatch({ type: "action-done", message: "API 키를 저장했습니다.", level: "success" });
        } catch (error) {
          dispatch({ type: "action-done", message: (error as Error).message, level: "critical" });
        }
      })();
      return;
    }
    if (effect.kind === "save-base-url") {
      void (async () => {
        try {
          currentConfig = { ...currentConfig, openAICompatible: { ...currentConfig.openAICompatible, baseUrl: effect.baseUrl } };
          await saveConfig(currentConfig, deps.configDir);
          dispatch({ type: "config-updated", config: currentConfig });
          dispatch({ type: "action-done", message: "base URL을 저장했습니다.", level: "success" });
        } catch (error) {
          dispatch({ type: "action-done", message: (error as Error).message, level: "critical" });
        }
      })();
      return;
    }
    if (effect.kind === "config") {
      void (async () => {
        try {
          currentConfig = await runConfig(effect.op, currentConfig);
          dispatch({ type: "config-updated", config: currentConfig });
        } catch (error) {
          dispatch({ type: "action-done", message: (error as Error).message, level: "critical" });
        }
      })();
      return;
    }
    if (effect.kind === "setup-validate") {
      void (async () => {
        try {
          const adapter = createTranslatorAdapter(currentConfig.defaultBackend, currentConfig, { credentialConfigDir: deps.configDir });
          const status = await adapter.checkAvailability();
          if (!status.available) {
            dispatch({ type: "setup-validated", ok: false, message: status.message });
            return;
          }
          if (!effect.real) {
            dispatch({ type: "setup-validated", ok: true, message: status.message });
            return;
          }
          await adapter.translateEpisode({
            episode: { id: "setup-test", episodeNo: 0, title: "テスト", sourceText: "テスト。", body: "テスト。", sourceHash: "", metadata: {} },
            glossaryEntries: [],
            glossaryContext: ""
          });
          dispatch({ type: "setup-validated", ok: true, message: "실제 번역 테스트에 성공했습니다." });
        } catch (error) {
          dispatch({ type: "setup-validated", ok: false, message: (error as Error).message });
        }
      })();
      return;
    }
    if (effect.kind === "cancel-job") {
      stopPoll(effect.projectDir);
      sessions.get(effect.projectDir)?.cancel();
      qaControllers.get(effect.projectDir)?.abort();
      return;
    }
    if (effect.kind === "pause-job") {
      sessions.get(effect.projectDir)?.pause();
      return;
    }
    if (effect.kind === "resume-job") {
      sessions.get(effect.projectDir)?.resume();
      return;
    }
    if (effect.kind === "dismiss") {
      clearDismissTimer();
      dismissTimer = setTimeout(() => {
        dismissTimer = null;
        dispatch({ type: "clear-message" });
      }, 3000);
      return clearDismissTimer;
    }
    if (sessions.has(effect.projectDir)) {
      return;
    }
    void (async () => {
      try {
        const session = await createProjectTranslationSession(effect.projectDir, effect.mode, runtime());
        sessions.set(effect.projectDir, session);
        const done = session.start();
        stopPoll(effect.projectDir);
        polls.set(
          effect.projectDir,
          setInterval(() => {
            const activeSession = sessions.get(effect.projectDir);
            if (activeSession) {
              dispatch({ type: "job-progress", projectDir: effect.projectDir, snapshot: activeSession.snapshot() });
              dispatch({ type: "tick" });
            }
          }, POLL_INTERVAL_MS)
        );
        const snapshot = await done;
        stopPoll(effect.projectDir);
        sessions.delete(effect.projectDir);
        dispatch({ type: "job-done", projectDir: effect.projectDir, snapshot });
      } catch (error) {
        stopPoll(effect.projectDir);
        sessions.delete(effect.projectDir);
        dispatch({ type: "job-failed", projectDir: effect.projectDir, message: (error as Error).message });
      }
    })();
    return () => {
      stopPoll(effect.projectDir);
      sessions.get(effect.projectDir)?.cancel();
    };
  };
}
