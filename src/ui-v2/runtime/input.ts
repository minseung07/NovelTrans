// Input decoder: turns a raw terminal chunk into semantic key events.
// Handles CSI/SS3 sequences, bracketed paste, alt+key, control chars, and
// multiple keypresses packed into one chunk. No legacy string-key conversion:
// the runtime consumes KeyEvents directly.

type KeyName =
  | "up" | "down" | "left" | "right"
  | "enter" | "escape" | "tab" | "backtab"
  | "backspace" | "home" | "end" | "pageup" | "pagedown" | "delete";

export type KeyEvent =
  | { type: "key"; name: KeyName }
  | { type: "char"; value: string; ctrl?: boolean; alt?: boolean }
  | { type: "paste"; text: string };

const CSI_FINAL: Record<string, KeyName> = { A: "up", B: "down", C: "right", D: "left", H: "home", F: "end", Z: "backtab" };
const CSI_TILDE: Record<string, KeyName> = { "1": "home", "3": "delete", "4": "end", "5": "pageup", "6": "pagedown", "7": "home", "8": "end" };

export function decodeInput(chunk: string): KeyEvent[] {
  const events: KeyEvent[] = [];
  let i = 0;
  while (i < chunk.length) {
    const char = chunk[i]!;
    if (chunk.startsWith("\x1b[200~", i)) {
      const end = chunk.indexOf("\x1b[201~", i);
      events.push({ type: "paste", text: end === -1 ? chunk.slice(i + 6) : chunk.slice(i + 6, end) });
      i = end === -1 ? chunk.length : end + 6;
      continue;
    }
    if (char === "\x1b") {
      const rest = chunk.slice(i);
      const csi = /^\x1b\[([0-9;]*)([A-Za-z~])/.exec(rest);
      if (csi) {
        const [match, params, final] = csi;
        const name = final === "~" ? CSI_TILDE[params!.split(";")[0] ?? ""] : CSI_FINAL[final!];
        if (name) {
          events.push({ type: "key", name });
        }
        i += match.length;
        continue;
      }
      const ss3 = /^\x1bO([A-Za-z])/.exec(rest);
      if (ss3) {
        const name = CSI_FINAL[ss3[1]!];
        if (name) {
          events.push({ type: "key", name });
        }
        i += ss3[0].length;
        continue;
      }
      const nextChar = chunk[i + 1];
      if (nextChar !== undefined && nextChar >= " " && nextChar !== "\x7f") {
        events.push({ type: "char", value: nextChar, alt: true });
        i += 2;
        continue;
      }
      events.push({ type: "key", name: "escape" });
      i += 1;
      continue;
    }
    if (char === "\r" || char === "\n") {
      events.push({ type: "key", name: "enter" });
      i += 1;
      continue;
    }
    if (char === "\t") {
      events.push({ type: "key", name: "tab" });
      i += 1;
      continue;
    }
    if (char === "\x7f" || char === "\b") {
      events.push({ type: "key", name: "backspace" });
      i += 1;
      continue;
    }
    const code = char.codePointAt(0)!;
    if (code < 0x20) {
      events.push({ type: "char", value: String.fromCharCode(code + 0x60), ctrl: true });
      i += 1;
      continue;
    }
    events.push({ type: "char", value: char });
    i += char.length;
  }
  return events;
}

// A trailing incomplete escape sequence (a lone ESC, or ESC[/ESCO with no final
// byte yet). Held back across chunks so a real arrow key split over two reads is
// not misread as a bare Escape; the runtime flushes it as Escape on timeout.
const TRAILING_INCOMPLETE_ESC = /\x1b(\[[0-9;]*|O)?$/;

export function decodeChunk(pending: string, chunk: string): { events: KeyEvent[]; pending: string } {
  const buffer = pending + chunk;
  const match = TRAILING_INCOMPLETE_ESC.exec(buffer);
  if (match) {
    return { events: decodeInput(buffer.slice(0, match.index)), pending: match[0] };
  }
  return { events: decodeInput(buffer), pending: "" };
}
