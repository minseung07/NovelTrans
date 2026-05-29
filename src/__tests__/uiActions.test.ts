import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough, Writable } from "node:stream";
import type { ReadStream, WriteStream } from "node:tty";
import { createProjectFromTxt, loadProjectOverview, runTranslation } from "../engine/projectWorkflow.js";
import { exportProject } from "../export/exporter.js";
import { loadProjectUiModel } from "../ui/studioData.js";
import {
  confirmSelectedGlossaryTerm,
  discardSelectedGlossaryTerm,
  exportGlossaryJson,
  forbidSelectedGlossaryTarget,
  relatedTermsForEpisode,
  relatedTermsForIssue
} from "../ui/actions/glossaryActions.js";
import { buildGlossaryQueue, deferSelectedGlossaryQueueItem } from "../ui/glossaryQueue.js";
import {
  formatExportPreview,
  generateConfiguredExports,
  openOutputFolder,
  setCoverImagePath,
  toggleAfterword,
  toggleGlossaryAppendix,
  toggleOutputFormat,
  toggleVerticalWriting
} from "../ui/actions/exportActions.js";
import {
  adjustConcurrency,
  applyRecipePreset,
  cycleCodexCliModel,
  cycleDefaultBackend,
  cycleGlossaryStrictness,
  cycleOpenAICompatibleModel,
  toggleDefaultOutputFormat
} from "../ui/actions/settingsActions.js";
import { defaultConfig } from "../config/defaultConfig.js";
import { markSelectedIssueIgnored, openSelectedIssueTranslation, recheckReviewDeskQA, retrySelectedIssueEpisode } from "../ui/actions/reviewActions.js";
import { listEpisodes, loadGlossary, loadProjectMetadata, saveQAIssues } from "../storage/projectStore.js";
import { projectPaths } from "../storage/projectPaths.js";
import { ProjectStateStore } from "../storage/stateStore.js";
import { createTranslatorAdapter } from "../translation/adapters/adapterFactory.js";
import { errorLogPath, skipFailedAndExport } from "../ui/actions/failureActions.js";
import { renderFailureRecoveryScreen } from "../ui/screens/failureRecoveryScreen.js";
import { readProjectLogTail } from "../storage/logger.js";
import { executePaletteCommand } from "../ui/paletteExecution.js";
import { handleSettingsKey } from "../ui/keyHandlers/settingsKeyHandler.js";
import { backFromTerminalSpace, createInitialTerminalState, moveTerminalSelection } from "../ui/terminalState.js";
import { primaryStudioKeyIntent } from "../ui/studioKeyIntents.js";
import { normalizeSourcePathInput } from "../ui/sourcePathInput.js";
import { TerminalLineReader } from "../ui/terminalLineReader.js";
import { runImportDropInFlow } from "../ui/importDropInFlow.js";
import { buildNextActions } from "../ui/nextActions.js";
import { createUndoAction, hideUndoHint, scopedUndoAction, visibleUndoHint } from "../ui/undoState.js";
import { formatWebImportProgress } from "../ui/webImportProgress.js";
import { buildReviewRetranslationQueue, createReviewRetranslationTask } from "../ui/reviewRetranslationTask.js";
import { hideReviewDeskEpisodes } from "../ui/reviewDeskModel.js";
import type { QAIssue } from "../domain/qa.js";
import type { TranslatorAdapter } from "../domain/translation.js";

test("UI actions mutate glossary, review inbox, and export options", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-ui-actions-"));
  const sourcePath = join(root, "source.txt");
  await writeFile(sourcePath, ["第1話 黒架", "黒架は聖印を見た。", "", "第2話 聖印", "聖印は黒架を導いた。"].join("\n"), "utf8");
  const created = await createProjectFromTxt({
    sourcePath,
    projectRoot: join(root, "projects"),
    name: "Action Novel",
    backend: "dry-run",
    model: "dry-run",
    concurrency: 1,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });

  let model = await loadProjectUiModel(created.metadata.projectDir);
  const confirmMessage = await confirmSelectedGlossaryTerm(created.metadata.projectDir, model, 0, "흑가", true);
  assert.match(confirmMessage, /용어를 고정/);
  let glossary = await loadGlossary(created.metadata.projectDir);
  assert.equal(glossary.entries.some((entry) => entry.target === "흑가" && entry.locked), true);

  model = await loadProjectUiModel(created.metadata.projectDir);
  const forbidMessage = await forbidSelectedGlossaryTarget(created.metadata.projectDir, model, 0, "쿠로카");
  assert.match(forbidMessage, /금지 번역/);
  glossary = await loadGlossary(created.metadata.projectDir);
  assert.equal(glossary.entries.some((entry) => entry.forbiddenTargets.includes("쿠로카")), true);
  const exportedGlossary = await exportGlossaryJson(created.metadata.projectDir);
  assert.match(exportedGlossary, /glossary\.json$/);
  assert.match(await readFile(exportedGlossary, "utf8"), /흑가/);
  model = await loadProjectUiModel(created.metadata.projectDir);
  assert.match(relatedTermsForEpisode(model, model.episodes[0]?.title ?? null), /관련 용어/);
  const queueBeforeDiscard = buildGlossaryQueue(model);
  assert.equal(queueBeforeDiscard.length > 0, true);
  const deferred = deferSelectedGlossaryQueueItem(model, 0);
  assert.match(deferred.message, /나중에 볼 용어/);
  assert.equal(buildGlossaryQueue(model, "all", deferred.deferredEntryIds).at(-1)?.entry.id, queueBeforeDiscard[0]!.entry.id);
  const discardedSource = queueBeforeDiscard[0]!.entry.source;
  const discarded = await discardSelectedGlossaryTerm(created.metadata.projectDir, model, 0);
  assert.match(discarded, /후보 용어를 폐기/);
  glossary = await loadGlossary(created.metadata.projectDir);
  assert.equal(glossary.entries.find((entry) => entry.source === discardedSource)?.status, "deprecated");
  model = await loadProjectUiModel(created.metadata.projectDir);
  assert.equal(buildGlossaryQueue(model).some((item) => item.entry.source === discardedSource), false);

  const episodes = await listEpisodes(created.metadata.projectDir);
  const issue: QAIssue = {
    id: "qa_test_issue",
    episodeId: episodes[0]!.id,
    type: "japanese_remaining",
    severity: "warning",
    message: "Test issue",
    resolved: false,
    createdAt: new Date().toISOString()
  };
  await saveQAIssues(created.metadata.projectDir, episodes[0]!, [issue]);
  model = await loadProjectUiModel(created.metadata.projectDir);
  assert.equal(model.reviewDesk.openIssues.length, 1);
  assert.equal(model.reviewDesk.buckets.find((bucket) => bucket.id === "japanese")?.count, 1);
  assert.match(relatedTermsForIssue(model, 0), /episode_001/);
  const fakeEditor = join(root, "fake-editor.mjs");
  const openedPathLog = join(root, "opened-path.txt");
  await writeFile(
    fakeEditor,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      `writeFileSync(${JSON.stringify(openedPathLog)}, process.argv.at(-1) ?? '', 'utf8');`
    ].join("\n"),
    "utf8"
  );
  await chmod(fakeEditor, 0o755);
  const opened = await openSelectedIssueTranslation(created.metadata.projectDir, model, 0, {
    editorCommand: fakeEditor,
    wait: true
  });
  assert.match(opened, /열었습니다/);
  const openedPath = await readFile(openedPathLog, "utf8");
  assert.match(openedPath, /episode_001\.md$/);

  const ignored = await markSelectedIssueIgnored(created.metadata.projectDir, model, 0);
  assert.match(ignored, /검수 항목을 숨/);
  model = await loadProjectUiModel(created.metadata.projectDir);
  assert.equal(model.qaIssues.find((item) => item.id === issue.id)?.resolved, true);
  const rechecked = await recheckReviewDeskQA(created.metadata.projectDir);
  assert.match(rechecked, /검수 재검사/);

  await toggleOutputFormat(created.metadata.projectDir, "epub");
  await toggleGlossaryAppendix(created.metadata.projectDir);
  await toggleAfterword(created.metadata.projectDir);
  await toggleVerticalWriting(created.metadata.projectDir);
  const metadata = await loadProjectMetadata(created.metadata.projectDir);
  assert.equal(metadata.outputOptions.formats.includes("epub"), false);
  assert.equal(metadata.outputOptions.includeGlossaryAppendix, false);
  assert.equal(metadata.outputOptions.includeAfterword, false);
  assert.equal(metadata.outputOptions.verticalWriting, true);
});

test("Export Room cover image option is written into EPUB output", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-cover-"));
  const sourcePath = join(root, "source.txt");
  const coverPath = join(root, "cover.png");
  await writeFile(sourcePath, ["第1話 表紙", "黒架は表紙を見た。"].join("\n"), "utf8");
  await writeFile(coverPath, Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"));
  const created = await createProjectFromTxt({
    sourcePath,
    projectRoot: join(root, "projects"),
    name: "Cover Novel",
    backend: "dry-run",
    model: "dry-run",
    concurrency: 1,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });

  await setCoverImagePath(created.metadata.projectDir, coverPath);
  await generateConfiguredExports(created.metadata.projectDir);
  const model = await loadProjectUiModel(created.metadata.projectDir);
  assert.match(formatExportPreview(model), /Cover Novel/);
  const fakeOpener = join(root, "fake-opener.mjs");
  const openedFolderLog = join(root, "opened-folder.txt");
  await writeFile(
    fakeOpener,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      `writeFileSync(${JSON.stringify(openedFolderLog)}, process.argv.at(-1) ?? '', 'utf8');`
    ].join("\n"),
    "utf8"
  );
  await chmod(fakeOpener, 0o755);
  const openedFolder = await openOutputFolder(created.metadata.projectDir, {
    editorCommand: fakeOpener,
    wait: true
  });
  assert.match(openedFolder, /열었습니다/);
  assert.match(await readFile(openedFolderLog, "utf8"), /exports$/);
  const epub = await readFile(join(created.metadata.projectDir, "exports", "cover-novel.epub"));
  const asText = epub.toString("latin1");
  assert.match(asText, /cover\.png/);
  assert.match(asText, /cover-image/);
});

test("Failure Recovery can skip failed episodes and export completed translations", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-failure-recovery-"));
  const sourcePath = join(root, "source.txt");
  await writeFile(
    sourcePath,
    ["第1話 起動", "黒架は歩いた。", "", "第2話 失敗", "聖印は揺れた。", "", "第3話 完了", "魔導炉は光った。"].join("\n"),
    "utf8"
  );
  const created = await createProjectFromTxt({
    sourcePath,
    projectRoot: join(root, "projects"),
    name: "Recovery Novel",
    backend: "dry-run",
    model: "dry-run",
    concurrency: 2,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });

  await runTranslation(
    created.metadata.projectDir,
    createTranslatorAdapter("dry-run", defaultConfig, { failEpisodeIds: ["episode_002"] }),
    "resume",
    2
  );

  let model = await loadProjectUiModel(created.metadata.projectDir);
  assert.equal(model.failureRecovery.failedCount, 1);
  assert.equal(model.nextActions[0]?.commandId, "open-failure-recovery");
  assert.match(renderFailureRecoveryScreen(model), /건너뛰고 완료분/);
  assert.match(errorLogPath(created.metadata.projectDir), /error\.log$/);

  const message = await skipFailedAndExport(created.metadata.projectDir);
  assert.match(message, /실패 화 1개/);
  assert.match(message, /2개 파일/);

  const overview = await loadProjectOverview(created.metadata.projectDir);
  assert.equal(overview.counts.failed, 0);
  assert.equal(overview.counts.skipped, 1);
  assert.equal(overview.counts.completed, 2);
  model = await loadProjectUiModel(created.metadata.projectDir);
  assert.equal(model.exportPreview.txtExists, true);
  assert.equal(model.exportPreview.epubExists, true);

  const translationEvents = await readProjectLogTail(created.metadata.projectDir, "translation", 10);
  assert.equal(translationEvents.some((event) => event.event === "failed_episodes_skipped"), true);
});

test("export preview and files exclude stale translations for skipped episodes", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-exportable-state-"));
  const sourcePath = join(root, "source.txt");
  await writeFile(sourcePath, ["第1話 完了", "黒架は歩いた。", "", "第2話 除外", "聖印は残った。"].join("\n"), "utf8");
  const created = await createProjectFromTxt({
    sourcePath,
    projectRoot: join(root, "projects"),
    name: "Stale Export Novel",
    backend: "dry-run",
    model: "dry-run",
    concurrency: 1,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });
  await runTranslation(created.metadata.projectDir, createTranslatorAdapter("dry-run", defaultConfig), "resume", 1);
  const episodes = await listEpisodes(created.metadata.projectDir);
  const stateStore = new ProjectStateStore(projectPaths(created.metadata.projectDir).projectDb);
  try {
    stateStore.setEpisodeStatus(episodes[1]!.id, "skipped", "Skipped after stale translation was written.");
  } finally {
    stateStore.close();
  }

  const model = await loadProjectUiModel(created.metadata.projectDir);
  assert.equal(model.exportPreview.translatedEpisodeCount, 1);
  const exported = await exportProject(await loadProjectMetadata(created.metadata.projectDir), ["txt"]);
  assert.equal(exported.translatedEpisodeCount, 1);
  const txt = await readFile(exported.files[0]!, "utf8");
  assert.match(txt, /제1화/);
  assert.doesNotMatch(txt, /제2화/);
});

test("Review Desk retranslate only retries the selected issue episode", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-review-single-retry-"));
  const sourcePath = join(root, "source.txt");
  await writeFile(sourcePath, ["第1話 修正", "黒架は歩いた。", "", "第2話 未処理", "聖印が揺れた。"].join("\n"), "utf8");
  const created = await createProjectFromTxt({
    sourcePath,
    projectRoot: join(root, "projects"),
    name: "Review Retry Novel",
    backend: "dry-run",
    model: "dry-run",
    concurrency: 1,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });
  const episodes = await listEpisodes(created.metadata.projectDir);
  const issue: QAIssue = {
    id: "qa_retry_selected",
    episodeId: episodes[0]!.id,
    type: "japanese_remaining",
    severity: "warning",
    message: "Selected issue",
    resolved: false,
    createdAt: new Date().toISOString()
  };
  await saveQAIssues(created.metadata.projectDir, episodes[0]!, [issue]);

  const stateStore = new ProjectStateStore(projectPaths(created.metadata.projectDir).projectDb);
  try {
    stateStore.setEpisodeStatus(episodes[1]!.id, "failed", "Unrelated failure");
  } finally {
    stateStore.close();
  }

  const model = await loadProjectUiModel(created.metadata.projectDir);
  const message = await retrySelectedIssueEpisode(created.metadata.projectDir, model, 0, createTranslatorAdapter("dry-run", defaultConfig));
  assert.match(message, /완료 1, 실패 0/);
  const overview = await loadProjectOverview(created.metadata.projectDir);
  assert.equal(overview.counts.completed, 1);
  assert.equal(overview.counts.failed, 1);
  const states = overview.episodeStates;
  assert.equal(states.find((state) => state.episodeId === episodes[0]!.id)?.status, "completed");
  assert.equal(states.find((state) => state.episodeId === episodes[1]!.id)?.status, "failed");
});

test("Review retranslation queue deduplicates issues by episode and supports same-type scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-review-queue-"));
  const sourcePath = join(root, "source.txt");
  await writeFile(sourcePath, ["第1話 A", "黒架は歩いた。", "", "第2話 B", "聖印が揺れた。", "", "第3話 C", "魔導炉が光った。"].join("\n"), "utf8");
  const created = await createProjectFromTxt({
    sourcePath,
    projectRoot: join(root, "projects"),
    name: "Review Queue Novel",
    backend: "dry-run",
    model: "dry-run",
    concurrency: 1,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });
  const episodes = await listEpisodes(created.metadata.projectDir);
  const issues: QAIssue[] = [
    {
      id: "qa_queue_1",
      episodeId: episodes[0]!.id,
      type: "japanese_remaining",
      severity: "warning",
      message: "Japanese remains",
      resolved: false,
      createdAt: new Date().toISOString()
    },
    {
      id: "qa_queue_2",
      episodeId: episodes[0]!.id,
      type: "number_mismatch",
      severity: "warning",
      message: "Number mismatch",
      resolved: false,
      createdAt: new Date().toISOString()
    },
    {
      id: "qa_queue_3",
      episodeId: episodes[1]!.id,
      type: "japanese_remaining",
      severity: "warning",
      message: "Japanese remains",
      resolved: false,
      createdAt: new Date().toISOString()
    }
  ];
  await saveQAIssues(created.metadata.projectDir, episodes[0]!, issues.slice(0, 2));
  await saveQAIssues(created.metadata.projectDir, episodes[1]!, [issues[2]!]);

  const model = await loadProjectUiModel(created.metadata.projectDir);
  const allQueue = buildReviewRetranslationQueue(model, 0, "all-open");
  assert.deepEqual(allQueue.map((item) => item.episodeId), [episodes[0]!.id, episodes[1]!.id]);
  assert.deepEqual(allQueue[0]?.issueTypes.sort(), ["japanese_remaining", "number_mismatch"].sort());
  const sameTypeQueue = buildReviewRetranslationQueue(model, 0, "same-type");
  assert.deepEqual(sameTypeQueue.map((item) => item.episodeId), [episodes[0]!.id, episodes[1]!.id]);
  const selectedQueue = buildReviewRetranslationQueue(model, 1, "selected");
  assert.deepEqual(selectedQueue.map((item) => item.episodeId), [episodes[0]!.id]);
  assert.deepEqual(selectedQueue[0]?.issueTypes, ["number_mismatch"]);
});

test("Review retranslation queue hides queued episodes and accepts additions while running", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-review-append-"));
  const sourcePath = join(root, "source.txt");
  await writeFile(sourcePath, ["第1話 A", "黒架は歩いた。", "", "第2話 B", "聖印が揺れた。"].join("\n"), "utf8");
  const created = await createProjectFromTxt({
    sourcePath,
    projectRoot: join(root, "projects"),
    name: "Review Append Novel",
    backend: "dry-run",
    model: "dry-run",
    concurrency: 1,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });
  const episodes = await listEpisodes(created.metadata.projectDir);
  await saveQAIssues(created.metadata.projectDir, episodes[0]!, [
    {
      id: "qa_append_1",
      episodeId: episodes[0]!.id,
      type: "japanese_remaining",
      severity: "warning",
      message: "Japanese remains",
      resolved: false,
      createdAt: new Date().toISOString()
    }
  ]);
  await saveQAIssues(created.metadata.projectDir, episodes[1]!, [
    {
      id: "qa_append_2",
      episodeId: episodes[1]!.id,
      type: "number_mismatch",
      severity: "warning",
      message: "Number mismatch",
      resolved: false,
      createdAt: new Date().toISOString()
    }
  ]);

  const model = await loadProjectUiModel(created.metadata.projectDir);
  const hiddenReviewDesk = hideReviewDeskEpisodes(model.reviewDesk, [episodes[0]!.id]);
  assert.deepEqual(hiddenReviewDesk.openIssues.map((issue) => issue.episodeId), [episodes[1]!.id]);

  const baseAdapter = createTranslatorAdapter("dry-run", defaultConfig);
  let delayFirstEpisode = true;
  const adapter: TranslatorAdapter = {
    id: "slow-dry-run",
    label: "Slow dry-run",
    checkAvailability: () => baseAdapter.checkAvailability(),
    translateEpisode: async (input) => {
      if (delayFirstEpisode) {
        delayFirstEpisode = false;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return baseAdapter.translateEpisode(input);
    }
  };
  const task = createReviewRetranslationTask({
    projectDir: created.metadata.projectDir,
    model,
    selectedIssueIndex: 0,
    adapter,
    scope: "selected"
  });
  assert.ok(task);
  assert.deepEqual(task.queuedEpisodeIds(), [episodes[0]!.id]);

  const added = task.enqueue(buildReviewRetranslationQueue(model, 1, "selected"));
  assert.equal(added, 1);
  assert.deepEqual(task.queuedEpisodeIds().sort(), [episodes[0]!.id, episodes[1]!.id].sort());
  assert.equal(task.snapshot().queued, 2);

  const { snapshot } = await task.done;
  assert.equal(snapshot.completed, 2);
  assert.equal(snapshot.status, "completed");
});

test("Settings recipe controls persist backend, speed, glossary strictness, and outputs", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "noveltrans-settings-"));
  let preset = applyRecipePreset(defaultConfig, 3);
  assert.equal(preset.translationStyle, "literary-naturalization");
  preset = applyRecipePreset(defaultConfig, 5);
  assert.equal(preset.translationStyle, "terminology-consistency");
  preset = applyRecipePreset({ ...defaultConfig, defaultBackend: "codex-cli" }, 1);
  assert.equal(preset.defaultBackend, "codex-cli");
  let config = await cycleDefaultBackend(defaultConfig, configDir);
  assert.equal(config.defaultBackend, "openai-compatible");
  config = await adjustConcurrency(config, 3, configDir);
  assert.equal(config.concurrency, defaultConfig.concurrency + 3);
  config = await cycleGlossaryStrictness(config, configDir);
  assert.equal(config.glossaryStrictness, "strict");
  config = await toggleDefaultOutputFormat(config, "epub", configDir);
  assert.equal(config.outputFormats.includes("epub"), false);
  config = await cycleOpenAICompatibleModel(config, configDir);
  assert.equal(config.openAICompatible.model, "gpt-5.4");
  config = await cycleCodexCliModel(config, configDir);
  assert.equal(config.codexCli.model, "gpt-5.4");
});

test("Import Drop-in applies recipe changes to the created project", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-dropin-recipe-"));
  const sourcePath = join(root, "source.txt");
  await writeFile(sourcePath, ["第1話 レシピ", "黒架は歩いた。", "", "第2話 続き", "聖印が光った。"].join("\n"), "utf8");
  const input = new PassThrough() as PassThrough & { isRaw: boolean; setRawMode: (raw: boolean) => void };
  input.isRaw = false;
  input.setRawMode = (raw: boolean) => {
    input.isRaw = raw;
  };
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  });

  const flow = runImportDropInFlow({
    config: defaultConfig,
    configDir: join(root, "config"),
    projectRoot: join(root, "projects"),
    input: input as unknown as ReadStream,
    output: output as unknown as WriteStream
  });
  input.write(`${sourcePath}\ne\n1\n\n`);

  const result = await flow;
  assert.ok(result.projectDir);
  const metadata = await loadProjectMetadata(result.projectDir);
  assert.equal(metadata.options.translationStyle, "fast-draft");
  assert.equal(metadata.options.concurrency, 4);
  assert.equal(metadata.options.glossaryStrictness, "medium");
});

test("Terminal settings and navigation helpers update isolated UI state", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "noveltrans-terminal-state-"));
  let result = await handleSettingsKey({ key: "3", config: defaultConfig, configDir });
  assert.equal(result.config.translationStyle, "literary-naturalization");
  assert.equal(result.message, "레시피 3번을 적용했습니다.");
  result = await handleSettingsKey({ key: "+", config: result.config, configDir, mode: "advanced" });
  assert.equal(result.config.concurrency, 3);
  assert.equal(result.message, "동시 작업 수: 3.");
  result = await handleSettingsKey({ key: "o", config: result.config, configDir, mode: "advanced" });
  assert.equal(result.config.openAICompatible.model, "gpt-5.4");
  assert.equal(result.message, "OpenAI 호환 모델: gpt-5.4.");
  result = await handleSettingsKey({ key: "c", config: result.config, configDir, mode: "advanced" });
  assert.equal(result.config.codexCli.model, "gpt-5.4");
  assert.equal(result.message, "Codex 모델: gpt-5.4.");
  result = await handleSettingsKey({ key: "+", config: result.config, configDir, mode: "basic" });
  assert.equal(result.config.concurrency, 3);
  assert.equal(result.message, null);
  result = await handleSettingsKey({ key: "a", config: result.config, configDir });
  assert.equal(result.message, null);

  const state = createInitialTerminalState();
  assert.equal(state.settingsMode, "basic");
  moveTerminalSelection(state, 1);
  assert.equal(state.selectedProjectIndex, 1);
  moveTerminalSelection(state, 1, 1);
  assert.equal(state.selectedProjectIndex, 1);
  state.space = "settings";
  state.previousSpace = "bookshelf";
  backFromTerminalSpace(state);
  assert.equal(state.space, "bookshelf");
  state.projectDir = "/tmp/noveltrans-project";
  state.space = "review-desk";
  backFromTerminalSpace(state);
  assert.equal(state.space, "studio");
});

test("Undo hints are contextual and do not persist visually after the next action", () => {
  const state = createInitialTerminalState();
  state.space = "review-desk";
  state.projectDir = "/tmp/noveltrans-project";
  const undo = createUndoAction({
    label: "검수 항목 복원",
    state,
    run: async () => "restored"
  });
  assert.equal(visibleUndoHint(undo, state)?.label, "검수 항목 복원");
  const hidden = hideUndoHint(undo);
  assert.equal(visibleUndoHint(hidden, state), null);
  assert.equal(scopedUndoAction(hidden, state)?.label, "검수 항목 복원");
  state.space = "studio";
  assert.equal(scopedUndoAction(hidden, state), null);
});

test("Command Palette executor separates global commands from project-only commands", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "noveltrans-palette-"));
  const backend = await executePaletteCommand({
    commandId: "settings-cycle-backend",
    config: defaultConfig,
    configDir,
    projectDir: null,
    previousSpace: "bookshelf",
    selectedIssueIndex: 0,
    currentEpisodeTitle: null,
    loadProjectModel: async () => {
      throw new Error("Project model should not be loaded for global settings command.");
    }
  });
  assert.equal(backend.space, "settings");
  assert.equal(backend.config?.defaultBackend, "openai-compatible");

  const projectOnly = await executePaletteCommand({
    commandId: "open-review",
    config: defaultConfig,
    configDir,
    projectDir: null,
    previousSpace: "bookshelf",
    selectedIssueIndex: 0,
    currentEpisodeTitle: null,
    loadProjectModel: async () => {
      throw new Error("Project model should not be loaded when no project is open.");
    }
  });
  assert.equal(projectOnly.space, "bookshelf");
  assert.equal(projectOnly.message, "먼저 프로젝트를 여세요.");

  const conflicts = await executePaletteCommand({
    commandId: "glossary-conflicts",
    config: defaultConfig,
    configDir,
    projectDir: "/tmp/noveltrans-project",
    previousSpace: "studio",
    selectedIssueIndex: 0,
    currentEpisodeTitle: null,
    loadProjectModel: async () => {
      throw new Error("Glossary filter command should not need the project model.");
    }
  });
  assert.equal(conflicts.space, "glossary-lab");
  assert.equal(conflicts.glossaryFilter, "conflicts");

  const retranslate = await executePaletteCommand({
    commandId: "review-retranslate-issue",
    config: defaultConfig,
    configDir,
    projectDir: "/tmp/noveltrans-project",
    previousSpace: "review-desk",
    selectedIssueIndex: 0,
    currentEpisodeTitle: null,
    loadProjectModel: async () => {
      throw new Error("Review retranslation should be started by the terminal app as a background effect.");
    }
  });
  assert.equal(retranslate.space, "studio");
  assert.deepEqual(retranslate.effect, { type: "review-retranslate-issue", scope: "selected" });

  const retranslateAll = await executePaletteCommand({
    commandId: "review-retranslate-all",
    config: defaultConfig,
    configDir,
    projectDir: "/tmp/noveltrans-project",
    previousSpace: "review-desk",
    selectedIssueIndex: 0,
    currentEpisodeTitle: null,
    loadProjectModel: async () => {
      throw new Error("Review retranslation queue should be started by the terminal app as a background effect.");
    }
  });
  assert.deepEqual(retranslateAll.effect, { type: "review-retranslate-issue", scope: "all-open" });

  assert.deepEqual(
    primaryStudioKeyIntent(
      {
        failureRecovery: { failedCount: 0, items: [], logPath: "/tmp/error.log" },
        nextActions: [
          {
            priority: 20,
            severity: "warning",
            commandId: "glossary-conflicts",
            commandHint: "[G] 충돌 검토",
            message: "충돌 용어 확인"
          }
        ]
      } as unknown as Parameters<typeof primaryStudioKeyIntent>[0],
      "g"
    ),
    { type: "open-space", space: "glossary-lab", glossaryFilter: "conflicts" }
  );
});

test("source path input accepts common pasted path forms", () => {
  assert.equal(normalizeSourcePathInput("\u001b[200~'/tmp/source file.txt'\u001b[201~"), "/tmp/source file.txt");
  assert.equal(normalizeSourcePathInput("file:///tmp/source%20file.txt"), "/tmp/source file.txt");
  assert.equal(normalizeSourcePathInput("/tmp/source\\ file.txt"), "/tmp/source file.txt");
});

test("TerminalLineReader buffers multiline pasted input", async () => {
  const input = new PassThrough() as PassThrough & { isRaw: boolean; setRawMode: (raw: boolean) => void };
  input.isRaw = false;
  input.setRawMode = (raw: boolean) => {
    input.isRaw = raw;
  };
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  });
  const reader = new TerminalLineReader(input as unknown as ReadStream, output as unknown as WriteStream);
  reader.start();
  try {
    const first = reader.readLine("");
    input.write("\u001b[200~/tmp/source.txt\u001b[201~\nline two\nEOF\n");
    assert.equal(await first, "/tmp/source.txt");
    assert.equal(await reader.readLine(""), "line two");
    assert.equal(await reader.readLine(""), "EOF");
  } finally {
    reader.close();
  }
});

test("TerminalLineReader reads single-key confirmations without requiring Enter", async () => {
  const input = new PassThrough() as PassThrough & { isRaw: boolean; setRawMode: (raw: boolean) => void };
  input.isRaw = false;
  input.setRawMode = (raw: boolean) => {
    input.isRaw = raw;
  };
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  });
  const reader = new TerminalLineReader(input as unknown as ReadStream, output as unknown as WriteStream);
  reader.start();
  try {
    const key = reader.readKey("");
    input.write("y");
    assert.equal(await key, "y");

    const keyWithTrailingEnter = reader.readKey("");
    input.write("r\n1-3\n");
    assert.equal(await keyWithTrailingEnter, "r");
    assert.equal(await reader.readLine(""), "1-3");
  } finally {
    reader.close();
  }
});

test("web import progress keeps elapsed time before variable episode titles", () => {
  const line = formatWebImportProgress({
    phase: "episode-start",
    completed: 1,
    total: 10,
    episode: {
      no: 2,
      title: "아주 긴 제목의 두 번째 화",
      url: "https://kakuyomu.jp/works/1/episodes/2",
      remoteId: "2"
    }
  }, Date.now() - 5000);
  assert.match(line, /가져오는 중.*경과 .*남은 약 .*아주 긴 제목/);
  assert.equal(line.indexOf("경과") < line.indexOf("아주 긴 제목"), true);
});

test("Next Action continues translation when episodes are left running", () => {
  const actions = buildNextActions({
    overview: {
      counts: {
        pending: 0,
        running: 4,
        completed: 6,
        failed: 0,
        skipped: 0
      },
      metadata: {
        options: { concurrency: 4 }
      }
    },
    qaIssues: [],
    glossaryPulse: {
      conflicts: 0
    },
    liveEvents: []
  } as unknown as Parameters<typeof buildNextActions>[0]);

  assert.equal(actions[0]?.commandId, "continue-translation");
  assert.match(actions[0]?.message ?? "", /진행 중/);
});
