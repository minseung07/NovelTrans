import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeInput, decodeChunk } from "../ui-v2/runtime/input.js";
import { createDiffRenderer } from "../ui-v2/runtime/renderer.js";
import { detectColorLevel, detectUnicode } from "../ui-v2/theme/capabilities.js";

test("decodeInput maps CSI/SS3/control/paste to semantic events", () => {
  assert.deepEqual(decodeInput("\x1b[A"), [{ type: "key", name: "up" }]);
  assert.deepEqual(decodeInput("\x1bOA"), [{ type: "key", name: "up" }]);
  assert.deepEqual(decodeInput("\x1b[6~"), [{ type: "key", name: "pagedown" }]);
  assert.deepEqual(decodeInput("\r"), [{ type: "key", name: "enter" }]);
  assert.deepEqual(decodeInput("\t"), [{ type: "key", name: "tab" }]);
  assert.deepEqual(decodeInput("\x7f"), [{ type: "key", name: "backspace" }]);
  assert.deepEqual(decodeInput("\x1b"), [{ type: "key", name: "escape" }]);
  assert.deepEqual(decodeInput("a"), [{ type: "char", value: "a" }]);
  assert.deepEqual(decodeInput("\x01"), [{ type: "char", value: "a", ctrl: true }]);
  assert.deepEqual(decodeInput("\x1ba"), [{ type: "char", value: "a", alt: true }]);
  assert.deepEqual(decodeInput("\x1b[200~hi\x1b[201~"), [{ type: "paste", text: "hi" }]);
  assert.deepEqual(decodeInput("ab\x1b[A"), [
    { type: "char", value: "a" },
    { type: "char", value: "b" },
    { type: "key", name: "up" }
  ]);
});

test("decodeChunk holds a trailing partial escape until the next chunk", () => {
  const first = decodeChunk("", "\x1b");
  assert.deepEqual(first, { events: [], pending: "\x1b" });
  const second = decodeChunk(first.pending, "[A");
  assert.deepEqual(second, { events: [{ type: "key", name: "up" }], pending: "" });
  assert.deepEqual(decodeChunk("", "\x1b[A"), { events: [{ type: "key", name: "up" }], pending: "" });
});

test("detectColorLevel degrades across env and TTY", () => {
  const tty = { isTTY: true };
  const env = (extra: Record<string, string>) => extra as NodeJS.ProcessEnv;
  assert.equal(detectColorLevel(tty, env({ COLORTERM: "truecolor" })), 3);
  assert.equal(detectColorLevel(tty, env({ TERM: "xterm-256color" })), 2);
  assert.equal(detectColorLevel(tty, env({ TERM: "xterm" })), 1);
  assert.equal(detectColorLevel(tty, env({ TERM: "dumb" })), 0);
  assert.equal(detectColorLevel(tty, env({ NO_COLOR: "1" })), 0);
  assert.equal(detectColorLevel({ isTTY: false }, env({})), 0);
  assert.equal(detectColorLevel({ isTTY: false }, env({ FORCE_COLOR: "3" })), 3);
  assert.equal(detectColorLevel(tty, env({ FORCE_COLOR: "0" })), 0);
});

test("detectUnicode degrades on dumb/non-utf8/non-tty/ascii-override", () => {
  const tty = { isTTY: true };
  const env = (extra: Record<string, string>) => extra as NodeJS.ProcessEnv;
  assert.equal(detectUnicode(tty, env({ LANG: "en_US.UTF-8" })), true);
  assert.equal(detectUnicode(tty, env({})), true);
  assert.equal(detectUnicode(tty, env({ LANG: "C" })), false);
  assert.equal(detectUnicode(tty, env({ TERM: "dumb" })), false);
  assert.equal(detectUnicode(tty, env({ NOVELTRANS_ASCII: "1", LANG: "en_US.UTF-8" })), false);
  assert.equal(detectUnicode({ isTTY: false }, env({ LANG: "en_US.UTF-8" })), false);
});

test("diff renderer paints full first frame, then only changed lines", () => {
  const writes: string[] = [];
  const renderer = createDiffRenderer({ write: (data) => writes.push(data) });

  renderer.render("a\nb\nc");
  assert.ok(writes[0]!.includes("\x1b[2J"));
  assert.ok(writes[0]!.includes("\x1b[1;1Ha"));
  assert.ok(writes[0]!.includes("\x1b[2;1Hb"));
  assert.ok(writes[0]!.includes("\x1b[3;1Hc"));

  renderer.render("a\nX\nc");
  assert.equal(writes[1], "\x1b[2;1H\x1b[2KX");

  renderer.invalidate();
  renderer.render("a\nX\nc");
  assert.ok(writes[2]!.includes("\x1b[2J"));
});
