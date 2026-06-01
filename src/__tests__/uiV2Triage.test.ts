import { test } from "node:test";
import assert from "node:assert/strict";
import { createTheme, setTheme } from "../ui-v2/theme/theme.js";
import { initModel, type AppModel } from "../ui-v2/state/model.js";
import { update } from "../ui-v2/state/update.js";
import { onKey } from "../ui-v2/app.js";
import { renderGlossary } from "../ui-v2/screens/project/glossary.js";
import { renderQa } from "../ui-v2/screens/project/qa.js";
import type { Msg } from "../ui-v2/state/msg.js";
import type { BookshelfModel, ProjectUiModel } from "../ui/types.js";
import type { GlossaryEntry } from "../domain/glossary.js";
import { defaultConfig } from "../config/defaultConfig.js";
import { buildReviewDeskModel } from "../ui/reviewDeskModel.js";

setTheme(createTheme(0, false));

function entry(source: string, candidates: Array<[string, number]>, patch: Partial<GlossaryEntry> = {}): GlossaryEntry {
  const base: GlossaryEntry = {
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
  return { ...base, ...patch };
}

function projectFixture(): ProjectUiModel {
  const episodes = [{ id: "e1", episodeNo: 1, title: "제1화", sourceText: "日本語", body: "日本語", sourceHash: "h", metadata: {} }] as ProjectUiModel["episodes"];
  const qaIssues = [{ id: "i1", episodeId: "e1", type: "japanese_remaining", severity: "warning", message: "일본어가 남아 있습니다.", sourceSnippet: "日本語", targetSnippet: "日本語 텍스트", resolved: false, createdAt: "" }] as ProjectUiModel["qaIssues"];
  return {
    glossary: { version: 1, entries: [entry("黒架", [["흑가", 5], ["검은시렁", 1]]), entry("聖印", [["성인", 3]])], conflicts: [], updatedAt: "" },
    episodes,
    qaIssues,
    reviewDesk: buildReviewDeskModel(qaIssues, episodes)
  } as unknown as ProjectUiModel;
}

function twoIssueProjectFixture(): ProjectUiModel {
  const episodes = [
    { id: "e1", episodeNo: 1, title: "제1화", sourceText: "日本語", body: "日本語", sourceHash: "h1", metadata: {} },
    { id: "e2", episodeNo: 2, title: "제2화", sourceText: "二", body: "二", sourceHash: "h2", metadata: {} }
  ] as ProjectUiModel["episodes"];
  const qaIssues = [
    { id: "i1", episodeId: "e1", type: "japanese_remaining", severity: "warning", message: "일본어가 남아 있습니다.", sourceSnippet: "日本語", targetSnippet: "日本語 텍스트", resolved: false, createdAt: "" },
    { id: "i2", episodeId: "e2", type: "number_mismatch", severity: "warning", message: "숫자가 다릅니다.", sourceSnippet: "2", targetSnippet: "3", resolved: false, createdAt: "" }
  ] as ProjectUiModel["qaIssues"];
  return {
    ...projectFixture(),
    episodes,
    qaIssues,
    reviewDesk: buildReviewDeskModel(qaIssues, episodes)
  } as ProjectUiModel;
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

test("renderGlossary can filter confirmed and locked terms", () => {
  const project = {
    ...projectFixture(),
    glossary: {
      version: 1,
      entries: [
        entry("黒架", [["흑가", 5]]),
        entry("聖印", [["성인", 3]], { status: "confirmed", target: "성인" }),
        entry("皇都", [["황도", 2]], { status: "locked", target: "황도", locked: true })
      ],
      conflicts: [],
      updatedAt: ""
    }
  } as ProjectUiModel;
  const lines = renderGlossary(project, 0, "confirmed", [], 90).join("\n");
  assert.ok(lines.includes("필터 확정만 · 2 남음"));
  assert.ok(lines.includes("聖印"));
  assert.ok(lines.includes("皇都"));
  assert.equal(lines.includes("黒架"), false);
});

test("renderQa shows the issue type label and source/translation compare", () => {
  const lines = renderQa(projectFixture(), 0, "all", 90).join("\n");
  assert.ok(lines.includes("1화"));
  assert.ok(lines.includes("일본어 잔존"));
  assert.ok(lines.includes("日本語"));
});

test("renderQa keeps bucket filters while grouping by episode", () => {
  const matching = renderQa(projectFixture(), 0, "japanese", 90).join("\n");
  assert.ok(matching.includes("필터 일본어 잔존 · 1화 · 1개"));
  const empty = renderQa(projectFixture(), 0, "terms", 90).join("\n");
  assert.ok(empty.includes("필터 용어 문제"));
  assert.ok(empty.includes("검수 항목이 없습니다."));
});

test("renderQa hides episodes currently under retranslation", () => {
  const lines = renderQa(twoIssueProjectFixture(), 0, "all", 90, ["e1"]).join("\n");
  assert.ok(lines.includes("필터 전체 · 1화 · 1개"));
  assert.ok(lines.includes("전체 1"));
  assert.ok(lines.includes("제2화"));
  assert.equal(lines.includes("제1화"), false);
});

test("glossary-op confirm resolves the suggested target into an effect", () => {
  const [next, effects] = update(projectModel("glossary"), { type: "glossary-op", op: "confirm" });
  assert.equal(next.message?.text, "용어를 확정했습니다: 黒架 -> 흑가");
  assert.deepEqual(next.deferred, ["黒架"]);
  const queue = renderGlossary(projectFixture(), next.glossarySelected, next.glossaryFilter, next.deferred, 90).join("\n");
  assert.equal(queue.includes("黒架"), false);
  assert.ok(queue.includes("1 남음"));
  assert.equal(effects.length, 2);
  assert.equal(effects[0]!.kind, "glossary-action");
  assert.equal(effects[0]!.kind === "glossary-action" && effects[0]!.op, "confirm");
  assert.equal(effects[0]!.kind === "glossary-action" && effects[0]!.target, "흑가");
  assert.equal(effects[1]?.kind, "dismiss");
});

test("glossary action failure restores an optimistically hidden queue item", () => {
  const [hidden] = update(projectModel("glossary"), { type: "glossary-op", op: "discard" });
  assert.deepEqual(hidden.deferred, ["黒架"]);
  const [restored] = update(hidden, { type: "glossary-action-failed", entryId: "黒架", message: "저장 실패" });
  assert.deepEqual(restored.deferred, []);
  assert.equal(restored.overlay?.kind === "notice" && restored.overlay.message, "저장 실패");
});

test("glossary shortcuts accept Korean IME commits delivered as paste", () => {
  const messages: Msg[] = [];
  onKey(projectModel("glossary"), { type: "paste", text: "ㅊ" }, { dispatch: (msg) => messages.push(msg), quit: () => undefined });
  assert.deepEqual(messages, [{ type: "glossary-op", op: "confirm" }]);
});

test("glossary edit opens an input, accepts text, and confirms the typed target", () => {
  let [state] = update(projectModel("glossary"), { type: "glossary-edit-open" });
  assert.equal(state.input?.value, "흑가");
  [state] = update(state, { type: "input-char", value: "X" });
  assert.equal(state.input?.value, "흑가X");
  const [next, effects] = update(state, { type: "input-submit" });
  assert.equal(next.input, null);
  assert.equal(next.message?.text, "용어를 확정했습니다: 黒架 -> 흑가X");
  assert.deepEqual(next.deferred, ["黒架"]);
  assert.equal(effects[0]!.kind === "glossary-action" && effects[0]!.target, "흑가X");
});

test("glossary filter cycles and move clamps within the queue", () => {
  let [state] = update(projectModel("glossary"), { type: "glossary-filter" });
  assert.equal(state.glossaryFilter, "conflicts");
  [state] = update(state, { type: "glossary-filter" });
  assert.equal(state.glossaryFilter, "candidates");
  [state] = update(state, { type: "glossary-filter" });
  assert.equal(state.glossaryFilter, "confirmed");
  [state] = update(projectModel("glossary"), { type: "move", delta: 5 });
  assert.equal(state.glossarySelected, 1);
});

test("qa-op ignore emits a qa-action; jump navigates to glossary", () => {
  const [, effects] = update(projectModel("qa"), { type: "qa-op", op: "ignore" });
  assert.equal(effects[0]!.kind === "qa-action" && effects[0]!.op, "ignore");
  assert.equal(effects[0]!.kind === "qa-action" && effects[0]!.filter, "all");
  const [next] = update(projectModel("qa"), { type: "qa-jump-glossary" });
  assert.equal(next.route.screen === "project" && next.route.stage, "glossary");
});

test("qa-op retranslate starts a project job with immediate feedback", () => {
  const [next, effects] = update(projectModel("qa"), { type: "qa-op", op: "retranslate" });
  assert.equal(next.jobsByProjectDir["/p/a"]?.kind, "qa-retranslate");
  assert.equal(next.jobsByProjectDir["/p/a"]?.queued, 1);
  assert.equal(next.jobsByProjectDir["/p/a"]?.current, "1화 제1화");
  assert.deepEqual(next.jobsByProjectDir["/p/a"]?.episodeIds, ["e1"]);
  assert.equal(next.message?.text, "재번역을 시작했습니다: 1화 제1화");
  assert.equal(effects[0]?.kind === "qa-action" && effects[0].op, "retranslate");
  assert.equal(effects[1]?.kind, "dismiss");
});

test("qa actions target the visible queue when a retranslation job hides episodes", () => {
  const project = twoIssueProjectFixture();
  const running: AppModel = {
    ...projectModel("qa"),
    project,
    jobsByProjectDir: {
      "/p/a": { kind: "qa-retranslate", projectDir: "/p/a", status: "running", queued: 1, completed: 0, failed: 0, episodeIds: ["e1"] }
    }
  };
  const [, effects] = update(running, { type: "qa-op", op: "ignore" });
  assert.equal(effects[0]?.kind === "qa-action" && effects[0].model.reviewDesk.openIssues[0]?.episodeId, "e2");
});

test("qa filter cycles through issue buckets", () => {
  let [state] = update(projectModel("qa"), { type: "qa-filter" });
  assert.equal(state.qaFilter, "missing");
  [state] = update(state, { type: "qa-filter" });
  assert.equal(state.qaFilter, "japanese");
  assert.equal(state.qaSelected, 0);
});
