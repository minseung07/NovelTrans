// Central, data-driven keymap. Bindings are plain data so dispatch, footer
// hints, and conflict validation all derive from one source. Search-input mode
// is handled directly by the input layer and intentionally bypasses the keymap.

import type { KeyEvent } from "../runtime/input.js";
import { qwertyShortcutTokenFromKoreanPaste } from "../../utils/keyboardLayout.js";

type Context = "library" | "project";

type Action = "quit" | "move-up" | "move-down" | "open" | "back" | "search" | "import" | "translate" | "palette" | "help" | "settings";

interface Binding {
  action: Action;
  context: Context;
  keys: string[];
  hint?: string;
}

export const keyBindings: Binding[] = [
  { action: "move-up", context: "library", keys: ["up", "k"] },
  { action: "move-down", context: "library", keys: ["down", "j"] },
  { action: "open", context: "library", keys: ["enter"], hint: "[Enter] 열기" },
  { action: "search", context: "library", keys: ["/"], hint: "[/] 검색" },
  { action: "settings", context: "library", keys: ["s"], hint: "[S] 설정" },
  { action: "import", context: "library", keys: ["n"], hint: "[N] 가져오기" },
  { action: "palette", context: "library", keys: [":", "ctrl+k"], hint: "[:] 명령" },
  { action: "help", context: "library", keys: ["?"], hint: "[?] 도움말" },
  { action: "quit", context: "library", keys: ["q", "ctrl+c"], hint: "[Q] 종료" },
  { action: "back", context: "project", keys: ["escape", "b"], hint: "[Esc] 뒤로" },
  { action: "translate", context: "project", keys: ["t"], hint: "[T] 번역" },
  { action: "palette", context: "project", keys: [":", "ctrl+k"], hint: "[:] 명령" },
  { action: "help", context: "project", keys: ["?"], hint: "[?] 도움말" },
  { action: "quit", context: "project", keys: ["q", "ctrl+c"], hint: "[Q] 종료" }
];

// Serializes a key event to a binding token: a key name ("up", "enter"),
// a character ("n", "/"), or a control combo ("ctrl+c").
export function keyToken(event: KeyEvent): string {
  if (event.type === "key") {
    return event.name;
  }
  if (event.type === "char") {
    const value = qwertyShortcutTokenFromKoreanPaste(event.value) ?? event.value.toLowerCase();
    return event.ctrl ? `ctrl+${value}` : value;
  }
  return qwertyShortcutTokenFromKoreanPaste(event.text) ?? "paste";
}

export function resolveAction(context: Context, token: string): Action | null {
  return keyBindings.find((binding) => binding.context === context && binding.keys.includes(token))?.action ?? null;
}

export function contextHints(context: Context): string[] {
  if (context === "library") {
    return ["[Enter] 열기", "[/] 검색", "[N] 가져오기", "[S] 설정", "[?] 도움말"];
  }
  return ["[1-6] 단계", "[T] 번역", "[:] 명령", "[?] 도움말", "[Esc] 뒤로"];
}

// Static validation: a (context, key) pair must map to a single action.
export function keymapConflicts(): string[] {
  const seen = new Map<string, Action>();
  const conflicts: string[] = [];
  for (const binding of keyBindings) {
    for (const key of binding.keys) {
      const id = `${binding.context}:${key}`;
      const existing = seen.get(id);
      if (existing && existing !== binding.action) {
        conflicts.push(`${id} -> ${existing} & ${binding.action}`);
      }
      seen.set(id, binding.action);
    }
  }
  return conflicts;
}
