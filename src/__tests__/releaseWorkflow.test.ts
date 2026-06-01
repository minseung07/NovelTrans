import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("release workflow publishes with npm provenance and verifies metadata", async () => {
  const workflow = await readFile(".github/workflows/release.yml", "utf8");

  assert.match(workflow, /push:\s*\n\s+tags:\s*\n\s+- "v\*"/);
  assert.match(workflow, /github\.event\.release\.tag_name \|\| inputs\.tag \|\| github\.ref_name/);
  assert.match(workflow, /npm publish --provenance/);
  assert.match(workflow, /Verify npm provenance/);
  assert.match(workflow, /npm", \["view", spec, "dist", "--json"\]/);
});
