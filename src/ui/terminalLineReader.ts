import type { ReadStream, WriteStream } from "node:tty";
import { stripBracketedPasteMarkers } from "./sourcePathInput.js";

type LineResolver = (line: string) => void;
type KeyResolver = (key: string) => void;

export class TerminalLineReader {
  private readonly pendingLines: string[] = [];
  private readonly waiters: LineResolver[] = [];
  private readonly keyWaiters: KeyResolver[] = [];
  private buffer = "";
  private ignoreNextNewline = false;
  private previousRawMode = true;
  private started = false;

  constructor(
    private readonly input: ReadStream,
    private readonly output: WriteStream
  ) {}

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.previousRawMode = Boolean(this.input.isRaw);
    this.input.setRawMode(true);
    this.input.resume();
    this.input.on("data", this.handleData);
  }

  close(): void {
    if (!this.started) {
      return;
    }
    this.input.off("data", this.handleData);
    this.input.setRawMode(this.previousRawMode);
    this.started = false;
  }

  readLine(prompt = ""): Promise<string> {
    if (prompt) {
      this.output.write(prompt);
    }
    const pending = this.pendingLines.shift();
    if (pending !== undefined) {
      return Promise.resolve(pending);
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  readKey(prompt = ""): Promise<string> {
    if (prompt) {
      this.output.write(prompt);
    }
    return new Promise((resolve) => {
      this.keyWaiters.push(resolve);
    });
  }

  private readonly handleData = (chunk: Buffer | string): void => {
    const text = stripBracketedPasteMarkers(String(chunk)).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (const char of Array.from(text)) {
      if (char === "\u0003") {
        this.buffer = "";
        if (this.emitKey("")) {
          continue;
        }
        this.emitLine("");
        continue;
      }
      if (char === "\n") {
        if (this.ignoreNextNewline) {
          this.ignoreNextNewline = false;
          continue;
        }
        if (this.emitKey("\n")) {
          this.output.write("\n");
          continue;
        }
        this.output.write("\n");
        this.emitLine(this.buffer);
        this.buffer = "";
        continue;
      }
      if (char === "\u007f") {
        this.ignoreNextNewline = false;
        if (this.buffer.length > 0) {
          this.buffer = Array.from(this.buffer).slice(0, -1).join("");
          this.output.write("\b \b");
        }
        continue;
      }
      if (char >= " ") {
        if (this.emitKey(char)) {
          this.output.write(`${char}\n`);
          this.ignoreNextNewline = true;
          continue;
        }
        this.ignoreNextNewline = false;
        this.buffer += char;
        this.output.write(char);
      }
    }
  };

  private emitLine(line: string): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(line);
      return;
    }
    this.pendingLines.push(line);
  }

  private emitKey(key: string): boolean {
    const waiter = this.keyWaiters.shift();
    if (!waiter) {
      return false;
    }
    waiter(key);
    return true;
  }
}
