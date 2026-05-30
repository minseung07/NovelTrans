import test from "node:test";
import assert from "node:assert/strict";
import { splitEpisodes } from "../engine/episodeSplitter.js";
import { analyzeSource } from "../engine/sourceAnalyzer.js";

test("splits local TXT source into numbered episodes", () => {
  const source = [
    "第1話 黒架",
    "黒架は歩いた。",
    "",
    "第2話 聖印",
    "聖印が光った。",
    "",
    "第3話 帰還",
    "黒架は戻った。"
  ].join("\n");

  const episodes = splitEpisodes(source);
  assert.equal(episodes.length, 3);
  assert.equal(episodes[0]?.id, "episode_00001");
  assert.equal(episodes[1]?.title, "第2話 聖印");
  assert.match(episodes[2]?.body ?? "", /戻った/);

  const analysis = analyzeSource(source);
  assert.equal(analysis.episodeCount, 3);
  assert.equal(analysis.languageGuess, "ja");
  assert.equal(analysis.hasEpisodeHeadings, true);
  assert.equal(analysis.afterwordCount, 0);
});

test("imports source without headings as a single episode", () => {
  const episodes = splitEpisodes("黒架は歩いた。\n聖印が光った。");
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0]?.episodeNo, 1);
});

test("splits author afterword out of episode body", () => {
  const episodes = splitEpisodes(["第1話 黒架", "黒架は歩いた。", "", "あとがき", "読んでくれてありがとう。"].join("\n"));
  assert.equal(episodes.length, 1);
  assert.match(episodes[0]?.body ?? "", /黒架は歩いた/);
  assert.doesNotMatch(episodes[0]?.body ?? "", /ありがとう/);
  assert.match(episodes[0]?.afterword ?? "", /あとがき/);
});

test("source analysis reports author afterword risk", () => {
  const analysis = analyzeSource(["第1話 黒架", "黒架は歩いた。", "あとがき", "読んでくれてありがとう。", "", "第2話 聖印", "聖印が光った。"].join("\n"));
  assert.equal(analysis.afterwordCount, 1);
  assert.equal(analysis.warnings.some((warning) => warning.includes("author afterword")), true);
});
