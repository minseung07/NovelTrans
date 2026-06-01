import test from "node:test";
import assert from "node:assert/strict";
import { qwertyShortcutTokenFromKoreanPaste } from "../utils/keyboardLayout.js";

test("single Korean keyboard paste commits can become shortcut tokens", () => {
  assert.equal(qwertyShortcutTokenFromKoreanPaste("ㅊ"), "c");
  assert.equal(qwertyShortcutTokenFromKoreanPaste("ᄎ"), "c");
  assert.equal(qwertyShortcutTokenFromKoreanPaste("ㅓ"), "j");
  assert.equal(qwertyShortcutTokenFromKoreanPaste("q"), null);
  assert.equal(qwertyShortcutTokenFromKoreanPaste("ㅊㅏ"), null);
  assert.equal(qwertyShortcutTokenFromKoreanPaste("ㅗ디ㅔ"), null);
});
