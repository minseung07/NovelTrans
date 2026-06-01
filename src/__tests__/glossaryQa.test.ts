import test from "node:test";
import assert from "node:assert/strict";
import {
  addForbiddenTarget,
  confirmGlossaryTerm,
  addTargetCandidate,
  buildGlossaryContext,
  createEmptyGlossary,
  deprecateGlossaryTerm,
  detectGlossaryConflicts,
  mergeTranslationGlossaryCandidates
} from "../glossary/glossaryEngine.js";
import { runQA } from "../qa/qaEngine.js";
import { buildReviewDeskModel } from "../ui/reviewDeskModel.js";
import type { Episode } from "../domain/episode.js";
import type { GlossaryEntry } from "../domain/glossary.js";
import type { TranslationResult } from "../domain/translation.js";

test("detects glossary target conflicts and locked term QA issues", () => {
  let glossary = createEmptyGlossary();
  glossary = confirmGlossaryTerm(glossary, "黒架", "흑가", true);
  glossary = addTargetCandidate(glossary, "黒架", "쿠로카", "episode_001");

  const conflicts = detectGlossaryConflicts(glossary.entries);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0]?.targets, ["쿠로카", "흑가"]);

  const episode: Episode = {
    id: "episode_001",
    episodeNo: 1,
    title: "第1話 黒架",
    sourceText: "黒架は歩いた。",
    body: "黒架は歩いた。",
    sourceHash: "hash",
    metadata: {}
  };
  const result: TranslationResult = {
    episodeId: episode.id,
    titleKo: "제1화",
    bodyKo: "번역문입니다.",
    usedGlossaryEntries: [],
    newGlossaryCandidates: [],
    qaIssueIds: [],
    model: "dry-run",
    backend: "dry-run",
    createdAt: new Date().toISOString()
  };

  const issues = runQA(episode, result, glossary);
  assert.equal(issues.some((issue) => issue.type === "locked_term_violation"), true);
});

test("confirmed and deprecated glossary terms clear stale conflict candidates", () => {
  let glossary = createEmptyGlossary();
  glossary = addTargetCandidate(glossary, "黒架", "쿠로카", "episode_001");
  glossary = addTargetCandidate(glossary, "黒架", "흑가", "episode_002");
  assert.equal(glossary.conflicts.length, 1);

  glossary = confirmGlossaryTerm(glossary, "黒架", "흑가", true);
  assert.equal(glossary.conflicts.length, 0);
  assert.deepEqual(glossary.entries.find((entry) => entry.source === "黒架")?.targetCandidates.map((candidate) => candidate.target), ["흑가"]);

  glossary = addTargetCandidate(glossary, "黒架", "쿠로카", "episode_003");
  assert.equal(glossary.conflicts.length, 1);

  glossary = deprecateGlossaryTerm(glossary, "黒架");
  assert.equal(glossary.conflicts.length, 0);
});

test("translation glossary candidates are merged as target candidates", () => {
  let glossary = createEmptyGlossary();
  glossary = mergeTranslationGlossaryCandidates(glossary, ["黒架 => 흑가", "invalid"], "episode_001");
  const entry = glossary.entries.find((item) => item.source === "黒架");
  assert.equal(entry?.targetCandidates[0]?.target, "흑가");
  assert.equal(entry?.targetCandidates[0]?.count, 1);
});

test("detects name inconsistency when multiple glossary targets appear in one translation", () => {
  let glossary = createEmptyGlossary();
  glossary = confirmGlossaryTerm(glossary, "黒架", "흑가", false);
  glossary = addTargetCandidate(glossary, "黒架", "쿠로카", "episode_001");

  const episode: Episode = {
    id: "episode_001",
    episodeNo: 1,
    title: "第1話 黒架",
    sourceText: "黒架は黒架の名を呼ばれた。",
    body: "黒架は黒架の名を呼ばれた。",
    sourceHash: "hash",
    metadata: {}
  };
  const result: TranslationResult = {
    episodeId: episode.id,
    titleKo: "제1화",
    bodyKo: "흑가는 걸었다. 쿠로카라는 이름도 들렸다.",
    usedGlossaryEntries: [],
    newGlossaryCandidates: [],
    qaIssueIds: [],
    model: "dry-run",
    backend: "dry-run",
    createdAt: new Date().toISOString()
  };

  const issues = runQA(episode, result, glossary);
  const nameIssue = issues.find((issue) => issue.type === "name_inconsistency");
  assert.equal(Boolean(nameIssue), true);
  assert.equal(nameIssue?.sourceParagraphIndex, 1);
  assert.equal(nameIssue?.targetParagraphIndex, 1);
  assert.match(nameIssue?.targetSnippet ?? "", /쿠로카/);
  assert.match(nameIssue?.targetSnippet ?? "", /흑가/);
  const reviewDesk = buildReviewDeskModel(issues);
  assert.equal(reviewDesk.buckets.find((bucket) => bucket.id === "names")?.count, 1);
});

test("glossary QA ignores target variants when the source term is absent from the episode", () => {
  let glossary = createEmptyGlossary();
  glossary = confirmGlossaryTerm(glossary, "黒架", "흑가", false);
  glossary = addTargetCandidate(glossary, "黒架", "쿠로카", "episode_other");
  glossary = addForbiddenTarget(glossary, "黒架", "쿠로카");

  const episode: Episode = {
    id: "episode_001",
    episodeNo: 1,
    title: "第1話 聖印",
    sourceText: "聖印は光った。",
    body: "聖印は光った。",
    sourceHash: "hash",
    metadata: {}
  };
  const result: TranslationResult = {
    episodeId: episode.id,
    titleKo: "제1화",
    bodyKo: "쿠로카라는 별명은 나오지만 원문 용어는 없다.",
    usedGlossaryEntries: [],
    newGlossaryCandidates: [],
    qaIssueIds: [],
    model: "dry-run",
    backend: "dry-run",
    createdAt: new Date().toISOString()
  };

  const issues = runQA(episode, result, glossary);
  assert.equal(issues.some((issue) => issue.type === "name_inconsistency" || issue.type === "forbidden_term"), false);
});

test("QA issues carry paragraph locations for Review Desk detail", () => {
  const episode: Episode = {
    id: "episode_001",
    episodeNo: 1,
    title: "第1話 位置",
    sourceText: ["黒架は12人を見た。", "", "聖印は34回光った。", "", "魔導炉は56回鳴った。"].join("\n"),
    body: ["黒架は12人を見た。", "", "聖印は34回光った。", "", "魔導炉は56回鳴った。"].join("\n"),
    sourceHash: "hash",
    metadata: {}
  };
  const result: TranslationResult = {
    episodeId: episode.id,
    titleKo: "제1화",
    bodyKo: ["흑가는 12명을 보았다.", "", "聖印은 빛났다."].join("\n"),
    usedGlossaryEntries: [],
    newGlossaryCandidates: [],
    qaIssueIds: [],
    model: "dry-run",
    backend: "dry-run",
    createdAt: new Date().toISOString()
  };

  const issues = runQA(episode, result, createEmptyGlossary());
  const japanese = issues.find((issue) => issue.type === "japanese_remaining");
  assert.equal(japanese?.targetParagraphIndex, 2);
  assert.match(japanese?.targetSnippet ?? "", /聖印/);
  const number = issues.find((issue) => issue.type === "number_mismatch");
  assert.equal(number?.sourceParagraphIndex, 2);
  assert.match(number?.sourceSnippet ?? "", /34/);
});

test("QA detects missing Japanese numerals after normalization", () => {
  const episode: Episode = {
    id: "episode_001",
    episodeNo: 1,
    title: "第1話 数字",
    sourceText: "黒架は第七区で十二人を見た。",
    body: "黒架は第七区で十二人を見た。",
    sourceHash: "hash",
    metadata: {}
  };
  const result: TranslationResult = {
    episodeId: episode.id,
    titleKo: "제1화",
    bodyKo: "흑가는 7구에서 사람들을 보았다.",
    usedGlossaryEntries: [],
    newGlossaryCandidates: [],
    qaIssueIds: [],
    model: "dry-run",
    backend: "dry-run",
    createdAt: new Date().toISOString()
  };

  const issues = runQA(episode, result, createEmptyGlossary());
  const number = issues.find((issue) => issue.type === "number_mismatch");
  assert.match(number?.message ?? "", /12/);
  assert.match(number?.sourceSnippet ?? "", /十二/);
});

test("QA detects repeated number count changes", () => {
  const episode: Episode = {
    id: "episode_001",
    episodeNo: 1,
    title: "第1話 重複",
    sourceText: "鐘が12回、また12回鳴った。",
    body: "鐘が12回、また12回鳴った。",
    sourceHash: "hash",
    metadata: {}
  };
  const result: TranslationResult = {
    episodeId: episode.id,
    titleKo: "제1화",
    bodyKo: "종이 12번 울렸다.",
    usedGlossaryEntries: [],
    newGlossaryCandidates: [],
    qaIssueIds: [],
    model: "dry-run",
    backend: "dry-run",
    createdAt: new Date().toISOString()
  };

  const issues = runQA(episode, result, createEmptyGlossary());
  const number = issues.find((issue) => issue.type === "number_mismatch");
  assert.match(number?.message ?? "", /12/);
  assert.match(number?.sourceSnippet ?? "", /12回、また12回/);
});

test("glossary context prioritizes entries that appear in the episode source", () => {
  const entries: GlossaryEntry[] = Array.from({ length: 120 }, (_, index) =>
    glossaryEntry({
      id: `glossary_irrelevant_${index}`,
      source: `用語${String(index).padStart(3, "0")}`,
      target: `용어${index}`
    })
  );
  entries.push(
    glossaryEntry({
      id: "glossary_late_relevant",
      source: "重要語",
      target: "중요어",
      status: "locked",
      locked: true,
      aliases: ["大事な言葉"]
    })
  );

  const context = buildGlossaryContext(entries, "high", "黒架は重要語を唱えた。");
  assert.match(context, /重要語 => 중요어/);
});

test("glossary context treats aliases as episode relevance signals", () => {
  const context = buildGlossaryContext(
    [
      glossaryEntry({
        id: "glossary_alias",
        source: "正式名",
        target: "정식명",
        aliases: ["別名"]
      })
    ],
    "low",
    "黒架は別名で呼ばれた。"
  );
  assert.match(context, /正式名 => 정식명/);
});

test("QA covers translated foreword and afterword sections", () => {
  let glossary = createEmptyGlossary();
  glossary = confirmGlossaryTerm(glossary, "聖印", "성인", true);

  const episode: Episode = {
    id: "episode_001",
    episodeNo: 1,
    title: "第1話 付録",
    sourceText: ["まえがき", "黒架は12人に挨拶した。", "", "黒架は歩いた。", "", "あとがき", "聖印は34回光った。"].join("\n"),
    foreword: "まえがき\n\n黒架は12人に挨拶した。",
    body: "黒架は歩いた。",
    afterword: "あとがき\n\n聖印は34回光った。",
    sourceHash: "hash",
    metadata: {}
  };
  const result: TranslationResult = {
    episodeId: episode.id,
    titleKo: "제1화",
    forewordKo: "まえがき\n\n흑가는 12명에게 인사했다.",
    bodyKo: "흑가는 걸었다.",
    afterwordKo: "후기입니다.",
    usedGlossaryEntries: [],
    newGlossaryCandidates: [],
    qaIssueIds: [],
    model: "dry-run",
    backend: "dry-run",
    createdAt: new Date().toISOString()
  };

  const issues = runQA(episode, result, glossary);
  const forewordJapanese = issues.find((issue) => issue.type === "japanese_remaining" && issue.section === "foreword");
  assert.match(forewordJapanese?.targetSnippet ?? "", /まえがき/);
  assert.equal(issues.some((issue) => issue.type === "number_mismatch" && issue.section === "afterword"), true);
  assert.equal(issues.some((issue) => issue.type === "locked_term_violation" && issue.section === "afterword"), true);
});

test("QA options disable configured checks without muting structural errors", () => {
  const episode: Episode = {
    id: "episode_001",
    episodeNo: 1,
    title: "第1話 設定",
    sourceText: ["黒架は12人を見た。", "", "聖印は34回光った。", "", "魔導炉は56回鳴った。"].join("\n"),
    body: ["黒架は12人を見た。", "", "聖印は34回光った。", "", "魔導炉は56回鳴った。"].join("\n"),
    sourceHash: "hash",
    metadata: {}
  };
  const result: TranslationResult = {
    episodeId: episode.id,
    titleKo: "제1화",
    bodyKo: "聖印은 빛났다.",
    usedGlossaryEntries: [],
    newGlossaryCandidates: [],
    qaIssueIds: [],
    model: "dry-run",
    backend: "dry-run",
    createdAt: new Date().toISOString()
  };

  const issues = runQA(episode, result, createEmptyGlossary(), {
    japaneseRemaining: false,
    numberMismatch: false,
    lengthRatio: false,
    glossary: false
  });
  assert.equal(issues.some((issue) => issue.type === "japanese_remaining"), false);
  assert.equal(issues.some((issue) => issue.type === "number_mismatch"), false);
  assert.equal(issues.some((issue) => issue.type === "missing_paragraph"), true);
});

function glossaryEntry(overrides: Partial<GlossaryEntry> & Pick<GlossaryEntry, "id" | "source" | "target">): GlossaryEntry {
  const now = new Date().toISOString();
  return {
    type: "term",
    status: "confirmed",
    aliases: [],
    forbiddenTargets: [],
    notes: "",
    confidence: 0.8,
    sourceScore: 0.8,
    targetScore: 0.8,
    occurrenceCount: 1,
    firstSeenEpisode: 1,
    lastSeenEpisode: 1,
    locked: false,
    targetCandidates: [],
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}
