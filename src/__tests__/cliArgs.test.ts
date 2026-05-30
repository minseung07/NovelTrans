import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../cli/args.js";

test("CLI parser rejects missing values for value options", () => {
  assert.throws(() => parseArgs(["translate", "--model", "--backend", "dry-run"]), /Missing value for --model/);
  assert.throws(() => parseArgs(["import", "--source"]), /Missing value for --source/);
});

test("CLI parser preserves boolean options and repeated value options", () => {
  const args = parseArgs(["auth", "set-openai-key", "--stdin", "--fail-episode", "episode_00001", "--fail-episode=episode_00002"]);
  assert.equal(args.options.stdin, true);
  assert.deepEqual(args.options["fail-episode"], ["episode_00001", "episode_00002"]);
});
