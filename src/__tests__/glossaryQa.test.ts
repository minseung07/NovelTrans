import test from "node:test";
import assert from "node:assert/strict";
import {
  addForbiddenTarget,
  confirmGlossaryTerm,
  addTargetCandidate,
  createEmptyGlossary,
  deprecateGlossaryTerm,
  detectGlossaryConflicts,
  mergeTranslationGlossaryCandidates
} from "../glossary/glossaryEngine.js";
import { runQA } from "../qa/qaEngine.js";
import { buildReviewDeskModel } from "../ui/reviewDeskModel.js";
import type { Episode } from "../domain/episode.js";
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
