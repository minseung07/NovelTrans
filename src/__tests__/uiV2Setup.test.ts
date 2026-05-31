import test from "node:test";
import assert from "node:assert/strict";
import { createTheme, setTheme } from "../ui-v2/theme/theme.js";
import { initModel, type AppModel } from "../ui-v2/state/model.js";
import { update, needsSetup } from "../ui-v2/state/update.js";
import { createEffectRunner } from "../ui-v2/state/effects.js";
import { renderSetup } from "../ui-v2/screens/overlays.js";
import type { Msg } from "../ui-v2/state/msg.js";
import { defaultConfig } from "../config/defaultConfig.js";
import type { BookshelfModel } from "../ui/types.js";

setTheme(createTheme(0, false));

const library: BookshelfModel = { projectRoot: "/p", continueProject: null, allProjects: [], recentProjects: [], problemProjects: [] };

function model(overrides: Partial<AppModel> = {}): AppModel {
  return { ...initModel({ ...defaultConfig }, library), ...overrides };
}

test("needsSetup: dry-run always, openai-compatible only without a key, codex assumed configured", () => {
  assert.equal(needsSetup({ ...defaultConfig, defaultBackend: "dry-run" }, false), true);
  assert.equal(needsSetup({ ...defaultConfig, defaultBackend: "openai-compatible" }, false), true);
  assert.equal(needsSetup({ ...defaultConfig, defaultBackend: "openai-compatible" }, true), false);
  assert.equal(needsSetup({ ...defaultConfig, defaultBackend: "codex-cli" }, false), false);
});

test("setup flow advances engine -> model -> credentials -> validate (emitting a validate effect)", () => {
  let [state] = update(model(), { type: "setup-open" });
  assert.equal(state.overlay?.kind === "setup" && state.overlay.step, "engine");
  [state] = update(state, { type: "setup-step", step: "model" });
  assert.equal(state.overlay?.kind === "setup" && state.overlay.step, "model");
  [state] = update(state, { type: "setup-step", step: "credentials" });
  assert.equal(state.overlay?.kind === "setup" && state.overlay.step, "credentials");
  const [validating, effects] = update(state, { type: "setup-step", step: "validate" });
  assert.equal(validating.overlay?.kind === "setup" && validating.overlay.validation.state, "checking");
  assert.deepEqual(effects, [{ kind: "setup-validate", real: false }]);
});

test("setup-validated records the result; setup-validate(real) re-checks", () => {
  const [opened] = update(model(), { type: "setup-open" });
  const [ok] = update(opened, { type: "setup-validated", ok: true, message: "좋음" });
  assert.equal(ok.overlay?.kind === "setup" && ok.overlay.validation.state, "ok");
  const [, effects] = update(opened, { type: "setup-validate", real: true });
  assert.deepEqual(effects, [{ kind: "setup-validate", real: true }]);
});

test("start-translate opens guided setup when openai-compatible has no key", () => {
  const base = { ...initModel({ ...defaultConfig, defaultBackend: "openai-compatible" }, library, false), route: { screen: "project" as const, projectDir: "/p/a", stage: "translate" as const } };
  const [next, effects] = update(base, { type: "start-translate", mode: "resume" });
  assert.equal(next.overlay?.kind === "setup" && next.overlay.step, "credentials");
  assert.deepEqual(effects, []);
});

test("submitting an API key marks hasApiKey and saves it", () => {
  const withInput = model({ input: { kind: "api-key", label: "키", value: "sk-test", mask: true } });
  const [next, effects] = update(withInput, { type: "input-submit" });
  assert.equal(next.hasApiKey, true);
  assert.equal(effects[0]?.kind, "save-api-key");
});

test("renderSetup shows the engine step", () => {
  const lines = renderSetup({ ...defaultConfig }, "engine", { state: "idle", message: "" }, 70).join("\n");
  assert.ok(lines.includes("설정 마법사"));
  assert.ok(lines.includes("현재 엔진"));
});

test("setup-validate effect reports availability (dry-run is available)", async () => {
  const run = createEffectRunner({ config: { ...defaultConfig, defaultBackend: "dry-run" }, projectRoot: "/tmp" });
  const msgs: Msg[] = [];
  run({ kind: "setup-validate", real: false }, (m) => msgs.push(m));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const validated = msgs.find((m): m is Extract<Msg, { type: "setup-validated" }> => m.type === "setup-validated");
  assert.ok(validated && validated.ok === true);
});
