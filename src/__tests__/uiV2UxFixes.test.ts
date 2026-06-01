import { test } from "node:test";
import assert from "node:assert/strict";
import { createTheme, setTheme } from "../ui-v2/theme/theme.js";
import { initModel, type AppModel } from "../ui-v2/state/model.js";
import type { Job } from "../ui-v2/state/model.js";
import { jobSegment } from "../ui-v2/screens/project/overview.js";
import { spinnerFrame } from "../ui-v2/components/progress.js";
import { update } from "../ui-v2/state/update.js";
import { shouldConfirmQuit } from "../ui-v2/state/update.js";
import { view, onKey } from "../ui-v2/app.js";
import type { Msg } from "../ui-v2/state/msg.js";
import { severityBadge } from "../ui-v2/components/badge.js";
import { visibleLength, formatRelativeTime } from "../ui-v2/components/text.js";
import { defaultConfig } from "../config/defaultConfig.js";
import type { BookshelfModel } from "../ui/types.js";

setTheme(createTheme(0, false));

const library: BookshelfModel = { projectRoot: "/p", continueProject: null, allProjects: [], recentProjects: [], problemProjects: [] };

function baseModel(): AppModel {
  return initModel({ ...defaultConfig }, library);
}

test("F5: action-done defaults to info, errors are critical, successes are success", () => {
  const [info] = update(baseModel(), { type: "action-done", message: "안내" });
  assert.deepEqual(info.message, { text: "안내", level: "info" });

  const [ok] = update(baseModel(), { type: "action-done", message: "완료", level: "success" });
  assert.equal(ok.message?.level, "success");

  const running: AppModel = {
    ...baseModel(),
    route: { screen: "project", projectDir: "/p/a", stage: "translate" },
    jobsByProjectDir: { "/p/a": { kind: "translate", projectDir: "/p/a", status: "running", queued: 1, completed: 0, failed: 0 } }
  };
  const [failed] = update(running, { type: "job-failed", projectDir: "/p/a", message: "실패" });
  assert.equal(failed.overlay?.kind === "notice" && failed.overlay.level, "critical");
});

test("Q1: shouldConfirmQuit is true only when a job is running or paused", () => {
  assert.equal(shouldConfirmQuit(baseModel()), false);
  const running: AppModel = { ...baseModel(), jobsByProjectDir: { "/p": { kind: "translate", projectDir: "/p", status: "running", queued: 1, completed: 0, failed: 0 } } };
  assert.equal(shouldConfirmQuit(running), true);
  assert.equal(shouldConfirmQuit({ ...running, jobsByProjectDir: { "/p": { ...running.jobsByProjectDir["/p"]!, status: "paused" } } }), true);
  assert.equal(shouldConfirmQuit({ ...running, jobsByProjectDir: { "/p": { ...running.jobsByProjectDir["/p"]!, status: "completed" } } }), false);
  assert.equal(shouldConfirmQuit({ ...baseModel(), importJob: { kind: "web-import", projectDir: "", status: "running", queued: 1, completed: 0, failed: 0 } }), true);
});

test("Q2: quitting while a job runs confirms; idle quits immediately; confirming exits", () => {
  const job: Job = { kind: "translate", projectDir: "/p", status: "running", queued: 1, completed: 0, failed: 0 };
  const running: AppModel = { ...baseModel(), jobsByProjectDir: { "/p": job } };
  const msgs: Msg[] = [];
  let quit = false;
  onKey(running, { type: "char", value: "q" }, { dispatch: (m) => msgs.push(m), quit: () => { quit = true; } });
  assert.equal(quit, false);
  assert.equal(msgs[0]?.type === "open-overlay" && msgs[0].overlay.kind === "confirm" && msgs[0].overlay.action, "quit");

  let idleQuit = false;
  onKey(baseModel(), { type: "char", value: "q" }, { dispatch: () => {}, quit: () => { idleQuit = true; } });
  assert.equal(idleQuit, true);

  const confirming: AppModel = { ...running, overlay: { kind: "confirm", message: "종료?", action: "quit" } };
  let confirmedQuit = false;
  onKey(confirming, { type: "char", value: "y" }, { dispatch: () => {}, quit: () => { confirmedQuit = true; } });
  assert.equal(confirmedQuit, true);

  let koreanKeyboardQuit = false;
  onKey(confirming, { type: "char", value: "ㅛ" }, { dispatch: () => {}, quit: () => { koreanKeyboardQuit = true; } });
  assert.equal(koreanKeyboardQuit, true);
});

test("F8: starting translate while a job runs gives feedback instead of a silent no-op", () => {
  const running: AppModel = {
    ...baseModel(),
    route: { screen: "project", projectDir: "/p/a", stage: "translate" },
    jobsByProjectDir: { "/p/a": { kind: "translate", projectDir: "/p/a", status: "running", queued: 1, completed: 0, failed: 0 } }
  };
  const [next, effects] = update(running, { type: "start-translate", mode: "resume" });
  assert.equal(next.message?.level, "warning");
  assert.equal(effects[0]?.kind, "dismiss");
});

test("F8: view shows an overflow indicator when content exceeds the viewport", () => {
  const frame = view(baseModel(), { cols: 80, rows: 6 });
  assert.ok(frame.includes("더 있음"));
});

test("F6: severity badge shows a shape-distinct glyph and keeps a 2-cell flag width without color", () => {
  const warning = severityBadge("warning", "주의");
  const critical = severityBadge("critical", "충돌");
  assert.notEqual(warning[0], critical[0]);
  for (const level of ["info", "warning", "critical", "success"] as const) {
    assert.equal(visibleLength(severityBadge(level, "")), 2);
  }
});

test("F9: chrome is Korean (breadcrumb root + relative time)", () => {
  assert.ok(view(baseModel(), { cols: 80, rows: 24 }).includes("책장"));
  assert.equal(formatRelativeTime("not-a-date"), "알 수 없음");
  assert.ok(formatRelativeTime(new Date(Date.now() - 5 * 60_000).toISOString()).endsWith("분 전"));
});

test("F7: 'g' in export opens a confirm overlay that runs the configured export", () => {
  const exportModel: AppModel = { ...baseModel(), route: { screen: "project", projectDir: "/p/a", stage: "export" } };
  const msgs: Msg[] = [];
  onKey(exportModel, { type: "char", value: "g" }, { dispatch: (m) => msgs.push(m), quit: () => undefined });
  assert.equal(msgs[0]?.type === "open-overlay" && msgs[0].overlay.kind === "confirm" && msgs[0].overlay.action, "export-configured");

  const [, confirmed] = msgs[0]?.type === "open-overlay"
    ? update({ ...exportModel, overlay: msgs[0].overlay }, { type: "confirm-yes" })
    : [exportModel, []];
  assert.equal(confirmed[0]?.kind === "export" && confirmed[0].mode, "configured");
});

test("F2: tick advances the spinner counter and export runs as an animated job", () => {
  assert.equal(update(baseModel(), { type: "tick" })[0].tick, 1);

  const exportModel: AppModel = { ...baseModel(), route: { screen: "project", projectDir: "/p/a", stage: "export" } };
  const [withJob, effects] = update(exportModel, { type: "export-generate" });
  assert.equal(withJob.jobsByProjectDir["/p/a"]?.kind, "export");
  assert.equal(withJob.jobsByProjectDir["/p/a"]?.status, "running");
  assert.equal(effects[0]?.kind, "export");
  assert.equal(update(withJob, { type: "job-clear", projectDir: "/p/a" })[0].jobsByProjectDir["/p/a"], undefined);
});

test("F2: a running job segment shows a spinner; a settled one does not", () => {
  const running: Job = { kind: "export", projectDir: "/x", status: "running", queued: 0, completed: 0, failed: 0 };
  assert.ok(jobSegment(running, 0).startsWith(spinnerFrame(0)));
  assert.equal(jobSegment({ ...running, status: "completed" }, 0).startsWith(spinnerFrame(0)), false);
});

test("F1: web import requires a consent overlay before running, then tracks progress", () => {
  const [previewed] = update(baseModel(), { type: "web-import-previewed", consent: "카쿠요무에서 1-5 (5화)\n[Y] 동의하고 가져오기   [N] 취소" });
  assert.equal(previewed.overlay?.kind === "confirm" && previewed.overlay.action, "web-import");

  const [running, effects] = update(previewed, { type: "confirm-yes" });
  assert.equal(running.importJob?.kind, "web-import");
  assert.equal(effects[0]?.kind, "web-import-run");

  const [progressed] = update(running, { type: "import-progress", completed: 2, total: 5 });
  assert.equal(progressed.importJob?.completed, 2);
  assert.equal(progressed.importJob?.queued, 5);
});

test("F1: cancelling the consent overlay starts no import", () => {
  const [previewed] = update(baseModel(), { type: "web-import-previewed", consent: "...\n[Y] 동의하고 가져오기   [N] 취소" });
  const [cancelled, effects] = update(previewed, { type: "close-overlay" });
  assert.equal(cancelled.overlay, null);
  assert.equal(cancelled.importJob, null);
  assert.deepEqual(effects, []);
});

test("F3: first dry-run translate warns once, then proceeds; acknowledged runs directly", () => {
  const project: AppModel = { ...baseModel(), route: { screen: "project", projectDir: "/p/a", stage: "translate" } };
  const [warned, fx1] = update(project, { type: "start-translate", mode: "resume" });
  assert.equal(warned.overlay?.kind === "confirm" && warned.overlay.action, "dry-run-resume");
  assert.deepEqual(fx1, []);

  const [running, fx2] = update(warned, { type: "confirm-yes" });
  assert.equal(running.dryRunAcknowledged, true);
  assert.equal(running.jobsByProjectDir["/p/a"]?.status, "running");
  assert.equal(fx2[0]?.kind, "start-job");

  const acked: AppModel = { ...project, dryRunAcknowledged: true };
  assert.equal(update(acked, { type: "start-translate", mode: "resume" })[1][0]?.kind, "start-job");
});

test("F4: settings can enter a masked API key and an https base URL", () => {
  let [m] = update({ ...baseModel(), overlay: { kind: "settings" } }, { type: "settings-edit", field: "api-key" });
  assert.equal(m.input?.kind, "api-key");
  assert.equal(m.input?.mask, true);
  [m] = update(m, { type: "input-char", value: "sk-123" });
  const [saved, fx] = update(m, { type: "input-submit" });
  assert.equal(saved.input, null);
  assert.equal(fx[0]?.kind === "save-api-key" && fx[0].apiKey, "sk-123");

  const [b0] = update(baseModel(), { type: "settings-edit", field: "base-url" });
  const bad = b0.input ? { ...b0, input: { ...b0.input, value: "http://x" } } : b0;
  assert.equal(update(bad, { type: "input-submit" })[0].message?.level, "warning");

  const ok = b0.input ? { ...b0, input: { ...b0.input, value: "https://api.example.com/v1" } } : b0;
  assert.equal(update(ok, { type: "input-submit" })[1][0]?.kind, "save-base-url");
});

test("F4: a masked input never renders its raw value", () => {
  const masked: AppModel = { ...baseModel(), input: { kind: "api-key", label: "키", value: "sk-secret", mask: true } };
  const frame = view(masked, { cols: 80, rows: 24 });
  assert.equal(frame.includes("sk-secret"), false);
  assert.ok(frame.includes("•"));
});
