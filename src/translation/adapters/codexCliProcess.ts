import { spawn } from "node:child_process";

type CodexCommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

export async function runCodexCommand(command: string, args: string[], timeoutMs: number, stdin?: string, signal?: AbortSignal): Promise<CodexCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    };
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      cleanup();
      reject(new Error(`codex CLI timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    const abort = () => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      cleanup();
      reject(new Error("codex CLI translation was cancelled."));
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8").trim(),
        stderr: Buffer.concat(stderr).toString("utf8").trim()
      });
    });

    child.stdin.end(stdin);
  });
}

export function summarizeCodexOutput(result: CodexCommandResult): string {
  return (result.stderr || result.stdout).slice(0, 1000);
}
