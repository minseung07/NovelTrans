import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultConfig } from "../config/defaultConfig.js";
import { exportProject } from "../export/exporter.js";
import { createProjectFromTxt, runTranslation } from "../engine/projectWorkflow.js";
import { createTranslatorAdapter } from "../translation/adapters/adapterFactory.js";
import { loadProjectMetadata } from "../storage/projectStore.js";
import { loadBookshelfModel, loadProjectUiModel } from "../ui/studioData.js";
import { renderBookshelfScreen } from "../ui/screens/bookshelfScreen.js";
import { renderResponsiveStudioScreen, renderStudioScreen } from "../ui/screens/studioScreen.js";
import { renderGlossaryLabScreen, renderResponsiveGlossaryLabScreen } from "../ui/screens/glossaryLabScreen.js";
import { renderReviewDeskScreen } from "../ui/screens/reviewDeskScreen.js";
import { renderExportRoomScreen } from "../ui/screens/exportRoomScreen.js";
import { renderCommandPaletteScreen } from "../ui/screens/commandPaletteScreen.js";
import { renderHelpScreen } from "../ui/screens/helpScreen.js";
import { renderProjectSearchScreen } from "../ui/screens/searchScreen.js";
import { renderSettingsScreen } from "../ui/screens/settingsScreen.js";
import { renderImportAnalysis } from "../ui/screens/importDropInScreen.js";
import { advancedSettingsOptions, buildAdvancedSettingsForm } from "../ui/settingsModel.js";
import { selectedBookshelfProject } from "../ui/bookshelfSelection.js";
import { parseImportAnalysisChoice, parseRecipePresetId } from "../ui/importChoices.js";
import { filterPaletteCommands } from "../ui/commands.js";
import { fitToViewport, truncate, visibleLength } from "../ui/layout.js";

test("renders Translation Studio spaces from one project model", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-ui-"));
  const sourcePath = join(root, "source.txt");
  await writeFile(
    sourcePath,
    ["第1話 黒架", "黒架は聖印を見た。", "", "第2話 聖印", "聖印は黒架を導いた。"].join("\n"),
    "utf8"
  );
  const projectRoot = join(root, "projects");
  const created = await createProjectFromTxt({
    sourcePath,
    projectRoot,
    name: "Studio Novel",
    backend: "dry-run",
    model: "dry-run",
    concurrency: 1,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });
  await runTranslation(created.metadata.projectDir, createTranslatorAdapter("dry-run", defaultConfig), "resume", 1);
  await exportProject(await loadProjectMetadata(created.metadata.projectDir), ["epub"]);

  const bookshelfModel = await loadBookshelfModel(projectRoot);
  const bookshelf = renderBookshelfScreen(bookshelfModel);
  assert.match(bookshelf, /이어하기/);
  assert.match(bookshelf, /최근 프로젝트/);
  assert.match(bookshelf, /EPUB 생성됨/);
  assert.equal(bookshelfModel.allProjects.length, 1);
  assert.equal(selectedBookshelfProject(bookshelfModel, 0)?.projectDir, created.metadata.projectDir);
  const search = renderProjectSearchScreen(bookshelfModel, "EPUB");
  assert.match(search, /프로젝트 검색/);
  assert.match(search, /EPUB 생성됨/);
  assert.match(renderImportAnalysis(created.analysis, "균형 번역"), /\[E\] 레시피 수정/);
  assert.equal(parseImportAnalysisChoice("g"), "glossary");
  assert.equal(parseRecipePresetId("5"), 5);

  const model = await loadProjectUiModel(created.metadata.projectDir);
  assert.equal(model.sourceStatus.episodeCount, 2);
  assert.equal(model.studioQueue.next.length, 0);
  assert.equal(model.timeline.length > 0, true);
  const studio = renderStudioScreen(model);
  assert.match(studio, /지금 할 일/);
  assert.match(studio, /진행 상황/);
  assert.match(studio, /작업 흐름/);
  assert.match(studio, /품질 신호/);
  const runningStudio = renderStudioScreen(model, {
    status: "running",
    queued: 8,
    completed: 2,
    failed: 0,
    skipped: 0,
    elapsedMs: 125_000,
    estimatedRemainingMs: 375_000,
    currentEpisodeTitle: "제3화",
    activeEpisodeNos: [3],
    activeEpisodeTitles: ["제3화"],
    message: "제3화 번역 중"
  });
  assert.match(runningStudio, /번역 진행 중/);
  assert.match(runningStudio, /경과 2분 05초 · 남은 시간 약 6분 15초/);
  assert.doesNotMatch(runningStudio, /이어서 번역|진행 중으로 남아/);
  const compactStudio = renderResponsiveStudioScreen(model, null, 74, 18);
  assert.match(compactStudio, /지금 할 일/);
  assert.match(compactStudio, /진행 상황/);
  assert.match(compactStudio, /완료\s+2\/2/);
  assert.doesNotMatch(compactStudio, /품질 신호/);
  const glossaryLab = renderGlossaryLabScreen(model);
  assert.match(glossaryLab, /용어 상태/);
  assert.match(glossaryLab, /새 후보 용어/);
  assert.match(glossaryLab, /\[D\] 폐기/);
  const compactGlossary = renderResponsiveGlossaryLabScreen(model, 0, "all", [], 50, 18);
  assert.match(compactGlossary, /검토 대기/);
  assert.match(compactGlossary, /용어 상세/);
  assert.doesNotMatch(compactGlossary, /새 후보 용어/);
  const glossaryFilteredModel = {
    ...model,
    glossary: {
      ...model.glossary,
      entries: [
        {
          ...model.glossary.entries[0]!,
          source: "黒架",
          target: "흑가",
          status: "confirmed" as const,
          targetCandidates: [{ target: "쿠로카", count: 2, episodeIds: ["episode_001"] }]
        },
        {
          ...model.glossary.entries[1]!,
          source: "聖印",
          target: null,
          status: "candidate" as const,
          targetCandidates: []
        }
      ],
      conflicts: [
        {
          id: "conflict_test",
          source: "黒架",
          targets: ["쿠로카", "흑가"],
          entryIds: [model.glossary.entries[0]!.id],
          status: "open" as const,
          message: "黒架 has multiple target candidates.",
          updatedAt: new Date().toISOString()
        }
      ]
    }
  };
  const conflictsOnly = renderGlossaryLabScreen(glossaryFilteredModel, 0, "conflicts");
  assert.match(conflictsOnly, /필터: 충돌만/);
  assert.match(conflictsOnly, /> 黒架  conflict/);
  assert.doesNotMatch(conflictsOnly, /> 聖印/);
  const candidatesOnly = renderGlossaryLabScreen(glossaryFilteredModel, 0, "candidates");
  assert.match(candidatesOnly, /필터: 후보만/);
  assert.match(candidatesOnly, /> 聖印  candidate/);
  assert.doesNotMatch(candidatesOnly, /> 黒架/);
  const deferredQueue = renderGlossaryLabScreen(glossaryFilteredModel, 0, "all", [model.glossary.entries[0]!.id]);
  assert.match(deferredQueue, /나중에 1/);
  assert.match(deferredQueue, /나중에/);
  const reviewDesk = renderReviewDeskScreen(model);
  assert.match(reviewDesk, /검수 작업대/);
  assert.match(reviewDesk, /\[A\] 전체 재번역/);
  assert.match(reviewDesk, /\[F\] 같은 유형/);
  assert.match(reviewDesk, /\[C\] 재검사/);
  const reviewWithLocation = renderReviewDeskScreen({
    ...model,
    reviewDesk: {
      ...model.reviewDesk,
      openIssues: [
        {
          id: "qa_location",
          episodeId: "episode_001",
          type: "japanese_remaining",
          severity: "warning",
          message: "Japanese remains.",
          targetParagraphIndex: 2,
          targetSnippet: "それでも",
          resolved: false,
          createdAt: new Date().toISOString()
        }
      ]
    }
  });
  assert.match(reviewWithLocation, /번역문 문단 2/);
  assert.match(renderExportRoomScreen(model), /결과물 제작실/);
  assert.match(renderExportRoomScreen(model), /\[P\] 확인/);
  assert.match(renderCommandPaletteScreen("glossary", true), /용어집 연구실/);
  assert.match(renderCommandPaletteScreen("export", true), /> 결과물 제작실/);
  assert.match(renderCommandPaletteScreen("export", true, 1), /> EPUB 출력 토글/);
  assert.match(renderSettingsScreen(defaultConfig), /번역 설정/);
  assert.match(renderSettingsScreen(defaultConfig), /현재 레시피/);
  assert.match(renderSettingsScreen(defaultConfig, undefined, "advanced"), /\[엔진\]/);
  assert.match(renderSettingsScreen(defaultConfig, undefined, "advanced", undefined, 1), /OpenAI 모델/);
  const advancedSettings = buildAdvancedSettingsForm(defaultConfig);
  const engineItems = advancedSettings.find((section) => section.id === "engine")?.items ?? [];
  assert.equal(engineItems.find((item) => item.id === "codex-command")?.label, "Codex CLI 실행");
  const modelAuthItems = advancedSettings.find((section) => section.id === "model-auth")?.items ?? [];
  assert.equal(modelAuthItems.find((item) => item.id === "openai-base-url")?.kind, "input");
  const translationItems = advancedSettings.find((section) => section.id === "translation")?.items ?? [];
  const concurrency = translationItems.find((item) => item.id === "concurrency");
  assert.deepEqual(advancedSettingsOptions(concurrency!), [
    { label: "1", value: "1" },
    { label: "2", value: "2" },
    { label: "4", value: "4" },
    { label: "6", value: "6" },
    { label: "8", value: "8" }
  ]);
  assert.equal(translationItems.find((item) => item.id === "temperature")?.kind, "input");
  const reasoning = translationItems.find((item) => item.id === "reasoning-effort");
  assert.equal(reasoning?.value, "medium");
  assert.deepEqual(advancedSettingsOptions(reasoning!).map((option) => option.value), ["low", "medium", "high", "xhigh"]);
  assert.match(renderHelpScreen(), /실패 복구/);
});

test("Bookshelf search covers projects outside the recent shelf window", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-bookshelf-search-"));
  const projectRoot = join(root, "projects");
  for (let index = 0; index < 9; index += 1) {
    const sourcePath = join(root, `source-${index}.txt`);
    await writeFile(sourcePath, [`第1話 ${index}`, `本文${index}です。`].join("\n"), "utf8");
    await createProjectFromTxt({
      sourcePath,
      projectRoot,
      name: index === 0 ? "Very Old Shelf Novel" : `Recent Shelf Novel ${index}`,
      backend: "dry-run",
      model: "dry-run",
      concurrency: 1,
      glossaryStrictness: "high",
      userConfirmedRights: true
    });
  }

  const bookshelf = await loadBookshelfModel(projectRoot);
  assert.equal(bookshelf.allProjects.length, 9);
  assert.equal(bookshelf.recentProjects.length, 8);
  assert.equal(bookshelf.recentProjects.some((project) => project.title === "Very Old Shelf Novel"), false);
  assert.equal(selectedBookshelfProject(bookshelf, 999), null);
  assert.match(renderProjectSearchScreen(bookshelf, "Very Old"), /Very Old Shelf Novel/);
});

test("Drop-in analysis and Studio source status surface afterword risk", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-afterword-ui-"));
  const sourcePath = join(root, "source.txt");
  await writeFile(sourcePath, ["第1話 後記", "黒架は歩いた。", "あとがき", "読了感謝。", "", "第2話 続き", "聖印が光った。"].join("\n"), "utf8");
  const created = await createProjectFromTxt({
    sourcePath,
    projectRoot: join(root, "projects"),
    name: "Afterword Novel",
    backend: "dry-run",
    model: "dry-run",
    concurrency: 1,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });
  assert.equal(created.analysis.afterwordCount, 1);
  assert.match(renderImportAnalysis(created.analysis, "균형 번역"), /author afterword/);
  const model = await loadProjectUiModel(created.metadata.projectDir);
  assert.equal(model.sourceStatus.afterwordCount, 1);
  assert.match(renderStudioScreen(model), /후기\s+1/);
});

test("UI helpers rank safe commands first and fit multilingual terminal output", () => {
  const exportCommands = filterPaletteCommands("export", true);
  assert.equal(exportCommands[0]?.id, "open-export");
  assert.equal(exportCommands.some((command) => command.id === "skip-failed-export" && command.requiresConfirmation), true);
  assert.equal(parseImportAnalysisChoice("x"), "invalid");
  assert.equal(visibleLength("黒架"), 4);
  assert.equal(visibleLength(truncate("黒架ABCDE", 6)), 6);
  const fitted = fitToViewport(["제목", "subtitle", "", "一", "二", "三", "四", "", "footer"].join("\n"), { width: 20, height: 6 });
  assert.equal(fitted.split("\n").length, 6);
  assert.doesNotMatch(fitted, /줄 숨김|터미널을 키우거나/);
  assert.match(fitted, /…/);
  assert.match(fitted, /footer/);
});
