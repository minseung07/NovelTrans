// Double-buffered diff renderer. Repaints only the lines that changed between
// frames, eliminating the full-screen clear flicker. Absolute cursor addressing
// keeps it correct in raw mode.

export type RenderTarget = { write(data: string): void };

export interface DiffRenderer {
  render(frame: string): void;
  invalidate(): void;
  clear(): void;
}

export function createDiffRenderer(output: RenderTarget): DiffRenderer {
  let previous: string[] = [];
  let needsFull = true;

  return {
    invalidate(): void {
      needsFull = true;
    },
    clear(): void {
      output.write("\x1b[2J\x1b[H\x1b[?25h");
      previous = [];
      needsFull = true;
    },
    render(frame: string): void {
      const lines = frame.split("\n");
      if (needsFull) {
        let out = "\x1b[?25l\x1b[2J";
        for (let i = 0; i < lines.length; i += 1) {
          out += `\x1b[${i + 1};1H${lines[i] ?? ""}`;
        }
        output.write(out);
        previous = lines;
        needsFull = false;
        return;
      }
      const max = Math.max(lines.length, previous.length);
      let out = "";
      for (let i = 0; i < max; i += 1) {
        const next = lines[i] ?? "";
        if (next !== (previous[i] ?? "")) {
          out += `\x1b[${i + 1};1H\x1b[2K${next}`;
        }
      }
      if (out) {
        output.write(out);
      }
      previous = lines;
    }
  };
}
