import { test } from "node:test";
import assert from "node:assert/strict";
import { createTheme, setTheme } from "../ui-v2/theme/theme.js";
import { initModel, type AppModel } from "../ui-v2/state/model.js";
import { update } from "../ui-v2/state/update.js";
import { renderOverview, jobSegment } from "../ui-v2/screens/project/overview.js";
import { renderProject } from "../ui-v2/screens/project/index.js";
import type { BookshelfModel, BookshelfProject, ProjectUiModel } from "../ui/types.js";
import type { TranslationSessionSnapshot } from "../engine/translationSession.js";
import { defaultConfig } from "../config/defaultConfig.js";

setTheme(createTheme(0, false));

function project(title: string): BookshelfProject {
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
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function model(): AppModel {
  const projects = [project("알파"), project("베타")];
  const library: BookshelfModel = {
    projectRoot: "/projects",
    continueProject: projects[0]!,
    allProjects: projects,
    recentProjects: projects,
    problemProjects: []
  };
  return { ...initModel({ ...defaultConfig, projectRoot: "/projects" }, library), dryRunAcknowledged: true };
}

const snapshot = (over: Partial<TranslationSessionSnapshot> = {}): TranslationSessionSnapshot => ({
  status: "running",
  queued: 4,
  completed: 2,
  failed: 0,
  skipped: 0,
  currentEpisodeTitle: null,
  activeEpisodeNos: [],
  activeEpisodeTitles: [],
  message: null,
  ...over
});

function projectModelFixture(): ProjectUiModel {
  return {
    overview: { episodeStates: [{}, {}, {}, {}], counts: { pending: 1, running: 0, completed: 2, failed: 1, skipped: 0 } },
    episodes: [{}, {}, {}, {}],
    glossaryPulse: { candidates: 3, conflicts: 1 },
    qaIssues: [{ resolved: false }],
    nextActions: [{ severity: "warning", message: "용어 충돌 정리", commandHint: "[G] 용어" }],
    timeline: [{ label: "1화 완료" }]
  } as unknown as ProjectUiModel;
}

test("open-selected enters project overview and requests a project load", () => {
  const [next, effects] = update(model(), { type: "open-selected" });
  assert.deepEqual(next.route, { screen: "project", projectDir: "/projects/알파", stage: "overview" });
  assert.equal(next.projectLoading, true);
  assert.deepEqual(effects, [{ kind: "load-project", projectDir: "/projects/알파" }]);
});

test("go-stage switches the active stage; back returns to library", () => {
  let [state] = update(model(), { type: "open-selected" });
  [state] = update(state, { type: "go-stage", stage: "glossary" });
  assert.equal(state.route.screen === "project" && state.route.stage, "glossary");
  [state] = update(state, { type: "back" });
  assert.deepEqual(state.route, { screen: "library" });
});

test("start-translate begins a job once; progress persists across stages", () => {
  let [state, effects] = update(update(model(), { type: "open-selected" })[0], { type: "start-translate", mode: "resume" });
  assert.equal(state.jobsByProjectDir["/projects/알파"]?.status, "running");
  assert.deepEqual(effects, [{ kind: "start-job", projectDir: "/projects/알파", mode: "resume" }]);
  // A second start while running gives feedback (dismiss) instead of a new job.
  [state, effects] = update(state, { type: "start-translate", mode: "resume" });
  assert.deepEqual(effects, [{ kind: "dismiss" }]);
  assert.equal(state.message?.level, "warning");
  [state, effects] = update({ ...state, route: { screen: "project", projectDir: "/projects/베타", stage: "translate" } }, { type: "start-translate", mode: "resume" });
  assert.deepEqual(effects, [{ kind: "start-job", projectDir: "/projects/베타", mode: "resume" }]);
  assert.equal(state.jobsByProjectDir["/projects/알파"]?.status, "running");
  assert.equal(state.jobsByProjectDir["/projects/베타"]?.status, "running");
  // Progress updates the job, and it survives a stage switch.
  [state] = update(state, { type: "job-progress", projectDir: "/projects/알파", snapshot: snapshot({ completed: 3 }) });
  assert.equal(state.jobsByProjectDir["/projects/알파"]?.completed, 3);
  assert.equal(state.jobsByProjectDir["/projects/베타"]?.completed, 0);
  [state] = update(state, { type: "go-stage", stage: "qa" });
  assert.equal(state.jobsByProjectDir["/projects/알파"]?.completed, 3);
});

test("job-done updates status and refreshes the open project", () => {
  let [state] = update(update(model(), { type: "open-selected" })[0], { type: "start-translate", mode: "resume" });
  const [next, effects] = update(state, { type: "job-done", projectDir: "/projects/알파", snapshot: snapshot({ status: "completed", completed: 4 }) });
  assert.equal(next.jobsByProjectDir["/projects/알파"]?.status, "completed");
  assert.deepEqual(effects, [{ kind: "load-project", projectDir: "/projects/알파" }, { kind: "load-library" }]);
});

test("jobSegment and renderOverview show progress", () => {
  assert.ok(jobSegment({ kind: "translate", projectDir: "/x", status: "running", queued: 4, completed: 2, failed: 0 }).includes("(50%)"));
  const lines = renderOverview(projectModelFixture(), { kind: "translate", projectDir: "/x", status: "running", queued: 4, completed: 2, failed: 0 }, 74).join("\n");
  assert.ok(lines.includes("파이프라인"));
  assert.ok(lines.includes("지금 할 일"));
  assert.ok(lines.includes("라이브 잡"));
  assert.ok(lines.includes("용어 충돌 정리"));
});

test("renderProject composes the stage rail with the overview detail", () => {
  let [state] = update(model(), { type: "open-selected" });
  [state] = update(state, { type: "project-loaded", model: projectModelFixture() });
  const lines = renderProject(state, 100, 30).join("\n");
  assert.ok(lines.includes("단계"));
  assert.ok(lines.includes("개요"));
  assert.ok(lines.includes("파이프라인"));
});

test("renderProject collapses the rail to a tab strip on narrow widths", () => {
  let [state] = update(model(), { type: "open-selected" });
  [state] = update(state, { type: "project-loaded", model: projectModelFixture() });
  const narrow = renderProject(state, 60, 30).join("\n");
  assert.ok(!narrow.includes("단계"));
  assert.ok(narrow.includes("개요"));
  assert.ok(narrow.includes("파이프라인"));
});
