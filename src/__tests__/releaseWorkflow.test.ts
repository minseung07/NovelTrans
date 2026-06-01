import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("release workflow publishes with npm provenance and verifies metadata", async () => {
  const workflow = await readFile(".github/workflows/release.yml", "utf8");

  assert.match(workflow, /workflow_dispatch:\s*\n\s+inputs:\s*\n\s+tag:/);
  assert.doesNotMatch(workflow, /release:\s*\n\s+types:\s*\n\s+- published/);
  assert.doesNotMatch(workflow, /push:\s*\n\s+tags:/);
  assert.match(workflow, /ref: \$\{\{ inputs\.tag \}\}/);
  assert.match(workflow, /TAG_NAME: \$\{\{ inputs\.tag \}\}/);
  assert.match(workflow, /npm publish --provenance/);
  assert.match(workflow, /Verify npm provenance/);
  assert.match(workflow, /npm", \["view", spec, "dist", "--json"\]/);
});
