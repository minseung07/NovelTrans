import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultConfig } from "../config/defaultConfig.js";
import { exportProject } from "../export/exporter.js";
import { createProjectFromText, createProjectFromTxt, loadProjectOverview, rerunProjectQA, runTranslation } from "../engine/projectWorkflow.js";
import { createTranslatorAdapter } from "../translation/adapters/adapterFactory.js";
import {
  discoverProjectDirs,
  listEpisodes,
  loadGlossary,
  loadProjectMetadata,
  readAllQAIssues,
  readTranslation,
  saveGlossary,
  saveProjectMetadata,
  saveQAIssues,
  saveTranslation
} from "../storage/projectStore.js";
import { readProjectLogTail } from "../storage/logger.js";
import { qaEpisodePath, translationJsonPath, translationMarkdownPath } from "../storage/projectPaths.js";
import { importSourceForUi } from "../ui/actions/importActions.js";
import { loadProjectUiModel } from "../ui/studioData.js";
import type { AdapterStatus, TranslationInput, TranslationResult, TranslatorAdapter } from "../domain/translation.js";
import { nowIso } from "../utils/time.js";
import { WebImportService } from "../webImport/webImportService.js";
import type { WebFetch } from "../webImport/httpClient.js";

test("runs dry-run project creation, resume, failed retry, and TXT/EPUB export", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-"));
  const sourcePath = join(root, "source.txt");
  await writeFile(
    sourcePath,
    [
      "第1話 黒架",
      "黒架は第七区で聖印を見た。12人の騎士がいた。",
      "",
      "第2話 聖印",
      "聖印は黒架を導いた。影縫いの剣が光った。",
      "",
      "第3話 帰還",
      "黒架は魔導炉へ戻った。12の鐘が鳴った。"
    ].join("\n"),
    "utf8"
  );

  const created = await createProjectFromTxt({
    sourcePath,
    projectRoot: join(root, "projects"),
    name: "Dry Run Novel",
    backend: "dry-run",
    model: "dry-run",
    concurrency: 2,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });
  assert.equal(created.analysis.episodeCount, 3);
  assert.equal(created.glossary.entries.length > 0, true);

  const failingAdapter = createTranslatorAdapter("dry-run", defaultConfig, { failEpisodeIds: ["episode_00002"] });
  const firstRun = await runTranslation(created.metadata.projectDir, failingAdapter, "resume", 2);
  assert.equal(firstRun.queued, 3);
  assert.equal(firstRun.completed, 2);
  assert.equal(firstRun.failed, 1);

  let overview = await loadProjectOverview(created.metadata.projectDir);
  assert.equal(overview.counts.failed, 1);
  assert.equal(overview.counts.completed, 2);

  const retryAdapter = createTranslatorAdapter("dry-run", defaultConfig);
  const retry = await runTranslation(created.metadata.projectDir, retryAdapter, "retry-failed", 1);
  assert.equal(retry.queued, 1);
  assert.equal(retry.completed, 1);
  assert.equal(retry.failed, 0);

  overview = await loadProjectOverview(created.metadata.projectDir);
  assert.equal(overview.counts.completed, 3);

  const metadata = await loadProjectMetadata(created.metadata.projectDir);
  const exported = await exportProject(metadata, ["txt", "epub"]);
  assert.equal(exported.files.length, 2);
  for (const file of exported.files) {
    const info = await stat(file);
    assert.equal(info.size > 0, true);
  }

  const txt = await readFile(exported.files.find((file) => file.endsWith(".txt"))!, "utf8");
  assert.match(txt, /제1화/);
  const epub = await readFile(exported.files.find((file) => file.endsWith(".epub"))!);
  assert.equal(epub.subarray(0, 2).toString("utf8"), "PK");

  const translationEvents = await readProjectLogTail(created.metadata.projectDir, "translation", 20);
  assert.equal(translationEvents.some((event) => event.event === "episode_completed"), true);
  const exportEvents = await readProjectLogTail(created.metadata.projectDir, "export", 5);
  assert.equal(exportEvents.some((event) => event.event === "export_completed"), true);
  assert.equal((await loadProjectMetadata(created.metadata.projectDir)).status, "exported");
});

test("creates a project from pasted source text", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-pasted-"));
  const created = await createProjectFromText({
    sourceText: ["第1話 貼付", "貼付本文です。", "", "第2話 続き", "続きです。"].join("\n"),
    sourceLabel: "paste://test",
    projectRoot: join(root, "projects"),
    name: "Pasted Source",
    backend: "dry-run",
    model: "dry-run",
    concurrency: 1,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });
  assert.equal(created.analysis.episodeCount, 2);
  assert.equal(created.metadata.sourcePath, "paste://test");
  const overview = await loadProjectOverview(created.metadata.projectDir);
  assert.equal(overview.counts.pending, 2);
});

test("episode artifacts are ordered numerically and legacy 3-digit files stay readable", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-long-order-"));
  const projectDir = join(root, "project");
  await Promise.all([mkdir(join(projectDir, "source"), { recursive: true }), mkdir(join(projectDir, "translated"), { recursive: true }), mkdir(join(projectDir, "logs"), { recursive: true })]);
  const episode999 = {
    id: "episode_999",
    episodeNo: 999,
    title: "第999話",
    sourceText: "黒架は歩いた。",
    body: "黒架は歩いた。",
    sourceHash: "hash999",
    metadata: {}
  };
  const episode1000 = {
    id: "episode_1000",
    episodeNo: 1000,
    title: "第1000話",
    sourceText: "聖印が光った。",
    body: "聖印が光った。",
    sourceHash: "hash1000",
    metadata: {}
  };
  const episode1001 = {
    id: "episode_1001",
    episodeNo: 1001,
    title: "第1001話",
    sourceText: "魔導炉が鳴った。",
    body: "魔導炉が鳴った。",
    sourceHash: "hash1001",
    metadata: {}
  };
  await Promise.all([
    writeFile(join(projectDir, "source", "episode_1000.json"), JSON.stringify(episode1000), "utf8"),
    writeFile(join(projectDir, "source", "episode_999.json"), JSON.stringify(episode999), "utf8"),
    writeFile(join(projectDir, "source", "episode_01001.json"), JSON.stringify(episode1001), "utf8"),
    writeFile(
      join(projectDir, "translated", "episode_999.json"),
      JSON.stringify({
        episodeId: "episode_999",
        titleKo: "제999화",
        bodyKo: "오래된 번역",
        usedGlossaryEntries: [],
        newGlossaryCandidates: [],
        qaIssueIds: [],
        model: "legacy",
        backend: "dry-run",
        createdAt: nowIso()
      }),
      "utf8"
    ),
    writeFile(
      join(projectDir, "logs", "episode_1000.qa.json"),
      JSON.stringify([{ id: "qa1000", episodeId: "episode_1000", type: "japanese_remaining", severity: "warning", message: "1000", resolved: false, createdAt: nowIso() }]),
      "utf8"
    ),
    writeFile(
      join(projectDir, "logs", "episode_999.qa.json"),
      JSON.stringify([{ id: "qa999", episodeId: "episode_999", type: "japanese_remaining", severity: "warning", message: "999", resolved: false, createdAt: nowIso() }]),
      "utf8"
    )
  ]);

  const episodes = await listEpisodes(projectDir);
  assert.deepEqual(
    episodes.map((episode) => episode.episodeNo),
    [999, 1000, 1001]
  );
  assert.equal((await readTranslation(projectDir, episodes[0]!))?.bodyKo, "오래된 번역");
  assert.deepEqual(
    (await readAllQAIssues(projectDir)).map((issue) => issue.id),
    ["qa999", "qa1000"]
  );

  await saveTranslation(projectDir, episodes[0]!, {
    episodeId: "episode_999",
    titleKo: "제999화",
    bodyKo: "갱신된 번역",
    usedGlossaryEntries: [],
    newGlossaryCandidates: [],
    qaIssueIds: [],
    model: "dry-run",
    backend: "dry-run",
    createdAt: nowIso()
  });
  await saveQAIssues(projectDir, episodes[0]!, []);

  assert.equal(JSON.parse(await readFile(join(projectDir, "translated", "episode_999.json"), "utf8")).bodyKo, "갱신된 번역");
  assert.deepEqual(JSON.parse(await readFile(join(projectDir, "logs", "episode_999.qa.json"), "utf8")), []);
  await assert.rejects(() => access(translationJsonPath(projectDir, 999)));
  await assert.rejects(() => access(qaEpisodePath(projectDir, 999)));
});

test("v2 import action does not pin the global default model into project metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-v2-import-"));
  const projectRoot = join(root, "projects");
  const config = {
    ...defaultConfig,
    defaultBackend: "codex-cli" as const,
    defaultModel: "global-default-model",
    codexCli: { ...defaultConfig.codexCli, model: "codex-backend-model" }
  };

  const message = await importSourceForUi(["第1話 v2", "本文です。"].join("\n"), config, projectRoot);
  assert.match(message, /プロジェクト|프로젝트 생성/);

  const [projectDir] = await discoverProjectDirs(projectRoot);
  assert.ok(projectDir);
  const metadata = await loadProjectMetadata(projectDir);
  assert.equal(metadata.options.backend, "codex-cli");
  assert.equal(metadata.options.model, undefined);
});

test("v2 web import action defaults rights confirmation and imports through WebImportService", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-v2-web-import-"));
  const projectRoot = join(root, "projects");
  const missingEpisodes = await importSourceForUi("https://kakuyomu.jp/works/123", defaultConfig, projectRoot);
  assert.match(missingEpisodes, /화수 범위/);

  const service = new WebImportService({
    delayMs: 0,
    fetchFn: fixtureFetch({
      "https://kakuyomu.jp/works/123": `
        <html><head><meta property="og:title" content="星の庭 - カクヨム"></head>
        <body>
          <a href="/users/alice">アリス</a>
          <script id="__NEXT_DATA__" type="application/json">
            {"props":{"pageProps":{"__APOLLO_STATE__":{
              "Work:123":{"id":"123","tableOfContentsV2":[{"__ref":"TableOfContentsChapter:"}]},
              "TableOfContentsChapter:":{"episodeUnions":[{"__ref":"Episode:1001"}]},
              "Episode:1001":{"id":"1001","title":"第1話 庭の始まり"}
            }}}}
          </script>
        </body></html>
      `,
      "https://kakuyomu.jp/works/123/episodes/1001": `
        <html><body><div class="widget-episodeBody"><p>黒架は庭に立った。</p></div></body></html>
      `
    })
  });

  const message = await importSourceForUi("https://kakuyomu.jp/works/123", defaultConfig, projectRoot, {
    webImportService: service,
    webImport: { episodes: "1" }
  });
  assert.match(message, /웹 프로젝트 생성/);

  const [projectDir] = await discoverProjectDirs(projectRoot);
  assert.ok(projectDir);
  const metadata = await loadProjectMetadata(projectDir);
  assert.equal(metadata.options.model, undefined);
  const episodes = await listEpisodes(projectDir);
  assert.equal(episodes[0]?.metadata.sourceSite, "kakuyomu");
  assert.equal(episodes[0]?.metadata.sourceUrl, "https://kakuyomu.jp/works/123/episodes/1001");
});

test("exporting an unfinished project does not mark it exported", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-unfinished-export-"));
  const created = await createProjectFromText({
    sourceText: ["第1話 未完", "黒架は歩いた。", "", "第2話 未完", "聖印が光った。"].join("\n"),
    sourceLabel: "paste://unfinished-export-test",
    projectRoot: join(root, "projects"),
    name: "Unfinished Export Novel",
    backend: "dry-run",
    model: "dry-run",
    concurrency: 1,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });

  const metadata = await loadProjectMetadata(created.metadata.projectDir);
  const exported = await exportProject(metadata, ["txt"]);

  assert.equal(exported.translatedEpisodeCount, 0);
  assert.equal((await loadProjectMetadata(created.metadata.projectDir)).status, "ready");
});

test("translation-provided glossary candidates are saved into the project glossary", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-translation-glossary-"));
  const created = await createProjectFromText({
    sourceText: ["第1話 黒架", "黒架は歩いた。"].join("\n"),
    sourceLabel: "paste://translation-glossary-test",
    projectRoot: join(root, "projects"),
    name: "Translation Glossary Novel",
    backend: "candidate-test",
    model: "candidate-test",
    concurrency: 1,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });

  await runTranslation(created.metadata.projectDir, new CandidateAdapter(), "resume", 1);
  const glossary = await loadGlossary(created.metadata.projectDir);
  const entry = glossary.entries.find((item) => item.source === "黒架");
  assert.equal(entry?.targetCandidates[0]?.target, "흑가");
});

test("parallel translation preserves glossary candidates from all workers", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-parallel-glossary-"));
  const created = await createProjectFromText({
    sourceText: ["第1話 黒架", "黒架は歩いた。", "", "第2話 聖印", "聖印が光った。"].join("\n"),
    sourceLabel: "paste://parallel-glossary-test",
    projectRoot: join(root, "projects"),
    name: "Parallel Glossary Novel",
    backend: "candidate-test",
    model: "candidate-test",
    concurrency: 2,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });

  await runTranslation(created.metadata.projectDir, new EpisodeCandidateAdapter(), "resume", 2);
  const glossary = await loadGlossary(created.metadata.projectDir);
  assert.equal(glossary.entries.find((item) => item.source === "黒架")?.targetCandidates.some((candidate) => candidate.target === "흑가"), true);
  assert.equal(glossary.entries.find((item) => item.source === "聖印")?.targetCandidates.some((candidate) => candidate.target === "성인"), true);
});

test("manual Markdown edits are used by QA recheck and export", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-manual-edit-"));
  const sourcePath = join(root, "source.txt");
  await writeFile(sourcePath, ["第1話 修正", "黒架は12人を見た。"].join("\n"), "utf8");
  const created = await createProjectFromTxt({
    sourcePath,
    projectRoot: join(root, "projects"),
    name: "Manual Edit Novel",
    backend: "dry-run",
    model: "dry-run",
    concurrency: 1,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });
  await runTranslation(created.metadata.projectDir, createTranslatorAdapter("dry-run", defaultConfig), "resume", 1);

  const markdownPath = translationMarkdownPath(created.metadata.projectDir, 1);
  await writeFile(markdownPath, ["# 수동 수정 화", "", "수동 편집 본문입니다. それでも 12", ""].join("\n"), "utf8");
  const future = new Date(Date.now() + 5000);
  await utimes(markdownPath, future, future);

  const issues = await rerunProjectQA(created.metadata.projectDir);
  assert.equal(issues.some((issue) => issue.type === "japanese_remaining"), true);

  const metadata = await loadProjectMetadata(created.metadata.projectDir);
  const exported = await exportProject(metadata, ["txt"]);
  const txt = await readFile(exported.files[0]!, "utf8");
  assert.match(txt, /수동 수정 화/);
  assert.match(txt, /수동 편집 본문/);
});

test("QA recheck clears stale issues for episodes without translations", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-stale-qa-"));
  const created = await createProjectFromText({
    sourceText: ["第1話 未翻訳", "黒架は歩いた。"].join("\n"),
    sourceLabel: "paste://stale-qa-test",
    projectRoot: join(root, "projects"),
    name: "Stale QA Novel",
    backend: "dry-run",
    model: "dry-run",
    concurrency: 1,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });
  const [episode] = await listEpisodes(created.metadata.projectDir);
  assert.ok(episode);
  await saveQAIssues(created.metadata.projectDir, episode, [
    {
      id: "qa_stale",
      episodeId: episode.id,
      type: "japanese_remaining",
      severity: "warning",
      message: "stale",
      resolved: false,
      createdAt: nowIso()
    }
  ]);

  assert.equal((await readAllQAIssues(created.metadata.projectDir)).length, 1);
  const issues = await rerunProjectQA(created.metadata.projectDir);
  assert.equal(issues.length, 0);
  assert.equal((await readAllQAIssues(created.metadata.projectDir)).length, 0);
});

test("QA recheck preserves resolved issues that are still detected", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-resolved-qa-"));
  const created = await createProjectFromText({
    sourceText: ["第1話 再検査", "黒架は歩いた。"].join("\n"),
    sourceLabel: "paste://resolved-qa-test",
    projectRoot: join(root, "projects"),
    name: "Resolved QA Novel",
    backend: "dry-run",
    model: "dry-run",
    concurrency: 1,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });
  const [episode] = await listEpisodes(created.metadata.projectDir);
  assert.ok(episode);
  await saveTranslation(created.metadata.projectDir, episode, {
    episodeId: episode.id,
    titleKo: "재검사",
    bodyKo: "日本語가 남아 있습니다.",
    usedGlossaryEntries: [],
    newGlossaryCandidates: [],
    qaIssueIds: [],
    model: "test",
    backend: "test",
    createdAt: nowIso()
  });

  const firstIssues = await rerunProjectQA(created.metadata.projectDir);
  assert.equal(firstIssues.length > 0, true);
  await saveQAIssues(created.metadata.projectDir, episode, firstIssues.map((issue) => ({ ...issue, resolved: true })));

  const secondIssues = await rerunProjectQA(created.metadata.projectDir);
  assert.equal(secondIssues.length, firstIssues.length);
  assert.equal(secondIssues.every((issue) => issue.resolved), true);
  assert.equal((await readAllQAIssues(created.metadata.projectDir)).every((issue) => issue.resolved), true);
});

test("afterword sections are translated and controlled by export options", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-afterword-export-"));
  const created = await createProjectFromText({
    sourceText: ["第1話 黒架", "黒架は歩いた。", "", "あとがき", "読んでくれてありがとう。"].join("\n"),
    sourceLabel: "paste://afterword-export-test",
    projectRoot: join(root, "projects"),
    name: "Appendix Novel",
    backend: "dry-run",
    model: "dry-run",
    concurrency: 1,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });
  assert.equal(created.analysis.afterwordCount, 1);

  await runTranslation(created.metadata.projectDir, createTranslatorAdapter("dry-run", defaultConfig), "resume", 1);
  const episodes = await listEpisodes(created.metadata.projectDir);
  assert.doesNotMatch(episodes[0]?.body ?? "", /ありがとう/);
  assert.match(episodes[0]?.afterword ?? "", /あとがき/);
  const result = await readTranslation(created.metadata.projectDir, episodes[0]!);
  assert.match(result?.afterwordKo ?? "", /번역문 1-1/);

  let metadata = await loadProjectMetadata(created.metadata.projectDir);
  let exported = await exportProject(metadata, ["txt", "epub"]);
  let txt = await readFile(exported.files.find((file) => file.endsWith(".txt"))!, "utf8");
  assert.match(txt, /Afterword/);
  let epub = await readFile(exported.files.find((file) => file.endsWith(".epub"))!);
  assert.match(epub.toString("latin1"), /Afterword/);

  metadata = await loadProjectMetadata(created.metadata.projectDir);
  metadata.outputOptions.includeAfterword = false;
  await saveProjectMetadata(metadata);
  exported = await exportProject(metadata, ["txt", "epub"]);
  txt = await readFile(exported.files.find((file) => file.endsWith(".txt"))!, "utf8");
  assert.doesNotMatch(txt, /Afterword/);
  epub = await readFile(exported.files.find((file) => file.endsWith(".epub"))!);
  assert.doesNotMatch(epub.toString("latin1"), /Afterword/);
});

test("foreword sections are translated and exported separately", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-foreword-export-"));
  const created = await createProjectFromText({
    sourceText: ["第1話 前書き", "まえがき", "読者への挨拶です。", "", "黒架は歩いた。"].join("\n"),
    sourceLabel: "paste://foreword-export-test",
    projectRoot: join(root, "projects"),
    name: "Foreword Novel",
    backend: "dry-run",
    model: "dry-run",
    concurrency: 1,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });

  const episodes = await listEpisodes(created.metadata.projectDir);
  assert.match(episodes[0]?.foreword ?? "", /まえがき/);
  assert.doesNotMatch(episodes[0]?.body ?? "", /読者への挨拶/);

  await runTranslation(created.metadata.projectDir, createTranslatorAdapter("dry-run", defaultConfig), "resume", 1);
  const result = await readTranslation(created.metadata.projectDir, episodes[0]!);
  assert.match(result?.forewordKo ?? "", /번역문 1-1/);

  const metadata = await loadProjectMetadata(created.metadata.projectDir);
  const exported = await exportProject(metadata, ["txt", "epub"]);
  const txt = await readFile(exported.files.find((file) => file.endsWith(".txt"))!, "utf8");
  assert.match(txt, /Foreword/);
  const epub = await readFile(exported.files.find((file) => file.endsWith(".epub"))!);
  assert.match(epub.toString("latin1"), /Foreword/);
});

test("glossary appendix exports only confirmed and locked terms", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-glossary-export-"));
  const created = await createProjectFromText({
    sourceText: ["第1話 用語", "AlphaSourceは歩いた。"].join("\n"),
    sourceLabel: "paste://glossary-export-test",
    projectRoot: join(root, "projects"),
    name: "Glossary Export Novel",
    backend: "dry-run",
    model: "dry-run",
    concurrency: 1,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });
  await runTranslation(created.metadata.projectDir, createTranslatorAdapter("dry-run", defaultConfig), "resume", 1);

  const now = nowIso();
  const glossary = await loadGlossary(created.metadata.projectDir);
  glossary.entries = [
    {
      id: "glossary_confirmed",
      source: "AlphaSource",
      target: "AlphaTarget",
      type: "term",
      status: "confirmed",
      aliases: [],
      forbiddenTargets: [],
      notes: "",
      confidence: 1,
      sourceScore: 1,
      targetScore: 1,
      occurrenceCount: 1,
      firstSeenEpisode: 1,
      lastSeenEpisode: 1,
      locked: false,
      targetCandidates: [],
      createdAt: now,
      updatedAt: now
    },
    {
      id: "glossary_candidate",
      source: "BetaSource",
      target: "BetaTarget",
      type: "term",
      status: "candidate",
      aliases: [],
      forbiddenTargets: [],
      notes: "",
      confidence: 1,
      sourceScore: 1,
      targetScore: 1,
      occurrenceCount: 1,
      firstSeenEpisode: 1,
      lastSeenEpisode: 1,
      locked: false,
      targetCandidates: [],
      createdAt: now,
      updatedAt: now
    },
    {
      id: "glossary_deprecated",
      source: "GammaSource",
      target: "GammaTarget",
      type: "term",
      status: "deprecated",
      aliases: [],
      forbiddenTargets: [],
      notes: "",
      confidence: 1,
      sourceScore: 1,
      targetScore: 1,
      occurrenceCount: 1,
      firstSeenEpisode: 1,
      lastSeenEpisode: 1,
      locked: false,
      targetCandidates: [],
      createdAt: now,
      updatedAt: now
    }
  ];
  glossary.conflicts = [];
  glossary.updatedAt = now;
  await saveGlossary(created.metadata.projectDir, glossary);

  const model = await loadProjectUiModel(created.metadata.projectDir);
  assert.equal(model.exportPreview.glossaryAppendixCount, 1);

  const exported = await exportProject(await loadProjectMetadata(created.metadata.projectDir), ["txt", "epub"]);
  const txt = await readFile(exported.files.find((file) => file.endsWith(".txt"))!, "utf8");
  const epub = (await readFile(exported.files.find((file) => file.endsWith(".epub"))!)).toString("utf8");

  assert.match(txt, /AlphaSource -> AlphaTarget/);
  assert.doesNotMatch(txt, /BetaSource|GammaSource/);
  assert.match(epub, /AlphaSource/);
  assert.doesNotMatch(epub, /BetaSource|GammaSource/);
});

function fixtureFetch(fixtures: Record<string, string>): WebFetch {
  return async (url) => {
    const html = fixtures[url];
    if (!html) {
      return new Response("not found", { status: 404, statusText: "Not Found" });
    }
    return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  };
}

class CandidateAdapter implements TranslatorAdapter {
  readonly id = "candidate-test";
  readonly label = "Candidate test adapter";

  async checkAvailability(): Promise<AdapterStatus> {
    return { available: true, message: "ok" };
  }

  async translateEpisode(input: TranslationInput): Promise<TranslationResult> {
    return {
      episodeId: input.episode.id,
      titleKo: `제${input.episode.episodeNo}화`,
      bodyKo: "흑가는 걸었다.",
      usedGlossaryEntries: [],
      newGlossaryCandidates: ["黒架 => 흑가"],
      qaIssueIds: [],
      model: "candidate-test",
      backend: this.id,
      createdAt: nowIso()
    };
  }
}

class EpisodeCandidateAdapter implements TranslatorAdapter {
  readonly id = "episode-candidate-test";
  readonly label = "Episode candidate test adapter";

  async checkAvailability(): Promise<AdapterStatus> {
    return { available: true, message: "ok" };
  }

  async translateEpisode(input: TranslationInput): Promise<TranslationResult> {
    await new Promise((resolve) => setTimeout(resolve, input.episode.id === "episode_00001" ? 20 : 0));
    const candidate = input.episode.id === "episode_00001" ? "黒架 => 흑가" : "聖印 => 성인";
    return {
      episodeId: input.episode.id,
      titleKo: `제${input.episode.episodeNo}화`,
      bodyKo: `번역 ${input.episode.id}`,
      usedGlossaryEntries: [],
      newGlossaryCandidates: [candidate],
      qaIssueIds: [],
      model: "episode-candidate-test",
      backend: this.id,
      createdAt: nowIso()
    };
  }
}
