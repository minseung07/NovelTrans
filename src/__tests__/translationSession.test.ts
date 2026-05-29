import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProjectFromText } from "../engine/projectWorkflow.js";
import { translateEpisodeParts } from "../engine/episodeTranslation.js";
import { TranslationSession } from "../engine/translationSession.js";
import { createEmptyGlossary } from "../glossary/glossaryEngine.js";
import { DryRunAdapter } from "../translation/adapters/dryRunAdapter.js";
import { loadProjectOverview } from "../engine/projectWorkflow.js";
import { loadGlossary, loadProjectMetadata } from "../storage/projectStore.js";
import { projectPaths } from "../storage/projectPaths.js";
import { ProjectStateStore } from "../storage/stateStore.js";
import type { AdapterStatus, TranslationInput, TranslationResult, TranslatorAdapter } from "../domain/translation.js";
import { nowIso } from "../utils/time.js";

test("TranslationSession can pause before processing and resume to completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-session-"));
  const created = await createProjectFromText({
    sourceText: ["第1話 一", "黒架は歩いた。", "", "第2話 二", "聖印が光った。"].join("\n"),
    sourceLabel: "paste://session-test",
    projectRoot: join(root, "projects"),
    name: "Session Novel",
    backend: "dry-run",
    model: "dry-run",
    concurrency: 1,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });

  const session = await TranslationSession.create({
    projectDir: created.metadata.projectDir,
    adapter: new DryRunAdapter(),
    mode: "resume"
  });
  const done = session.start();
  session.pause();
  await sleep(150);
  let snapshot = session.snapshot();
  assert.equal(snapshot.status, "paused");
  assert.equal(snapshot.completed, 0);

  session.resume();
  snapshot = await done;
  assert.equal(snapshot.status, "completed");
  assert.equal(snapshot.completed, 2);

  const overview = await loadProjectOverview(created.metadata.projectDir);
  assert.equal(overview.counts.completed, 2);
});

test("TranslationSession tracks parallel active episodes and pauses before starting more", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-session-parallel-"));
  const created = await createProjectFromText({
    sourceText: ["第1話 一", "一。", "", "第2話 二", "二。", "", "第3話 三", "三。"].join("\n"),
    sourceLabel: "paste://session-parallel-test",
    projectRoot: join(root, "projects"),
    name: "Parallel Session Novel",
    backend: "dry-run",
    model: "dry-run",
    concurrency: 2,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });

  const session = await TranslationSession.create({
    projectDir: created.metadata.projectDir,
    adapter: new SlowAdapter(250),
    mode: "resume"
  });
  const done = session.start();
  await waitFor(() => session.snapshot().activeEpisodeNos.length === 2, 1000);
  let snapshot = session.snapshot();
  assert.equal(snapshot.activeEpisodeNos.length, 2);

  session.pause();
  await waitFor(() => session.snapshot().completed === 2 && session.snapshot().activeEpisodeNos.length === 0, 1000);
  snapshot = session.snapshot();
  assert.equal(snapshot.status, "paused");
  assert.equal(snapshot.completed, 2);
  assert.equal(snapshot.activeEpisodeNos.length, 0);

  session.resume();
  snapshot = await done;
  assert.equal(snapshot.status, "completed");
  assert.equal(snapshot.completed, 3);
});

test("TranslationSession records unavailable backend failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-session-unavailable-"));
  const created = await createProjectFromText({
    sourceText: ["第1話 一", "黒架は歩いた。", "", "第2話 二", "聖印が光った。"].join("\n"),
    sourceLabel: "paste://session-unavailable-test",
    projectRoot: join(root, "projects"),
    name: "Unavailable Session Novel",
    backend: "dry-run",
    model: "dry-run",
    concurrency: 1,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });

  const session = await TranslationSession.create({
    projectDir: created.metadata.projectDir,
    adapter: new UnavailableAdapter(),
    mode: "resume"
  });

  await assert.rejects(() => session.start(), /backend unavailable/);
  assert.equal(session.snapshot().status, "failed");

  const metadata = await loadProjectMetadata(created.metadata.projectDir);
  assert.equal(metadata.status, "failed");

  const stateStore = new ProjectStateStore(projectPaths(created.metadata.projectDir).projectDb);
  try {
    const runs = stateStore.listRuns();
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.status, "failed");
    assert.equal(runs[0]?.episodeCount, 2);
    assert.match(runs[0]?.errorMessage ?? "", /backend unavailable/);
  } finally {
    stateStore.close();
  }
});

test("TranslationSession preserves glossary candidates from parallel workers", async () => {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-session-glossary-"));
  const created = await createProjectFromText({
    sourceText: ["第1話 黒架", "黒架は歩いた。", "", "第2話 聖印", "聖印が光った。"].join("\n"),
    sourceLabel: "paste://session-glossary-test",
    projectRoot: join(root, "projects"),
    name: "Session Glossary Novel",
    backend: "session-candidate-test",
    model: "session-candidate-test",
    concurrency: 2,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });

  const session = await TranslationSession.create({
    projectDir: created.metadata.projectDir,
    adapter: new SessionCandidateAdapter(),
    mode: "resume"
  });
  const snapshot = await session.start();
  assert.equal(snapshot.completed, 2);
  const glossary = await loadGlossary(created.metadata.projectDir);
  assert.equal(glossary.entries.find((item) => item.source === "黒架")?.targetCandidates.some((candidate) => candidate.target === "흑가"), true);
  assert.equal(glossary.entries.find((item) => item.source === "聖印")?.targetCandidates.some((candidate) => candidate.target === "성인"), true);
});

test("long episode bodies are translated in chunks and merged as one result", async () => {
  const adapter = new RecordingAdapter();
  const result = await translateEpisodeParts({
    adapter,
    episode: {
      id: "episode_001",
      episodeNo: 1,
      title: "第1話 長い本文",
      sourceText: "source",
      body: ["黒架".repeat(12000), "聖印".repeat(12000)].join("\n\n"),
      sourceHash: "hash",
      metadata: {}
    },
    glossary: createEmptyGlossary(),
    glossaryStrictness: "high",
    translationStyle: "balanced-webnovel"
  });

  assert.deepEqual(adapter.episodeIds, ["episode_001_chunk_1", "episode_001_chunk_2"]);
  assert.equal(result.episodeId, "episode_001");
  assert.match(result.bodyKo, /episode_001_chunk_1/);
  assert.match(result.bodyKo, /episode_001_chunk_2/);
});

test("foreword sections are translated separately from the episode body", async () => {
  const adapter = new RecordingAdapter();
  const result = await translateEpisodeParts({
    adapter,
    episode: {
      id: "episode_001",
      episodeNo: 1,
      title: "第1話 前書き",
      sourceText: "source",
      foreword: "前書きです。",
      body: "黒架は歩いた。",
      sourceHash: "hash",
      metadata: {}
    },
    glossary: createEmptyGlossary(),
    glossaryStrictness: "high",
    translationStyle: "balanced-webnovel"
  });

  assert.deepEqual(adapter.episodeIds, ["episode_001_foreword", "episode_001"]);
  assert.match(result.forewordKo ?? "", /episode_001_foreword/);
  assert.match(result.bodyKo, /episode_001/);
});

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for test condition.");
    }
    await sleep(20);
  }
}

class SlowAdapter implements TranslatorAdapter {
  readonly id = "slow-test";
  readonly label = "Slow test adapter";

  constructor(private readonly delayMs: number) {}

  async checkAvailability(): Promise<AdapterStatus> {
    return { available: true, message: "ok" };
  }

  async translateEpisode(input: TranslationInput): Promise<TranslationResult> {
    await sleep(this.delayMs);
    return {
      episodeId: input.episode.id,
      titleKo: `제${input.episode.episodeNo}화`,
      bodyKo: `번역 ${input.episode.episodeNo}`,
      usedGlossaryEntries: [],
      newGlossaryCandidates: [],
      qaIssueIds: [],
      model: "slow-test",
      backend: this.id,
      createdAt: nowIso()
    };
  }
}

class UnavailableAdapter implements TranslatorAdapter {
  readonly id = "unavailable-test";
  readonly label = "Unavailable test adapter";

  async checkAvailability(): Promise<AdapterStatus> {
    return { available: false, message: "backend unavailable" };
  }

  async translateEpisode(): Promise<TranslationResult> {
    throw new Error("should not translate");
  }
}

class RecordingAdapter implements TranslatorAdapter {
  readonly id = "recording-test";
  readonly label = "Recording test adapter";
  readonly episodeIds: string[] = [];

  async checkAvailability(): Promise<AdapterStatus> {
    return { available: true, message: "ok" };
  }

  async translateEpisode(input: TranslationInput): Promise<TranslationResult> {
    this.episodeIds.push(input.episode.id);
    return {
      episodeId: input.episode.id,
      titleKo: `제${input.episode.episodeNo}화`,
      bodyKo: `번역 ${input.episode.id}`,
      usedGlossaryEntries: [],
      newGlossaryCandidates: [],
      qaIssueIds: [],
      model: "recording-test",
      backend: this.id,
      createdAt: nowIso()
    };
  }
}

class SessionCandidateAdapter implements TranslatorAdapter {
  readonly id = "session-candidate-test";
  readonly label = "Session candidate test adapter";

  async checkAvailability(): Promise<AdapterStatus> {
    return { available: true, message: "ok" };
  }

  async translateEpisode(input: TranslationInput): Promise<TranslationResult> {
    await sleep(input.episode.id === "episode_001" ? 20 : 0);
    const candidate = input.episode.id === "episode_001" ? "黒架 => 흑가" : "聖印 => 성인";
    return {
      episodeId: input.episode.id,
      titleKo: `제${input.episode.episodeNo}화`,
      bodyKo: `번역 ${input.episode.id}`,
      usedGlossaryEntries: [],
      newGlossaryCandidates: [candidate],
      qaIssueIds: [],
      model: "session-candidate-test",
      backend: this.id,
      createdAt: nowIso()
    };
  }
}
