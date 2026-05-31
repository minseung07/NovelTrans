import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, requireStringOption } from "../cli/args.js";

test("CLI parser rejects missing values for value options", () => {
  assert.throws(() => parseArgs(["translate", "--model", "--backend", "dry-run"]), /--model 옵션에 값이 필요합니다/);
  assert.throws(() => parseArgs(["import", "--source"]), /--source 옵션에 값이 필요합니다/);
});

test("requireStringOption reports missing required options in Korean", () => {
  assert.throws(() => requireStringOption(parseArgs(["translate"]), "project"), /필수 옵션 --project이\(가\) 없습니다/);
});

test("CLI parser preserves boolean options and repeated value options", () => {
  const args = parseArgs(["auth", "set-openai-key", "--stdin", "--fail-episode", "episode_00001", "--fail-episode=episode_00002"]);
  assert.equal(args.options.stdin, true);
  assert.deepEqual(args.options["fail-episode"], ["episode_00001", "episode_00002"]);
});
