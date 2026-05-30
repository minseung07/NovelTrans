import { test } from "node:test";
import assert from "node:assert/strict";
import { createTheme, setTheme } from "../ui-v2/theme/theme.js";
import { initModel, type AppModel } from "../ui-v2/state/model.js";
import { update } from "../ui-v2/state/update.js";
import { renderGlossary } from "../ui-v2/screens/project/glossary.js";
import { renderQa } from "../ui-v2/screens/project/qa.js";
import type { BookshelfModel, ProjectUiModel } from "../ui/types.js";
import type { GlossaryEntry } from "../domain/glossary.js";
import { defaultConfig } from "../config/defaultConfig.js";

setTheme(createTheme(0, false));

function entry(source: string, candidates: Array<[string, number]>): GlossaryEntry {
  return {
    id: source,
    source,
    target: null,
    type: "term",
    status: "candidate",
    aliases: [],
    forbiddenTargets: [],
    notes: "",
    confidence: 0.5,
    sourceScore: 1,
    targetScore: 1,
    occurrenceCount: candidates.reduce((sum, [, count]) => sum + count, 0) || 1,
    firstSeenEpisode: 1,
    lastSeenEpisode: 1,
    locked: false,
    targetCandidates: candidates.map(([target, count]) => ({ target, count, episodeIds: [] })),
    createdAt: "",
    updatedAt: ""
  };
}

function projectFixture(): ProjectUiModel {
  return {
    glossary: { version: 1, entries: [entry("黒架", [["흑가", 5], ["검은시렁", 1]]), entry("聖印", [["성인", 3]])], conflicts: [], updatedAt: "" },
    reviewDesk: {
      openIssues: [{ id: "i1", episodeId: "e1", type: "japanese_remaining", severity: "warning", message: "일본어가 남아 있습니다.", sourceSnippet: "日本語", targetSnippet: "日本語 텍스트", resolved: false, createdAt: "" }],
      buckets: []
    }
  } as unknown as ProjectUiModel;
}

function projectModel(stage: "glossary" | "qa"): AppModel {
  const library: BookshelfModel = { projectRoot: "/p", continueProject: null, allProjects: [], recentProjects: [], problemProjects: [] };
  return { ...initModel({ ...defaultConfig }, library), route: { screen: "project", projectDir: "/p/a", stage }, project: projectFixture() };
}

test("renderGlossary shows the queue, remaining count, and target candidates", () => {
  const lines = renderGlossary(projectFixture(), 0, "all", [], 90).join("\n");
  assert.ok(lines.includes("黒架"));
  assert.ok(lines.includes("2 남음"));
  assert.ok(lines.includes("흑가"));
});

test("renderQa shows the issue type label and source/translation compare", () => {
  const lines = renderQa(projectFixture(), 0, 90).join("\n");
  assert.ok(lines.includes("일본어 잔존"));
  assert.ok(lines.includes("日本語"));
});

test("glossary-op confirm resolves the suggested target into an effect", () => {
  const [, effects] = update(projectModel("glossary"), { type: "glossary-op", op: "confirm" });
  assert.equal(effects.length, 1);
  assert.equal(effects[0]!.kind, "glossary-action");
  assert.equal(effects[0]!.kind === "glossary-action" && effects[0]!.op, "confirm");
  assert.equal(effects[0]!.kind === "glossary-action" && effects[0]!.target, "흑가");
});

test("glossary edit opens an input, accepts text, and confirms the typed target", () => {
  let [state] = update(projectModel("glossary"), { type: "glossary-edit-open" });
  assert.equal(state.input?.value, "흑가");
  [state] = update(state, { type: "input-char", value: "X" });
  assert.equal(state.input?.value, "흑가X");
  const [next, effects] = update(state, { type: "input-submit" });
  assert.equal(next.input, null);
  assert.equal(effects[0]!.kind === "glossary-action" && effects[0]!.target, "흑가X");
});

test("glossary filter cycles and move clamps within the queue", () => {
  let [state] = update(projectModel("glossary"), { type: "glossary-filter" });
  assert.equal(state.glossaryFilter, "conflicts");
  [state] = update(projectModel("glossary"), { type: "move", delta: 5 });
  assert.equal(state.glossarySelected, 1);
});

test("qa-op ignore emits a qa-action; jump navigates to glossary", () => {
  const [, effects] = update(projectModel("qa"), { type: "qa-op", op: "ignore" });
  assert.equal(effects[0]!.kind === "qa-action" && effects[0]!.op, "ignore");
  const [next] = update(projectModel("qa"), { type: "qa-jump-glossary" });
  assert.equal(next.route.screen === "project" && next.route.stage, "glossary");
});
