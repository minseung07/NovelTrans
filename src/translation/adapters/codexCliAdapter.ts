import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdapterStatus, TranslationInput, TranslationResult, TranslatorAdapter } from "../../domain/translation.js";
import { nowIso } from "../../utils/time.js";
import { runCodexCommand, summarizeCodexOutput } from "./codexCliProcess.js";
import { parseTranslationResponse } from "./translationResponse.js";

type CodexCliAdapterOptions = {
  command: string;
  model?: string;
  timeoutMs: number;
  sandbox: "read-only" | "workspace-write";
};

export class CodexCliAdapter implements TranslatorAdapter {
  readonly id = "codex-cli";
  readonly label = "Codex CLI translator";
  private readonly options: CodexCliAdapterOptions;

  constructor(options: Partial<CodexCliAdapterOptions> = {}) {
    this.options = {
      command: options.command ?? "codex",
      model: options.model,
      timeoutMs: options.timeoutMs ?? 300000,
      sandbox: options.sandbox ?? "read-only"
    };
  }

  async checkAvailability(): Promise<AdapterStatus> {
    try {
      const version = await runCodexCommand(this.options.command, ["--version"], Math.min(this.options.timeoutMs, 10000));
      if (version.code !== 0) {
        return {
          available: false,
          message: `codex CLI가 정상적으로 응답하지 않았습니다: ${summarizeCodexOutput(version)}`
        };
      }
      const login = await runCodexCommand(this.options.command, ["login", "status"], Math.min(this.options.timeoutMs, 10000));
      if (login.code !== 0) {
        return {
          available: false,
          message: `codex CLI는 설치되어 있지만 로그인되어 있지 않습니다 (not logged in): ${summarizeCodexOutput(login)}`
        };
      }
      return {
        available: true,
        message: `codex CLI를 사용할 수 있으며 로그인되어 있습니다. ${login.stdout || login.stderr}`.trim()
      };
    } catch (error) {
      return {
        available: false,
        message: isMissingCommandError(error) ? "codex CLI를 PATH에서 찾을 수 없습니다." : (error as Error).message
      };
    }
  }

  async translateEpisode(input: TranslationInput): Promise<TranslationResult> {
    const status = await this.checkAvailability();
    if (!status.available) {
      throw new Error(status.message);
    }

    const tempDir = await mkdtemp(join(tmpdir(), "noveltrans-codex-"));
    const outputPath = join(tempDir, "translation.txt");
    try {
      const model = input.model ?? this.options.model;
      await runCodexExec({ ...this.options, model }, outputPath, renderPrompt(input), input.signal);
      const content = (await readFile(outputPath, "utf8")).trim();
      if (!content) {
        throw new Error("codex CLI가 빈 번역을 반환했습니다.");
      }
      const parsed = parseTranslationResponse(content, input.episode.title);
      return {
        episodeId: input.episode.id,
        titleKo: parsed.titleKo,
        bodyKo: parsed.bodyKo,
        usedGlossaryEntries: input.glossaryEntries.filter((entry) => entry.target && input.episode.sourceText.includes(entry.source)).map((entry) => entry.id),
        newGlossaryCandidates: parsed.newGlossaryCandidates,
        qaIssueIds: [],
        model: model ?? "codex-cli-default",
        backend: this.id,
        createdAt: nowIso()
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

async function runCodexExec(options: CodexCliAdapterOptions, outputPath: string, prompt: string, signal?: AbortSignal): Promise<void> {
  const args = [
    "--ask-for-approval",
    "never",
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    options.sandbox,
    "--color",
    "never",
    "--output-last-message",
    outputPath
  ];
  if (options.model) {
    args.push("--model", options.model);
  }
  args.push("-");

  const result = await runCodexCommand(options.command, args, options.timeoutMs, prompt, signal);
  if (result.code !== 0) {
    throw new Error(`codex CLI가 종료 코드 ${result.code}로 실패했습니다: ${summarizeCodexOutput(result)}`);
  }
}

function isMissingCommandError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function renderPrompt(input: TranslationInput): string {
  const glossary = input.glossaryContext ? `\nGlossary rules:\n${input.glossaryContext}\n` : "";
  const style = input.styleGuide ? `\nTranslation style:\n${input.styleGuide}\n` : "";
  return [
    "Translate this Japanese web novel episode into natural Korean.",
    "Return only strict JSON with this shape: {\"titleKo\":\"...\",\"bodyKo\":\"...\",\"newGlossaryCandidates\":[\"source => target\"]}. Use original Japanese source terms on the left and Korean translation candidates on the right. Do not edit files, run commands, explain, summarize, or add markdown fences.",
    "Preserve paragraph boundaries and important numbers.",
    style,
    glossary,
    `Title: ${input.episode.title}`,
    "",
    input.episode.body
  ].join("\n");
}
