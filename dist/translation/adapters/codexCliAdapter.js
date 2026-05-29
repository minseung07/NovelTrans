import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nowIso } from "../../utils/time.js";
import { runCodexCommand, summarizeCodexOutput } from "./codexCliProcess.js";
import { parseTranslationResponse } from "./translationResponse.js";
export class CodexCliAdapter {
    id = "codex-cli";
    label = "Codex CLI translator";
    options;
    constructor(options = {}) {
        this.options = {
            command: options.command ?? "codex",
            model: options.model,
            timeoutMs: options.timeoutMs ?? 300000,
            sandbox: options.sandbox ?? "read-only"
        };
    }
    async checkAvailability() {
        try {
            const version = await runCodexCommand(this.options.command, ["--version"], Math.min(this.options.timeoutMs, 10000));
            if (version.code !== 0) {
                return {
                    available: false,
                    message: `codex CLI did not respond successfully: ${summarizeCodexOutput(version)}`
                };
            }
            const login = await runCodexCommand(this.options.command, ["login", "status"], Math.min(this.options.timeoutMs, 10000));
            if (login.code !== 0) {
                return {
                    available: false,
                    message: `codex CLI is installed but not logged in: ${summarizeCodexOutput(login)}`
                };
            }
            return {
                available: true,
                message: `codex CLI is available and logged in. ${login.stdout || login.stderr}`.trim()
            };
        }
        catch (error) {
            return {
                available: false,
                message: isMissingCommandError(error) ? "codex CLI was not found on PATH." : error.message
            };
        }
    }
    async translateEpisode(input) {
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
                throw new Error("codex CLI produced an empty translation.");
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
        }
        finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    }
}
async function runCodexExec(options, outputPath, prompt, signal) {
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
        throw new Error(`codex CLI failed with exit code ${result.code}: ${summarizeCodexOutput(result)}`);
    }
}
function isMissingCommandError(error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
function renderPrompt(input) {
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
