// Pure state transitions returning [model, effects]. Movement is stage-aware.
// Triage/export/settings/import ops emit effects; overlays (palette/help/
// settings/confirm) and the input modal are handled here.
import { filterProjects } from "../data/library.js";
import { buildGlossaryQueue, suggestedGlossaryTarget } from "../data/glossary.js";
import { filterPaletteCommands } from "../data/palette.js";
import { isWebImportSource, looksLikeTextPath, parseWebImportRequest } from "../../ui/actions/importActions.js";
import { clamp } from "../components/geometry.js";
export function currentList(model) {
    return filterProjects(model.library.allProjects, model.query);
}
function jobFromSnapshot(job, snapshot) {
    return job ? { ...job, status: snapshot.status, queued: snapshot.queued, completed: snapshot.completed, failed: snapshot.failed } : job;
}
function moveSelection(model, delta) {
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
function glossaryEffect(model, op, target) {
    if (model.route.screen !== "project" || !model.project) {
        return [];
    }
    return [{ kind: "glossary-action", op, projectDir: model.route.projectDir, model: model.project, selectedIndex: model.glossarySelected, filter: model.glossaryFilter, deferred: model.deferred, target }];
}
function projectModelEffect(model, build) {
    return model.route.screen === "project" && model.project ? build(model.route.projectDir, model.project) : null;
}
function isEffect(mapping) {
    return "kind" in mapping;
}
function submitImportSource(model, sourceValue) {
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
    const selection = { url: request.url, episodes: request.episodes };
    return [{ ...model, input: null }, [{ kind: "import", source: selection.url, webImport: { episodes: selection.episodes } }]];
}
// Maps a palette command id to a message, effect, confirm action, or null.
function paletteMapping(model, id) {
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
function runConfirm(model) {
    if (model.overlay?.kind !== "confirm") {
        return [model, []];
    }
    const { action } = model.overlay;
    const cleared = { ...model, overlay: null };
    if (model.route.screen !== "project") {
        return [cleared, []];
    }
    if (action === "skip-export") {
        return [cleared, [{ kind: "skip-export", projectDir: model.route.projectDir }]];
    }
    if (action === "export-all") {
        return [cleared, [{ kind: "export", projectDir: model.route.projectDir, mode: "all" }]];
    }
    if (action === "source-reimport") {
        return [cleared, model.project ? [{ kind: "import", source: model.project.sourceStatus.sourcePath }] : []];
    }
    if (action === "retry-failed") {
        return update(cleared, { type: "start-translate", mode: "retry-failed" });
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
export function update(model, msg) {
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
                return [model, []];
            }
            const { projectDir } = model.route;
            const job = { kind: msg.mode === "retry-failed" ? "retry" : "translate", projectDir, status: "running", queued: 0, completed: 0, failed: 0 };
            return [{ ...model, job }, [{ kind: "start-job", projectDir, mode: msg.mode }]];
        }
        case "translate-pause":
            return model.job ? [model, [{ kind: model.job.status === "paused" ? "resume-job" : "pause-job" }]] : [model, []];
        case "export-toggle":
            return model.route.screen === "project" ? [model, [{ kind: "export-toggle", projectDir: model.route.projectDir, what: msg.what }]] : [model, []];
        case "export-generate":
            return model.route.screen === "project" ? [model, [{ kind: "export", projectDir: model.route.projectDir, mode: "configured" }]] : [model, []];
        case "settings-op":
            return [model, [{ kind: "config", op: msg.op }]];
        case "glossary-filter": {
            const order = ["all", "conflicts", "candidates"];
            const next = order[(order.indexOf(model.glossaryFilter) + 1) % order.length];
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
                return [{ ...model, message: "원문 다시 가져오기는 로컬 TXT 원본에만 지원됩니다." }, [{ kind: "dismiss" }]];
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
                    return [{ ...model, message: "화수 범위를 입력하세요. 예: 1-10, latest-5, all" }, [{ kind: "dismiss" }]];
                }
                return [{ ...model, input: null }, [{ kind: "import", source: model.input.url, webImport: { episodes } }]];
            }
            const target = model.input.value;
            return [{ ...model, input: null }, glossaryEffect(model, "confirm", target)];
        }
        case "open-overlay":
            return [{ ...model, overlay: msg.overlay }, []];
        case "close-overlay":
            return [{ ...model, overlay: null }, []];
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
            return [{ ...model, projectLoading: false, message: msg.message }, [{ kind: "dismiss" }]];
        case "library-loaded":
            return [{ ...model, library: msg.model }, []];
        case "config-updated":
            return [{ ...model, config: msg.config }, []];
        case "action-done":
            return [{ ...model, message: msg.message }, [{ kind: "dismiss" }]];
        case "clear-message":
            return [{ ...model, message: null }, []];
        case "job-progress":
            return [{ ...model, job: jobFromSnapshot(model.job, msg.snapshot) }, []];
        case "job-done": {
            const job = jobFromSnapshot(model.job, msg.snapshot);
            const effects = model.route.screen === "project" ? [{ kind: "load-project", projectDir: model.route.projectDir }, { kind: "load-library" }] : [{ kind: "load-library" }];
            return [{ ...model, job }, effects];
        }
        case "job-failed": {
            const effects = model.route.screen === "project" ? [{ kind: "load-project", projectDir: model.route.projectDir }, { kind: "load-library" }, { kind: "dismiss" }] : [{ kind: "load-library" }, { kind: "dismiss" }];
            return [{ ...model, job: model.job ? { ...model.job, status: "failed" } : model.job, message: msg.message }, effects];
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
