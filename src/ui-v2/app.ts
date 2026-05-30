// Frontend v2 entry point. Loads the bookshelf, then drives the MVU with
// effects. Composes breadcrumb + screen/overlay body + message + status bar into
// a frame, with context-aware input (input modal, overlays, search mode, stage
// keys, keymap). The global job stays visible in the status bar.

import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import type { ReadStream, WriteStream } from "node:tty";
import type { NovelTransConfig } from "../domain/config.js";
import { resolveProjectRoot } from "../config/configStore.js";
import { createTheme, setTheme, getTheme } from "./theme/theme.js";
import { detectColorLevel, detectUnicode } from "./theme/capabilities.js";
import { createTerminal } from "./runtime/terminal.js";
import { runProgram } from "./runtime/loop.js";
import type { KeyContext, Dispatch } from "./runtime/loop.js";
import type { TerminalSize } from "./runtime/terminal.js";
import type { KeyEvent } from "./runtime/input.js";
import { breadcrumb } from "./components/breadcrumb.js";
import { statusBar } from "./components/statusbar.js";
import { modal } from "./components/modal.js";
import { severityBadge } from "./components/badge.js";
import { MAX_SCREEN_WIDTH, truncate } from "./components/text.js";
import { loadBookshelfModel } from "./data/library.js";
import { initModel, type AppModel } from "./state/model.js";
import { update } from "./state/update.js";
import type { Msg } from "./state/msg.js";
import { createEffectRunner, type Effect } from "./state/effects.js";
import { contextHints, keyToken, resolveAction } from "./state/keymap.js";
import { renderLibrary } from "./screens/library.js";
import { renderProject, projectOf, STAGE_LABELS, STAGE_ORDER } from "./screens/project/index.js";
import { jobSegment } from "./screens/project/overview.js";
import { renderHelp, renderSettings, renderPalette } from "./screens/overlays.js";

interface UiV2Options {
  config: NovelTransConfig;
  configDir?: string;
  projectRoot?: string;
  input?: ReadStream;
  output?: WriteStream;
}

function contentWidth(size: TerminalSize): number {
  return Math.min(size.cols, MAX_SCREEN_WIDTH);
}

function statusParts(model: AppModel): string[] {
  const meta = [`백엔드 ${model.config.defaultBackend}`, `모델 ${model.config.defaultModel}`, `동시 ${model.config.concurrency}`];
  const job = model.job ? [jobSegment(model.job, model.tick)] : [];
  return [...meta, ...job, ...contextHints(model.route.screen)];
}

function renderOverlay(model: AppModel, width: number): string[] {
  const overlay = model.overlay!;
  if (overlay.kind === "help") {
    return renderHelp(width);
  }
  if (overlay.kind === "settings") {
    return renderSettings(model.config, width);
  }
  if (overlay.kind === "palette") {
    return renderPalette(overlay.query, overlay.selected, model.route.screen === "project", width);
  }
  const lines = overlay.message.split("\n");
  return modal("확인", overlay.message.includes("[Y]") ? lines : [...lines, "", "[Y] 예   [N] 아니오"], width);
}

function bodyLines(model: AppModel, size: TerminalSize): string[] {
  const width = contentWidth(size);
  if (model.input) {
    const masked = "mask" in model.input && model.input.mask === true;
    const shown = masked ? "•".repeat([...model.input.value].length) : model.input.value;
    return modal(model.input.label, [`${shown}▌`, "", "[Enter] 확정   [Esc] 취소"], width);
  }
  if (model.overlay) {
    return renderOverlay(model, width);
  }
  return model.route.screen === "library" ? renderLibrary(model, width, size.rows) : renderProject(model, width, size.rows);
}

function crumbs(model: AppModel): string[] {
  if (model.route.screen === "library") {
    return ["책장"];
  }
  return ["책장", projectOf(model)?.title ?? "프로젝트", STAGE_LABELS[model.route.stage]];
}

export function view(model: AppModel, size: TerminalSize): string {
  const reserved = Math.max(1, size.rows - 2);
  const composed = [breadcrumb(crumbs(model)), "", ...bodyLines(model, size)].map((line) => truncate(line, size.cols));
  const lines = composed.slice(0, reserved);
  if (composed.length > reserved && lines.length > 0) {
    lines[lines.length - 1] = truncate(getTheme().muted("↓ 더 있음"), size.cols);
  }
  while (lines.length < reserved) {
    lines.push("");
  }
  lines.push(truncate(model.message ? severityBadge(model.message.level, model.message.text) : "", size.cols));
  lines.push(truncate(statusBar(statusParts(model)), size.cols));
  return lines.join("\n");
}

function handleGlossaryKey(token: string, dispatch: Dispatch<Msg>): boolean {
  const ops: Record<string, Msg> = { c: { type: "glossary-op", op: "confirm" }, l: { type: "glossary-op", op: "lock" }, f: { type: "glossary-op", op: "forbid" }, d: { type: "glossary-op", op: "discard" }, e: { type: "glossary-edit-open" }, a: { type: "glossary-filter" } };
  if (token === "up" || token === "k") {
    dispatch({ type: "move", delta: -1 });
    return true;
  }
  if (token === "down" || token === "j") {
    dispatch({ type: "move", delta: 1 });
    return true;
  }
  if (ops[token]) {
    dispatch(ops[token]!);
    return true;
  }
  return false;
}

function handleQaKey(token: string, dispatch: Dispatch<Msg>): boolean {
  const ops: Record<string, Msg> = { i: { type: "qa-op", op: "ignore" }, r: { type: "qa-op", op: "recheck" }, t: { type: "qa-op", op: "retranslate" }, g: { type: "qa-jump-glossary" } };
  if (token === "up" || token === "k") {
    dispatch({ type: "move", delta: -1 });
    return true;
  }
  if (token === "down" || token === "j") {
    dispatch({ type: "move", delta: 1 });
    return true;
  }
  if (ops[token]) {
    dispatch(ops[token]!);
    return true;
  }
  return false;
}

function handleTranslateKey(token: string, dispatch: Dispatch<Msg>): boolean {
  if (token === "t") {
    dispatch({ type: "start-translate", mode: "resume" });
    return true;
  }
  if (token === "y") {
    dispatch({ type: "start-translate", mode: "retry-failed" });
    return true;
  }
  if (token === "p") {
    dispatch({ type: "translate-pause" });
    return true;
  }
  if (token === "s") {
    dispatch({ type: "open-overlay", overlay: { kind: "confirm", message: "실패 화를 건너뛰고 결과물을 생성할까요?", action: "skip-export" } });
    return true;
  }
  return false;
}

function handleSourceKey(token: string, dispatch: Dispatch<Msg>): boolean {
  if (token === "up" || token === "k") {
    dispatch({ type: "move", delta: -1 });
    return true;
  }
  if (token === "down" || token === "j") {
    dispatch({ type: "move", delta: 1 });
    return true;
  }
  if (token === "i") {
    dispatch({ type: "source-reimport" });
    return true;
  }
  return false;
}

function handleExportKey(token: string, dispatch: Dispatch<Msg>): boolean {
  const toggles: Record<string, Msg> = { t: { type: "export-toggle", what: "txt" }, e: { type: "export-toggle", what: "epub" }, p: { type: "export-toggle", what: "appendix" }, v: { type: "export-toggle", what: "vertical" }, a: { type: "export-toggle", what: "afterword" }, g: { type: "open-overlay", overlay: { kind: "confirm", message: "현재 설정으로 결과물을 생성할까요?", action: "export-configured" } } };
  if (toggles[token]) {
    dispatch(toggles[token]!);
    return true;
  }
  return false;
}

function handleOverlayKey(model: AppModel, event: KeyEvent, token: string, dispatch: Dispatch<Msg>): void {
  const overlay = model.overlay!;
  if (overlay.kind === "confirm") {
    if (token === "y" || token === "enter") {
      dispatch({ type: "confirm-yes" });
    } else if (token === "n" || token === "escape") {
      dispatch({ type: "close-overlay" });
    }
    return;
  }
  if (overlay.kind === "palette") {
    if (token === "escape") {
      dispatch({ type: "close-overlay" });
    } else if (token === "enter") {
      dispatch({ type: "palette-run" });
    } else if (token === "backspace") {
      dispatch({ type: "palette-backspace" });
    } else if (token === "up") {
      dispatch({ type: "palette-move", delta: -1 });
    } else if (token === "down") {
      dispatch({ type: "palette-move", delta: 1 });
    } else if (event.type === "paste") {
      dispatch({ type: "palette-input", value: event.text });
    } else if (event.type === "char" && !event.ctrl && !event.alt) {
      dispatch({ type: "palette-input", value: event.value });
    }
    return;
  }
  if (overlay.kind === "settings") {
    const ops: Record<string, Msg> = { b: { type: "settings-op", op: "cycle-backend" }, m: { type: "settings-op", op: "cycle-model" }, g: { type: "settings-op", op: "cycle-strictness" }, "+": { type: "settings-op", op: "inc-concurrency" }, "=": { type: "settings-op", op: "inc-concurrency" }, "-": { type: "settings-op", op: "dec-concurrency" }, t: { type: "settings-op", op: "toggle-txt" }, e: { type: "settings-op", op: "toggle-epub" }, k: { type: "settings-edit", field: "api-key" }, u: { type: "settings-edit", field: "base-url" } };
    if (token === "escape" || token === "q") {
      dispatch({ type: "close-overlay" });
    } else if (ops[token]) {
      dispatch(ops[token]!);
    }
    return;
  }
  if (token === "escape" || token === "q" || token === "enter") {
    dispatch({ type: "close-overlay" });
  }
}

export function onKey(model: AppModel, event: KeyEvent, ctx: KeyContext<Msg>): void {
  const { dispatch, quit } = ctx;
  const token = keyToken(event);
  if (model.input) {
    if (token === "escape") {
      dispatch({ type: "input-cancel" });
    } else if (token === "enter") {
      dispatch({ type: "input-submit" });
    } else if (token === "backspace") {
      dispatch({ type: "input-backspace" });
    } else if (event.type === "paste") {
      dispatch({ type: "input-char", value: event.text });
    } else if (event.type === "char" && !event.ctrl && !event.alt) {
      dispatch({ type: "input-char", value: event.value });
    }
    return;
  }
  if (model.overlay) {
    handleOverlayKey(model, event, token, dispatch);
    return;
  }
  if (model.searching) {
    if (token === "escape") {
      dispatch({ type: "end-search" });
    } else if (token === "enter") {
      dispatch({ type: "open-selected" });
    } else if (token === "backspace") {
      dispatch({ type: "search-backspace" });
    } else if (token === "up") {
      dispatch({ type: "move", delta: -1 });
    } else if (token === "down") {
      dispatch({ type: "move", delta: 1 });
    } else if (event.type === "paste") {
      dispatch({ type: "search-char", value: event.text });
    } else if (event.type === "char" && !event.ctrl && !event.alt) {
      dispatch({ type: "search-char", value: event.value });
    }
    return;
  }
  if (model.route.screen === "project") {
    if (/^[1-6]$/.test(token)) {
      dispatch({ type: "go-stage", stage: STAGE_ORDER[Number(token) - 1]! });
      return;
    }
    const { stage } = model.route;
    if (stage === "source" && handleSourceKey(token, dispatch)) {
      return;
    }
    if (stage === "glossary" && handleGlossaryKey(token, dispatch)) {
      return;
    }
    if (stage === "qa" && handleQaKey(token, dispatch)) {
      return;
    }
    if (stage === "translate" && handleTranslateKey(token, dispatch)) {
      return;
    }
    if (stage === "export" && handleExportKey(token, dispatch)) {
      return;
    }
  }
  switch (resolveAction(model.route.screen, token)) {
    case "quit":
      quit();
      return;
    case "move-up":
      dispatch({ type: "move", delta: -1 });
      return;
    case "move-down":
      dispatch({ type: "move", delta: 1 });
      return;
    case "open":
      dispatch({ type: "open-selected" });
      return;
    case "back":
      dispatch({ type: "back" });
      return;
    case "search":
      dispatch({ type: "start-search" });
      return;
    case "import":
      dispatch({ type: "import-open" });
      return;
    case "translate":
      dispatch({ type: "start-translate", mode: "resume" });
      return;
    case "palette":
      dispatch({ type: "open-overlay", overlay: { kind: "palette", query: "", selected: 0 } });
      return;
    case "help":
      dispatch({ type: "open-overlay", overlay: { kind: "help" } });
      return;
    case "settings":
      dispatch({ type: "open-overlay", overlay: { kind: "settings" } });
      return;
    default:
      return;
  }
}

export async function runUiV2(options: UiV2Options): Promise<void> {
  const input = options.input ?? defaultInput;
  const output = options.output ?? defaultOutput;
  setTheme(createTheme(detectColorLevel(output), detectUnicode(output)));
  const projectRoot = resolveProjectRoot(options.config, options.projectRoot);
  const library = await loadBookshelfModel(projectRoot);
  const terminal = createTerminal(input, output);
  const runEffect = createEffectRunner({ config: options.config, configDir: options.configDir, projectRoot });

  await runProgram<AppModel, Msg, Effect>({ init: initModel(options.config, library), update, view, onKey, runEffect }, { terminal });
}
