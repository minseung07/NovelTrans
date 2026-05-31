import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "../cli/commands.js";
import { createProjectFromTxt } from "../engine/projectWorkflow.js";

const WARNING = "자리표시자";

async function makeProject(): Promise<{ projectDir: string; configDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "noveltrans-cli-"));
  const sourcePath = join(root, "source.txt");
  await writeFile(sourcePath, ["第1話 黒架", "黒架は聖印を見た。"].join("\n"), "utf8");
  const created = await createProjectFromTxt({
    sourcePath,
    projectRoot: join(root, "projects"),
    name: "CLI Warn Novel",
    backend: "dry-run",
    model: "dry-run",
    concurrency: 1,
    glossaryStrictness: "high",
    userConfirmedRights: true
  });
  return { projectDir: created.metadata.projectDir, configDir: join(root, "config") };
}

function captureIo(): { io: { stdout: { log: (m: string) => void }; stderr: { error: (m: string) => void } }; err: string[] } {
  const err: string[] = [];
  return { io: { stdout: { log: () => {} }, stderr: { error: (m: string) => err.push(m) } }, err };
}

test("CLI translate warns on stderr when backend is dry-run", async () => {
  const { projectDir, configDir } = await makeProject();
  const { io, err } = captureIo();
  const code = await runCli(["translate", "--project", projectDir, "--backend", "dry-run", "--config-dir", configDir], io);
  assert.equal(code, 0);
  assert.ok(err.some((line) => line.includes(WARNING)), "expected dry-run warning on stderr");
});

test("CLI translate does not warn for a non-dry-run backend", async () => {
  const { projectDir, configDir } = await makeProject();
  const savedKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const { io, err } = captureIo();
    await runCli(["translate", "--project", projectDir, "--backend", "openai-compatible", "--config-dir", configDir], io);
    assert.ok(!err.some((line) => line.includes(WARNING)), "dry-run warning should be absent for openai-compatible");
  } finally {
    if (savedKey !== undefined) {
      process.env.OPENAI_API_KEY = savedKey;
    }
  }
});
