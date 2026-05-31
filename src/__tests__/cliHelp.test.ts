import test from "node:test";
import assert from "node:assert/strict";
import { runCli } from "../cli/commands.js";

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
