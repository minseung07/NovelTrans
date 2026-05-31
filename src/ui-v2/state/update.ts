// Pure state transitions returning [model, effects]. Movement is stage-aware.
// Triage/export/settings/import ops emit effects; overlays (palette/help/
// settings/confirm) and the input modal are handled here.

import { filterProjects } from "../data/library.js";
import { buildGlossaryQueue, suggestedGlossaryTarget } from "../data/glossary.js";
import { filterPaletteCommands } from "../data/palette.js";
import { isWebImportSource, looksLikeTextPath, parseWebImportRequest } from "../../ui/actions/importActions.js";
import type { BookshelfProject, GlossaryQueueFilter } from "../../ui/types.js";
import type { NovelTransConfig } from "../../domain/config.js";
import { clamp } from "../components/geometry.js";
import type { AppModel, ConfirmAction, Job } from "./model.js";
import type { Msg } from "./msg.js";
import type { Effect } from "./effects.js";

export function currentList(model: AppModel): BookshelfProject[] {
  return filterProjects(model.library.allProjects, model.query);
}

export function shouldConfirmQuit(model: AppModel): boolean {
  return Boolean(model.job && (model.job.status === "running" || model.job.status === "paused"));
}

export function needsSetup(config: NovelTransConfig, hasApiKey: boolean): boolean {
  if (config.defaultBackend === "openai-compatible") {
    return !hasApiKey;
  }
  return config.defaultBackend === "dry-run";
}

function jobFromSnapshot(job: Job | null, snapshot: { status: Job["status"]; queued: number; completed: number; failed: number }): Job | null {
  return job ? { ...job, status: snapshot.status, queued: snapshot.queued, completed: snapshot.completed, failed: snapshot.failed } : job;
}

function moveSelection(model: AppModel, delta: number): AppModel {
  if (model.route.screen === "library") {
    const length = currentList(model).length;
    return length === 0 ? model : { ...model, selected: clamp(model.selected + delta, 0, length - 1) };
  }
  if (model.route.screen === "project" && model.project) {
    if (model.route.stage === "source") {
      const length = model.project.episodes.length;
      return length === 0 ? model : { ...model, sourceSelected: clamp(model.sourceSelected + delta, 0, length - 1) };
    }
    if (model.route.stage === "glossary") {
      const length = buildGlossaryQueue(model.project, model.glossaryFilter, model.deferred).length;
      return length === 0 ? model : { ...model, glossarySelected: clamp(model.glossarySelected + delta, 0, length - 1) };
    }
    if (model.route.stage === "qa") {
      const length = model.project.reviewDesk.openIssues.length;
      return length === 0 ? model : { ...model, qaSelected: clamp(model.qaSelected + delta, 0, length - 1) };
    }
  }
  return model;
}

function glossaryEffect(model: AppModel, op: "confirm" | "lock" | "forbid" | "discard", target: string | null): Effect[] {
  if (model.route.screen !== "project" || !model.project) {
    return [];
  }
  return [{ kind: "glossary-action", op, projectDir: model.route.projectDir, model: model.project, selectedIndex: model.glossarySelected, filter: model.glossaryFilter, deferred: model.deferred, target }];
}

type PaletteMapping = Msg | Effect | { confirm: ConfirmAction } | null;

function projectModelEffect(model: AppModel, build: (projectDir: string, project: NonNullable<AppModel["project"]>) => Effect): Effect | null {
  return model.route.screen === "project" && model.project ? build(model.route.projectDir, model.project) : null;
}

function isEffect(mapping: Exclude<PaletteMapping, null | { confirm: ConfirmAction }>): mapping is Effect {
  return "kind" in mapping;
}

function previewWebImport(model: AppModel, url: string, episodes: string): [AppModel, Effect[]] {
  return [{ ...model, input: null, message: { text: "작품 정보를 불러오는 중…", level: "info" } }, [{ kind: "web-import-preview", url, episodes }]];
}

function submitImportSource(model: AppModel, sourceValue: string): [AppModel, Effect[]] {
  const source = sourceValue.trim();
  if (!source) {
    return [{ ...model, input: null }, []];
  }
  if (!isWebImportSource(source)) {
    return [{ ...model, input: null }, [{ kind: "import", source }]];
  }

  const request = parseWebImportRequest(source);
  if (!request.episodes) {
    return [
      {
        ...model,
        input: {
          kind: "web-import-episodes",
          label: "가져올 화수 범위",
          value: "",
          url: request.url
        },
        message: null
      },
      []
    ];
  }

  return previewWebImport(model, request.url, request.episodes);
}

// Maps a palette command id to a message, effect, confirm action, or null.
function paletteMapping(model: AppModel, id: string): PaletteMapping {
  switch (id) {
    case "open-bookshelf":
      return { type: "back" };
    case "import-source":
      return { type: "import-open" };
    case "search-projects":
      return { type: "open-library-search" };
    case "open-settings":
      return { type: "open-overlay", overlay: { kind: "settings" } };
    case "open-help":
      return { type: "open-overlay", overlay: { kind: "help" } };
    case "open-setup":
      return { type: "setup-open" };
    case "open-studio":
      return { type: "go-stage", stage: "overview" };
    case "continue-translation":
      return { type: "start-translate", mode: "resume" };
    case "open-glossary":
      return { type: "go-stage", stage: "glossary" };
    case "glossary-conflicts":
      return { type: "go-glossary-filter", filter: "conflicts" };
    case "glossary-candidates":
      return { type: "go-glossary-filter", filter: "candidates" };
    case "glossary-export-json":
      return projectModelEffect(model, (projectDir) => ({ kind: "glossary-export", projectDir }));
    case "glossary-current-terms":
      return projectModelEffect(model, (_projectDir, project) => ({ kind: "related-terms", model: project }));
    case "open-review":
      return { type: "go-stage", stage: "qa" };
    case "rerun-qa":
      return { type: "qa-op", op: "recheck" };
    case "review-open-translation":
      return projectModelEffect(model, (projectDir, project) => ({ kind: "review-open-translation", projectDir, model: project, selectedIndex: model.qaSelected }));
    case "review-ignore-issue":
      return { confirm: "review-ignore" };
    case "review-retranslate-issue":
      return { confirm: "review-retranslate" };
    case "review-retranslate-all":
      return { confirm: "review-retranslate-all" };
    case "review-retranslate-same-type":
      return { confirm: "review-retranslate-same-type" };
    case "open-failure-recovery":
      return { type: "go-stage", stage: "translate" };
    case "show-error-log":
      return projectModelEffect(model, (projectDir) => ({ kind: "show-error-log", projectDir }));
    case "open-export":
      return { type: "go-stage", stage: "export" };
    case "export-toggle-txt":
      return { type: "export-toggle", what: "txt" };
    case "export-toggle-epub":
      return { type: "export-toggle", what: "epub" };
    case "export-toggle-vertical":
      return { type: "export-toggle", what: "vertical" };
    case "export-toggle-appendix":
      return { type: "export-toggle", what: "appendix" };
    case "export-toggle-afterword":
      return { type: "export-toggle", what: "afterword" };
    case "settings-cycle-backend":
      return { type: "settings-op", op: "cycle-backend" };
    case "settings-cycle-model":
      return { type: "settings-op", op: "cycle-model" };
    case "settings-inc-concurrency":
      return { type: "settings-op", op: "inc-concurrency" };
    case "settings-dec-concurrency":
      return { type: "settings-op", op: "dec-concurrency" };
    case "settings-cycle-strictness":
      return { type: "settings-op", op: "cycle-strictness" };
    case "retry-failed":
      return { confirm: "retry-failed" };
    case "skip-failed-export":
      return { confirm: "skip-export" };
    case "export-all":
      return { confirm: "export-all" };
    default:
      return null;
  }
}

function startExport(model: AppModel, projectDir: string, mode: "configured" | "all"): [AppModel, Effect[]] {
  if (model.job && (model.job.status === "running" || model.job.status === "paused")) {
    return [{ ...model, overlay: null, message: { text: "다른 작업이 진행 중입니다.", level: "warning" } }, [{ kind: "dismiss" }]];
  }
  const job: Job = { kind: "export", projectDir, status: "running", queued: 0, completed: 0, failed: 0 };
  return [{ ...model, overlay: null, job }, [{ kind: "export", projectDir, mode }]];
}

function runConfirm(model: AppModel): [AppModel, Effect[]] {
  if (model.overlay?.kind !== "confirm") {
    return [model, []];
  }
  const { action } = model.overlay;
  const cleared = { ...model, overlay: null };
  if (action === "quit") {
    return [cleared, []];
  }
  if (action === "web-import") {
    const job: Job = { kind: "web-import", projectDir: "", status: "running", queued: 0, completed: 0, failed: 0 };
    return [{ ...cleared, job }, [{ kind: "web-import-run" }]];
  }
  if (model.route.screen !== "project") {
    return [cleared, []];
  }
  if (action === "skip-export") {
    return [cleared, [{ kind: "skip-export", projectDir: model.route.projectDir }]];
  }
  if (action === "export-all") {
    return startExport(model, model.route.projectDir, "all");
  }
  if (action === "export-configured") {
    return startExport(model, model.route.projectDir, "configured");
  }
  if (action === "source-reimport") {
    return [cleared, model.project ? [{ kind: "import", source: model.project.sourceStatus.sourcePath }] : []];
  }
  if (action === "retry-failed") {
    return update(cleared, { type: "start-translate", mode: "retry-failed" });
  }
  if (action === "dry-run-resume" || action === "dry-run-retry") {
    return update({ ...cleared, dryRunAcknowledged: true }, { type: "start-translate", mode: action === "dry-run-retry" ? "retry-failed" : "resume" });
  }
  if (action === "review-ignore") {
    return update(cleared, { type: "qa-op", op: "ignore" });
  }
  if (action === "review-retranslate") {
    return update(cleared, { type: "qa-op", op: "retranslate" });
  }
  if (!model.project) {
    return [cleared, []];
  }
  return [
    cleared,
    [
      {
        kind: "qa-batch-action",
        scope: action === "review-retranslate-same-type" ? "same-type" : "all-open",
        projectDir: model.route.projectDir,
        model: model.project,
        selectedIndex: model.qaSelected
      }
    ]
  ];
}

export function update(model: AppModel, msg: Msg): [AppModel, Effect[]] {
  switch (msg.type) {
    case "move":
      return [moveSelection(model, msg.delta), []];
    case "open-selected": {
      const project = currentList(model)[model.selected];
      if (!project) {
        return [model, []];
      }
      return [
        { ...model, route: { screen: "project", projectDir: project.projectDir, stage: "overview" }, searching: false, project: null, projectLoading: true, glossarySelected: 0, qaSelected: 0, message: null },
        [{ kind: "load-project", projectDir: project.projectDir }]
      ];
    }
    case "go-stage":
      return model.route.screen === "project" ? [{ ...model, route: { ...model.route, stage: msg.stage }, message: null }, []] : [model, []];
    case "go-glossary-filter":
      return model.route.screen === "project"
        ? [{ ...model, route: { ...model.route, stage: "glossary" }, glossaryFilter: msg.filter, glossarySelected: 0, message: null }, []]
        : [model, []];
    case "back":
      return model.route.screen === "project" ? [{ ...model, route: { screen: "library" }, project: null, projectLoading: false, message: null }, []] : [model, []];
    case "start-translate": {
      if (model.route.screen !== "project") {
        return [model, []];
      }
      if (model.job && (model.job.status === "running" || model.job.status === "paused")) {
        return [{ ...model, message: { text: "이미 번역이 진행 중입니다.", level: "warning" } }, [{ kind: "dismiss" }]];
      }
      if (model.config.defaultBackend === "openai-compatible" && !model.hasApiKey) {
        return [{ ...model, overlay: { kind: "setup", step: "credentials", validation: { state: "idle", message: "" } } }, []];
      }
      if (model.config.defaultBackend === "dry-run" && !model.dryRunAcknowledged) {
        return [{ ...model, overlay: { kind: "confirm", message: "dry-run 백엔드는 실제 번역이 아니라 자리표시자 텍스트를 만듭니다. 계속할까요? (설정에서 엔진을 바꿀 수 있습니다)", action: msg.mode === "retry-failed" ? "dry-run-retry" : "dry-run-resume" } }, []];
      }
      const { projectDir } = model.route;
      const job: Job = { kind: msg.mode === "retry-failed" ? "retry" : "translate", projectDir, status: "running", queued: 0, completed: 0, failed: 0 };
      return [{ ...model, job }, [{ kind: "start-job", projectDir, mode: msg.mode }]];
    }
    case "translate-pause":
      return model.job ? [model, [{ kind: model.job.status === "paused" ? "resume-job" : "pause-job" }]] : [model, []];
    case "translate-cancel":
      return model.job && (model.job.status === "running" || model.job.status === "paused")
        ? [{ ...model, job: { ...model.job, status: "cancelled" } }, [{ kind: "cancel-job" }]]
        : [model, []];
    case "export-toggle":
      return model.route.screen === "project" ? [model, [{ kind: "export-toggle", projectDir: model.route.projectDir, what: msg.what }]] : [model, []];
    case "export-generate":
      return model.route.screen === "project" ? startExport(model, model.route.projectDir, "configured") : [model, []];
    case "settings-op":
      return [model, [{ kind: "config", op: msg.op }]];
    case "settings-edit":
      return msg.field === "api-key"
        ? [{ ...model, input: { kind: "api-key", label: "OpenAI 호환 API 키", value: "", mask: true } }, []]
        : [{ ...model, input: { kind: "base-url", label: "API base URL (https://...)", value: model.config.openAICompatible.baseUrl } }, []];
    case "glossary-filter": {
      const order: GlossaryQueueFilter[] = ["all", "conflicts", "candidates"];
      const next = order[(order.indexOf(model.glossaryFilter) + 1) % order.length]!;
      return [{ ...model, glossaryFilter: next, glossarySelected: 0 }, []];
    }
    case "glossary-op": {
      const target = msg.op === "discard" || model.route.screen !== "project" || !model.project ? null : suggestedGlossaryTarget(model.project, model.glossarySelected, model.glossaryFilter, model.deferred);
      return [model, glossaryEffect(model, msg.op, target)];
    }
    case "glossary-edit-open": {
      if (model.route.screen !== "project" || !model.project) {
        return [model, []];
      }
      const suggested = suggestedGlossaryTarget(model.project, model.glossarySelected, model.glossaryFilter, model.deferred) ?? "";
      return [{ ...model, input: { kind: "glossary-edit", label: "번역 입력", value: suggested } }, []];
    }
    case "qa-op":
      return model.route.screen === "project" && model.project
        ? [model, [{ kind: "qa-action", op: msg.op, projectDir: model.route.projectDir, model: model.project, selectedIndex: model.qaSelected }]]
        : [model, []];
    case "qa-jump-glossary":
      return model.route.screen === "project" ? [{ ...model, route: { ...model.route, stage: "glossary" }, message: null }, []] : [model, []];
    case "source-reimport": {
      if (model.route.screen !== "project" || !model.project) {
        return [model, []];
      }
      if (!looksLikeTextPath(model.project.sourceStatus.sourcePath)) {
        return [{ ...model, message: { text: "원문 다시 가져오기는 로컬 TXT 원본에만 지원됩니다.", level: "warning" } }, [{ kind: "dismiss" }]];
      }
      return [{ ...model, overlay: { kind: "confirm", message: "현재 원문 파일로 새 프로젝트를 다시 만들까요?", action: "source-reimport" } }, []];
    }
    case "import-open":
      return [{ ...model, input: { kind: "import", label: "원문 경로, URL 또는 붙여넣기", value: "" } }, []];
    case "input-char":
      return [{ ...model, input: model.input ? { ...model.input, value: model.input.value + msg.value } : null }, []];
    case "input-backspace":
      return [{ ...model, input: model.input ? { ...model.input, value: model.input.value.slice(0, -1) } : null }, []];
    case "input-cancel":
      return [{ ...model, input: null }, []];
    case "input-submit": {
      if (!model.input) {
        return [model, []];
      }
      if (model.input.kind === "import") {
        return submitImportSource(model, model.input.value);
      }
      if (model.input.kind === "web-import-episodes") {
        const episodes = model.input.value.trim();
        if (!episodes) {
          return [{ ...model, message: { text: "화수 범위를 입력하세요. 예: 1-10, latest-5, all", level: "warning" } }, [{ kind: "dismiss" }]];
        }
        return previewWebImport(model, model.input.url, episodes);
      }
      if (model.input.kind === "api-key") {
        const apiKey = model.input.value.trim();
        return apiKey
          ? [{ ...model, input: null, hasApiKey: true }, [{ kind: "save-api-key", apiKey }]]
          : [{ ...model, input: null, message: { text: "API 키가 비어 있습니다.", level: "warning" } }, [{ kind: "dismiss" }]];
      }
      if (model.input.kind === "base-url") {
        const baseUrl = model.input.value.trim();
        return /^https:\/\//i.test(baseUrl)
          ? [{ ...model, input: null }, [{ kind: "save-base-url", baseUrl }]]
          : [{ ...model, input: null, message: { text: "base URL은 https:// 로 시작해야 합니다.", level: "warning" } }, [{ kind: "dismiss" }]];
      }
      const target = model.input.value;
      return [{ ...model, input: null }, glossaryEffect(model, "confirm", target)];
    }
    case "open-overlay":
      return [{ ...model, overlay: msg.overlay }, []];
    case "close-overlay":
      return [{ ...model, overlay: null }, []];
    case "setup-open":
      return [{ ...model, overlay: { kind: "setup", step: "engine", validation: { state: "idle", message: "" } } }, []];
    case "setup-step": {
      if (model.overlay?.kind !== "setup") {
        return [model, []];
      }
      if (msg.step === "validate") {
        return [{ ...model, overlay: { ...model.overlay, step: "validate", validation: { state: "checking", message: "확인 중…" } } }, [{ kind: "setup-validate", real: false }]];
      }
      return [{ ...model, overlay: { ...model.overlay, step: msg.step } }, []];
    }
    case "setup-validate":
      return model.overlay?.kind === "setup"
        ? [{ ...model, overlay: { ...model.overlay, validation: { state: "checking", message: "확인 중…" } } }, [{ kind: "setup-validate", real: msg.real }]]
        : [model, []];
    case "setup-validated":
      return model.overlay?.kind === "setup"
        ? [{ ...model, overlay: { ...model.overlay, validation: { state: msg.ok ? "ok" : "fail", message: msg.message } } }, []]
        : [model, []];
    case "palette-input":
      return [{ ...model, overlay: model.overlay?.kind === "palette" ? { ...model.overlay, query: model.overlay.query + msg.value, selected: 0 } : model.overlay }, []];
    case "palette-backspace":
      return [{ ...model, overlay: model.overlay?.kind === "palette" ? { ...model.overlay, query: model.overlay.query.slice(0, -1), selected: 0 } : model.overlay }, []];
    case "palette-move": {
      if (model.overlay?.kind !== "palette") {
        return [model, []];
      }
      const count = filterPaletteCommands(model.overlay.query, model.route.screen === "project").length;
      const selected = count === 0 ? 0 : clamp(model.overlay.selected + msg.delta, 0, count - 1);
      return [{ ...model, overlay: { ...model.overlay, selected } }, []];
    }
    case "palette-run": {
      if (model.overlay?.kind !== "palette") {
        return [model, []];
      }
      const command = filterPaletteCommands(model.overlay.query, model.route.screen === "project")[model.overlay.selected];
      const cleared = { ...model, overlay: null };
      if (!command) {
        return [cleared, []];
      }
      const mapped = paletteMapping(model, command.id);
      if (!mapped) {
        return [cleared, []];
      }
      if ("confirm" in mapped) {
        return [{ ...cleared, overlay: { kind: "confirm", message: command.label, action: mapped.confirm } }, []];
      }
      return isEffect(mapped) ? [cleared, [mapped]] : update(cleared, mapped);
    }
    case "confirm-yes":
      return runConfirm(model);
    case "project-loaded":
      return [{ ...model, project: msg.model, projectLoading: false }, []];
    case "project-load-failed":
      return [{ ...model, projectLoading: false, overlay: { kind: "notice", message: msg.message, level: "critical" } }, []];
    case "library-loaded":
      return [{ ...model, library: msg.model, libraryLoading: false }, []];
    case "config-updated":
      return [{ ...model, config: msg.config }, []];
    case "action-done": {
      const level = msg.level ?? "info";
      return level === "critical"
        ? [{ ...model, overlay: { kind: "notice", message: msg.message, level } }, []]
        : [{ ...model, message: { text: msg.message, level } }, [{ kind: "dismiss" }]];
    }
    case "clear-message":
      return [{ ...model, message: null }, []];
    case "job-clear":
      return [{ ...model, job: null }, []];
    case "web-import-previewed":
      return [{ ...model, overlay: { kind: "confirm", message: msg.consent, action: "web-import" }, message: null }, []];
    case "import-progress":
      return [{ ...model, job: model.job ? { ...model.job, queued: msg.total, completed: msg.completed } : model.job }, []];
    case "tick":
      return [{ ...model, tick: model.tick + 1 }, []];
    case "job-progress":
      return [{ ...model, job: jobFromSnapshot(model.job, msg.snapshot) }, []];
    case "job-done": {
      const job = jobFromSnapshot(model.job, msg.snapshot);
      const effects: Effect[] = model.route.screen === "project" ? [{ kind: "load-project", projectDir: model.route.projectDir }, { kind: "load-library" }] : [{ kind: "load-library" }];
      return [{ ...model, job, libraryLoading: true }, effects];
    }
    case "job-failed": {
      const effects: Effect[] = model.route.screen === "project" ? [{ kind: "load-project", projectDir: model.route.projectDir }, { kind: "load-library" }] : [{ kind: "load-library" }];
      return [{ ...model, job: model.job ? { ...model.job, status: "failed" } : model.job, overlay: { kind: "notice", message: msg.message, level: "critical" } }, effects];
    }
    case "start-search":
      return [{ ...model, searching: true }, []];
    case "search-char":
      return [{ ...model, query: model.query + msg.value, selected: 0 }, []];
    case "search-backspace":
      return [{ ...model, query: model.query.slice(0, -1), selected: 0 }, []];
    case "end-search":
      return [{ ...model, searching: false, query: "", selected: 0 }, []];
    case "open-library-search":
      return [{ ...model, route: { screen: "library" }, project: null, projectLoading: false, searching: true, query: "", selected: 0, message: null }, []];
    default:
      return [model, []];
  }
}
