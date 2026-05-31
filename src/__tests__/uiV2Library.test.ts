import { test } from "node:test";
import assert from "node:assert/strict";
import { createTheme, setTheme } from "../ui-v2/theme/theme.js";
import { keymapConflicts, resolveAction, keyToken } from "../ui-v2/state/keymap.js";
import { initModel, type AppModel } from "../ui-v2/state/model.js";
import { update, currentList } from "../ui-v2/state/update.js";
import { renderLibrary } from "../ui-v2/screens/library.js";
import type { BookshelfModel, BookshelfProject } from "../ui/types.js";
import { defaultConfig } from "../config/defaultConfig.js";

setTheme(createTheme(0, false));

function project(title: string, extra: Partial<BookshelfProject> = {}): BookshelfProject {
  return {
    projectDir: `/projects/${title}`,
    title,
    completed: 1,
    total: 4,
    failed: 0,
    running: 0,
    skipped: 0,
    qaIssues: 0,
    candidates: 2,
    conflicts: 0,
    txtExists: false,
    epubExists: false,
    shelfStatusLabel: "번역 이어가기",
    nextActionLabel: "[Enter] 계속",
    statusText: "active",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra
  };
}

function model(): AppModel {
  const projects = [project("알파"), project("베타", { failed: 1, shelfStatusLabel: "재시도 필요 1개" })];
  const library: BookshelfModel = {
    projectRoot: "/projects",
    continueProject: projects[0]!,
    allProjects: projects,
    recentProjects: projects,
    problemProjects: projects.filter((p) => p.failed > 0)
  };
  return initModel({ ...defaultConfig, projectRoot: "/projects" }, library);
}

test("keymap has no conflicting bindings", () => {
  assert.deepEqual(keymapConflicts(), []);
});

test("keyToken and resolveAction map events to actions", () => {
  assert.equal(resolveAction("library", keyToken({ type: "key", name: "enter" })), "open");
  assert.equal(resolveAction("library", keyToken({ type: "char", value: "n" })), "import");
  assert.equal(resolveAction("library", keyToken({ type: "char", value: "C", ctrl: true })), "quit");
  assert.equal(resolveAction("project", keyToken({ type: "key", name: "escape" })), "back");
});

test("library Esc no longer quits; q and Ctrl+C still do", () => {
  assert.equal(resolveAction("library", keyToken({ type: "key", name: "escape" })), null);
  assert.equal(resolveAction("library", keyToken({ type: "char", value: "q" })), "quit");
  assert.equal(resolveAction("library", keyToken({ type: "char", value: "C", ctrl: true })), "quit");
});

test("renderLibrary shows hero, project list, and problem panel", () => {
  const lines = renderLibrary(model(), 74, 24).join("\n");
  assert.ok(lines.includes("이어하기"));
  assert.ok(lines.includes("알파"));
  assert.ok(lines.includes("베타"));
  assert.ok(lines.includes("25%"));
  assert.ok(lines.includes("확인 필요"));
});

test("update moves selection with clamping and opens a project", () => {
  let state = model();
  [state] = update(state, { type: "move", delta: 5 });
  assert.equal(state.selected, currentList(state).length - 1);
  [state] = update(state, { type: "move", delta: -10 });
  assert.equal(state.selected, 0);
  [state] = update(state, { type: "open-selected" });
  assert.equal(state.route.screen === "project" && state.route.projectDir, "/projects/알파");
  [state] = update(state, { type: "back" });
  assert.deepEqual(state.route, { screen: "library" });
});

test("search filters the navigable list", () => {
  let [state] = update(model(), { type: "start-search" });
  assert.equal(state.searching, true);
  [state] = update(state, { type: "search-char", value: "베" });
  assert.equal(currentList(state).length, 1);
  assert.equal(currentList(state)[0]!.title, "베타");
  [state] = update(state, { type: "end-search" });
  assert.equal(state.query, "");
  assert.equal(currentList(state).length, 2);
});
