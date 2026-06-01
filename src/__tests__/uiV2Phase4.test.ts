import { test } from "node:test";
import assert from "node:assert/strict";
import { createTheme, setTheme } from "../ui-v2/theme/theme.js";
import { initModel, type AppModel } from "../ui-v2/state/model.js";
import { update } from "../ui-v2/state/update.js";
import { renderTranslate } from "../ui-v2/screens/project/translate.js";
import { renderExport } from "../ui-v2/screens/project/export.js";
import { renderHelp, renderSettings, renderPalette } from "../ui-v2/screens/overlays.js";
import { onKey } from "../ui-v2/app.js";
import { paletteCommands } from "../ui/commands.js";
import type { BookshelfModel, ProjectUiModel } from "../ui/types.js";
import { defaultConfig } from "../config/defaultConfig.js";
import type { Msg } from "../ui-v2/state/msg.js";

setTheme(createTheme(0, false));

const library: BookshelfModel = { projectRoot: "/p", continueProject: null, allProjects: [], recentProjects: [], problemProjects: [] };

function baseModel(): AppModel {
  return initModel({ ...defaultConfig }, library);
}

function projectFixture(): ProjectUiModel {
  const episodes = [{ id: "e1", episodeNo: 1, title: "1화", sourceText: "日本語", body: "日本語", sourceHash: "h", metadata: {} }] as ProjectUiModel["episodes"];
  const qaIssues = [{ id: "i1", episodeId: "e1", type: "japanese_remaining", severity: "warning", message: "일본어가 남아 있습니다.", sourceSnippet: "日本語", targetSnippet: "日本語", resolved: false, createdAt: "" }] as ProjectUiModel["qaIssues"];
  return {
    overview: { counts: { pending: 1, running: 0, completed: 2, failed: 1, skipped: 0 }, episodeStates: [{}, {}, {}, {}], metadata: { outputOptions: { formats: ["txt"], includeGlossaryAppendix: false, includeAfterword: false, verticalWriting: false } } },
    episodes,
    qaIssues,
    reviewDesk: { openIssues: qaIssues, buckets: [], episodeGroups: [{ episodeId: "e1", episodeNo: 1, title: "1화", issues: qaIssues }] },
    studioQueue: { active: [{ episodeNo: 3, title: "3화", status: "running", detail: "" }], next: [], failed: [], skipped: [] },
    failureRecovery: { failedCount: 1, items: [{ episodeId: "e", episodeNo: 4, title: "4화", reason: "timeout", attempts: 1, updatedAt: "" }], logPath: "" },
    exportPreview: { title: "T", episodeCount: 4, translatedEpisodeCount: 2, glossaryAppendixCount: 0, expectedTxtPath: "/x.txt", expectedEpubPath: "/x.epub", txtExists: false, epubExists: false }
  } as unknown as ProjectUiModel;
}

function projectModel(stage: "overview" | "translate" | "qa" | "export"): AppModel {
  return { ...baseModel(), route: { screen: "project", projectDir: "/p/a", stage }, project: projectFixture() };
}

test("palette opens, filters, and runs a mapped command", () => {
  let [model] = update(baseModel(), { type: "open-overlay", overlay: { kind: "palette", query: "", selected: 0 } });
  assert.equal(model.overlay?.kind, "palette");
  [model] = update(model, { type: "palette-input", value: "도" });
  [model] = update(model, { type: "palette-input", value: "움" });
  [model] = update(model, { type: "palette-input", value: "말" });
  [model] = update(model, { type: "palette-run" });
  assert.equal(model.overlay?.kind, "help");
});

test("a confirm-required palette command opens a confirm overlay, then runs on yes", () => {
  let model: AppModel = { ...baseModel(), route: { screen: "project", projectDir: "/p/a", stage: "translate" }, project: projectFixture() };
  [model] = update(model, { type: "open-overlay", overlay: { kind: "palette", query: "건너뛰", selected: 0 } });
  [model] = update(model, { type: "palette-run" });
  assert.equal(model.overlay?.kind === "confirm" && model.overlay.action, "skip-export");
  const [, effects] = update(model, { type: "confirm-yes" });
  assert.equal(effects[0]!.kind, "skip-export");
});

test("palette commands exposed in v2 map to state changes, confirmations, or effects", () => {
  for (const command of paletteCommands) {
    const initialStage = command.id === "open-studio" ? "qa" : "overview";
    const before: AppModel = { ...projectModel(initialStage), overlay: { kind: "palette", query: command.id, selected: 0 } };
    const [after, effects] = update(before, { type: "palette-run" });
    const changed =
      effects.length > 0 ||
      after.overlay !== null ||
      after.input !== null ||
      after.searching !== before.searching ||
      after.glossaryFilter !== before.glossaryFilter ||
      JSON.stringify(after.route) !== JSON.stringify(before.route);
    assert.equal(changed, true, `${command.id} should not close as a no-op`);
  }
});

test("palette backend commands route to the intended integration effects", () => {
  let [state] = update({ ...projectModel("overview"), overlay: { kind: "palette", query: "glossary-conflicts", selected: 0 } }, { type: "palette-run" });
  assert.equal(state.route.screen === "project" && state.route.stage, "glossary");
  assert.equal(state.glossaryFilter, "conflicts");

  [state] = update({ ...projectModel("overview"), overlay: { kind: "palette", query: "search-projects", selected: 0 } }, { type: "palette-run" });
  assert.deepEqual(state.route, { screen: "library" });
  assert.equal(state.searching, true);

  const [, rerunEffects] = update({ ...projectModel("qa"), overlay: { kind: "palette", query: "rerun-qa", selected: 0 } }, { type: "palette-run" });
  assert.equal(rerunEffects[0]?.kind === "qa-action" && rerunEffects[0].op, "recheck");

  const [, afterwordEffects] = update({ ...projectModel("export"), overlay: { kind: "palette", query: "export-toggle-afterword", selected: 0 } }, { type: "palette-run" });
  assert.equal(afterwordEffects[0]?.kind === "export-toggle" && afterwordEffects[0].what, "afterword");

  [state] = update({ ...projectModel("qa"), overlay: { kind: "palette", query: "review-retranslate-all", selected: 0 } }, { type: "palette-run" });
  assert.equal(state.overlay?.kind === "confirm" && state.overlay.action, "review-retranslate-all");
  const [batchState, batchEffects] = update(state, { type: "confirm-yes" });
  assert.equal(batchState.jobsByProjectDir["/p/a"]?.kind, "qa-batch-retranslate");
  assert.deepEqual(batchState.jobsByProjectDir["/p/a"]?.episodeIds, ["e1"]);
  assert.equal(batchState.message?.text.startsWith("재번역을 시작했습니다"), true);
  assert.equal(batchEffects[0]?.kind === "qa-batch-action" && batchEffects[0].scope, "all-open");
  assert.equal(batchEffects[1]?.kind, "dismiss");
});

test("import opens an input and submits an import effect", () => {
  let [model] = update(baseModel(), { type: "import-open" });
  assert.equal(model.input?.kind, "import");
  [model] = update(model, { type: "input-char", value: "s" });
  const [next, effects] = update(model, { type: "input-submit" });
  assert.equal(next.input, null);
  assert.equal(effects[0]!.kind, "import");
});

test("import input accepts bracketed paste text for URLs", () => {
  let [model] = update(baseModel(), { type: "import-open" });
  const pasted = "https://kakuyomu.jp/works/123 --episodes 1 --confirm-rights";
  const messages: Msg[] = [];
  onKey(model, { type: "paste", text: pasted }, { dispatch: (msg) => messages.push(msg), quit: () => undefined });
  assert.deepEqual(messages, [{ type: "input-char", value: pasted }]);

  [model] = update(model, messages[0]!);
  const [, effects] = update(model, { type: "input-submit" });
  assert.equal(effects[0]?.kind === "web-import-preview" && effects[0].url, "https://kakuyomu.jp/works/123");
  assert.equal(effects[0]?.kind === "web-import-preview" && effects[0].episodes, "1");
});

test("URL import collects episodes as an option and defaults rights confirmation", () => {
  let [model] = update(baseModel(), { type: "import-open" });
  [model] = update(model, { type: "input-char", value: "https://kakuyomu.jp/works/123" });

  let effects: ReturnType<typeof update>[1];
  [model, effects] = update(model, { type: "input-submit" });
  assert.equal(effects.length, 0);
  assert.equal(model.input?.kind, "web-import-episodes");
  assert.equal(model.input?.kind === "web-import-episodes" && model.input.url, "https://kakuyomu.jp/works/123");

  [model] = update(model, { type: "input-char", value: "latest-5" });
  [model, effects] = update(model, { type: "input-submit" });
  assert.equal(model.input, null);
  assert.equal(model.overlay, null);
  assert.equal(effects[0]?.kind === "web-import-preview" && effects[0].url, "https://kakuyomu.jp/works/123");
  assert.equal(effects[0]?.kind === "web-import-preview" && effects[0].episodes, "latest-5");
});

test("export toggle and generate emit effects", () => {
  const [, toggle] = update(projectModel("export"), { type: "export-toggle", what: "txt" });
  assert.equal(toggle[0]!.kind, "export-toggle");
  const [, generate] = update(projectModel("export"), { type: "export-generate" });
  assert.equal(generate[0]!.kind, "export");
});

test("job failure exposes the backend error and refreshes project and library data", () => {
  const running: AppModel = { ...projectModel("translate"), jobsByProjectDir: { "/p/a": { kind: "translate", projectDir: "/p/a", status: "running", queued: 1, completed: 0, failed: 0 } } };
  const [next, effects] = update(running, { type: "job-failed", projectDir: "/p/a", message: "OPENAI_API_KEY가 설정되지 않았습니다." });
  assert.equal(next.overlay?.kind === "notice" && next.overlay.message, "OPENAI_API_KEY가 설정되지 않았습니다.");
  assert.equal(next.overlay?.kind === "notice" && next.overlay.level, "critical");
  assert.equal(next.jobsByProjectDir["/p/a"]?.status, "failed");
  assert.deepEqual(
    effects.map((effect) => effect.kind),
    ["load-project", "load-library"]
  );
});

test("critical action-done opens a persistent notice; non-critical stays transient", () => {
  const [crit] = update(baseModel(), { type: "action-done", message: "실패", level: "critical" });
  assert.equal(crit.overlay?.kind, "notice");
  const [info, infoEffects] = update(baseModel(), { type: "action-done", message: "완료", level: "success" });
  assert.equal(info.overlay, null);
  assert.equal(info.message?.text, "완료");
  assert.deepEqual(infoEffects.map((effect) => effect.kind), ["dismiss"]);
});

test("settings op emits a config effect; config-updated applies", () => {
  const [, effects] = update(baseModel(), { type: "settings-op", op: "cycle-backend" });
  assert.equal(effects[0]!.kind, "config");
  const [next] = update(baseModel(), { type: "config-updated", config: { ...defaultConfig, defaultBackend: "openai-compatible" } });
  assert.equal(next.config.defaultBackend, "openai-compatible");
});

test("translate pause toggles between pause and resume effects by job status", () => {
  const running: AppModel = { ...projectModel("translate"), jobsByProjectDir: { "/p/a": { kind: "translate", projectDir: "/p/a", status: "running", queued: 1, completed: 0, failed: 0 } } };
  assert.equal(update(running, { type: "translate-pause" })[1][0]!.kind, "pause-job");
  const paused: AppModel = { ...running, jobsByProjectDir: { "/p/a": { ...running.jobsByProjectDir["/p/a"]!, status: "paused" } } };
  assert.equal(update(paused, { type: "translate-pause" })[1][0]!.kind, "resume-job");
});

test("translate cancel stops an active job and emits cancel-job", () => {
  const running: AppModel = { ...projectModel("translate"), jobsByProjectDir: { "/p/a": { kind: "translate", projectDir: "/p/a", status: "running", queued: 1, completed: 0, failed: 0 } } };
  const [next, effects] = update(running, { type: "translate-cancel" });
  assert.equal(next.jobsByProjectDir["/p/a"]?.status, "cancelled");
  assert.equal(effects[0]?.kind, "cancel-job");
  assert.deepEqual(update(projectModel("translate"), { type: "translate-cancel" })[1], []);
});

test("translate/export/overlay views render", () => {
  assert.ok(renderTranslate(projectFixture(), null, 80).join("\n").includes("번역 상태"));
  assert.ok(renderTranslate(projectFixture(), null, 80).join("\n").includes("실패한 화"));
  assert.ok(renderExport(projectFixture(), 80).join("\n").includes("출력 옵션"));
  assert.ok(renderHelp(70).join("\n").includes("도움말"));
  assert.ok(renderSettings({ ...defaultConfig }, 70).join("\n").includes("백엔드"));
  assert.ok(renderPalette("", 0, true, 70).join("\n").includes("명령 팔레트"));
});
