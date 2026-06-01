import { test } from "node:test";
import assert from "node:assert/strict";
import { createTheme, setTheme } from "../ui-v2/theme/theme.js";
import { initModel, type AppModel } from "../ui-v2/state/model.js";
import { update } from "../ui-v2/state/update.js";
import { renderSource } from "../ui-v2/screens/project/source.js";
import type { BookshelfModel, ProjectUiModel } from "../ui/types.js";
import { defaultConfig } from "../config/defaultConfig.js";

setTheme(createTheme(0, false));

const library: BookshelfModel = { projectRoot: "/p", continueProject: null, allProjects: [], recentProjects: [], problemProjects: [] };

function project(sourcePath: string): ProjectUiModel {
  return {
    episodes: [
      { id: "e1", episodeNo: 1, title: "첫 화", sourceText: "", body: "본문 첫 줄\n둘째 줄", sourceHash: "h1", metadata: {} },
      { id: "e2", episodeNo: 2, title: "둘째 화", sourceText: "", body: "다른 본문", sourceHash: "h2", metadata: {} }
    ],
    sourceStatus: { sourcePath, originalTitle: "제목", languageGuess: "ja", characterCount: 1234, episodeCount: 2, structureLabel: "헤딩 기반", longEpisodeCount: 0, afterwordCount: 1, warnings: ["긴 화 주의"] }
  } as unknown as ProjectUiModel;
}

function model(sourcePath = "./novel.txt"): AppModel {
  return { ...initModel({ ...defaultConfig }, library), route: { screen: "project", projectDir: "/p/a", stage: "source" }, project: project(sourcePath) };
}

test("source screen shows source status, warnings, and the episode list", () => {
  const out = renderSource(project("./novel.txt"), 0, 100).join("\n");
  assert.ok(out.includes("원문 정보"));
  assert.ok(out.includes("2개 에피소드"));
  assert.ok(out.includes("첫 화"));
  assert.ok(out.includes("긴 화 주의"));
  assert.equal(out.includes("원문 다시 가져오기"), false);
});

test("source move adjusts selection and clamps to episode bounds", () => {
  let [m] = update(model(), { type: "move", delta: 1 });
  assert.equal(m.sourceSelected, 1);
  [m] = update(m, { type: "move", delta: 5 });
  assert.equal(m.sourceSelected, 1);
});
