import test from "node:test";
import assert from "node:assert/strict";
import { runCli, formatCliError } from "../cli/commands.js";

async function helpOutput(): Promise<string> {
  const lines: string[] = [];
  const io = { stdout: { log: (m: string) => lines.push(m) }, stderr: { error: () => {} } };
  const code = await runCli(["help"], io);
  assert.equal(code, 0);
  return lines.join("\n");
}

test("help is grouped with descriptions, global flags, and alias notes", async () => {
  const help = await helpOutput();
  for (const marker of ["핵심 명령:", "앱 화면 미리보기", "전역 옵션:", "--workspace", "--config-dir", "(별칭: ui)", "(별칭: review)"]) {
    assert.ok(help.includes(marker), `help should include ${marker}`);
  }
  assert.ok(/translate\s+번역 이어가기/.test(help), "translate should have a description");
});

test("non-interactive app prints a plain bookshelf snapshot", async () => {
  const lines: string[] = [];
  const errors: string[] = [];
  const workspace = `/tmp/noveltrans-empty-${Date.now()}`;
  const configDir = `/tmp/noveltrans-config-${Date.now()}`;
  const io = { stdout: { log: (m: string) => lines.push(m) }, stderr: { error: (m: string) => errors.push(m) } };
  const code = await runCli(["app", "--workspace", workspace, "--config-dir", configDir], io);
  assert.equal(code, 0);
  assert.deepEqual(errors, []);
  const output = lines.join("\n");
  assert.ok(output.includes("이어하기"));
  assert.equal(output.includes("\x1b["), false);
});

test("SQLite locked errors are rendered as a friendly CLI message", () => {
  const error = Object.assign(new Error("database is locked"), { code: "ERR_SQLITE_ERROR", errcode: 261 });
  assert.equal(formatCliError(error), "프로젝트 데이터베이스가 사용 중입니다. 잠시 후 다시 시도하세요.");
});
