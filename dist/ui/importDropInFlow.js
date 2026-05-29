import { readFile } from "node:fs/promises";
import { analyzeSource } from "../engine/sourceAnalyzer.js";
import { createProjectFromText, createProjectFromTxt } from "../engine/projectWorkflow.js";
import { renderSettingsScreen } from "./screens/settingsScreen.js";
import { renderImportAnalysis, renderImportDropInPrompt } from "./screens/importDropInScreen.js";
import { parseImportAnalysisChoice, parseRecipePresetId } from "./importChoices.js";
import { recipeSummary } from "./studioData.js";
import { saveRecipePreset } from "./actions/settingsActions.js";
import { normalizeSourcePathInput } from "./sourcePathInput.js";
import { TerminalLineReader } from "./terminalLineReader.js";
import { detectWebImportUrl } from "../webImport/urlDetector.js";
import { WebImportService, webImportConsentMessage } from "../webImport/webImportService.js";
import { writeWebImportProgress, writeWebWorkLoadingStatus } from "./webImportProgress.js";
export async function runImportDropInFlow(options) {
    let config = options.config;
    options.output.write(`\x1b[2J\x1b[H${renderImportDropInPrompt(options.projectRoot)}`);
    const reader = new TerminalLineReader(options.input, options.output);
    reader.start();
    try {
        const source = await readSourceWithRetry(reader, options.output);
        if (!source) {
            return cancelled(config);
        }
        if (source.kind === "web") {
            try {
                const service = new WebImportService();
                writeWebWorkLoadingStatus(options.output, source.url);
                const work = await service.loadWork(source.url);
                const preview = await readWebImportPreview(reader, options.output, service, work);
                if (!preview) {
                    return cancelled(config);
                }
                options.output.write("\n웹 원문 다운로드\n");
                const startedAt = Date.now();
                let progressShown = false;
                const created = await service
                    .importProject(preview, projectOptionsFromConfig(config, options.projectRoot), (event) => {
                    progressShown = true;
                    writeWebImportProgress(options.output, event, startedAt);
                })
                    .finally(() => {
                    if (progressShown) {
                        options.output.write("\n");
                    }
                });
                return {
                    config,
                    projectDir: created.created.metadata.projectDir,
                    targetSpace: "studio",
                    message: `웹 원문 가져오기 완료: ${created.created.metadata.projectDir}`
                };
            }
            catch (error) {
                return {
                    config,
                    projectDir: null,
                    targetSpace: null,
                    message: `웹 원문 가져오기 실패: ${error.message}`
                };
            }
        }
        const { sourceText, pasted, sourcePath } = source;
        const analysis = analyzeSource(sourceText);
        options.output.write(`\n${renderImportAnalysis(analysis, recipeSummary(config))}\n`);
        const choice = await readImportAnalysisChoice(reader, options.output, analysis, config, options.configDir);
        config = choice.config;
        if (choice.intent === "cancel") {
            return cancelled(config);
        }
        const created = pasted
            ? await createProjectFromText({
                ...projectOptionsFromConfig(config, options.projectRoot),
                sourceText,
                sourceLabel: "paste://terminal"
            })
            : await createProjectFromTxt({
                ...projectOptionsFromConfig(config, options.projectRoot),
                sourcePath: sourcePath ?? ""
            });
        return {
            config,
            projectDir: created.metadata.projectDir,
            targetSpace: choice.intent === "glossary" ? "glossary-lab" : "studio",
            message: choice.intent === "glossary"
                ? `프로젝트를 만들었습니다: ${created.metadata.projectDir}. 번역 전에 후보 용어를 확인하세요.`
                : `프로젝트를 만들었습니다: ${created.metadata.projectDir}`
        };
    }
    finally {
        reader.close();
        options.input.setRawMode(true);
    }
}
async function readImportAnalysisChoice(reader, output, analysis, config, configDir) {
    let intent = await promptImportAnalysisChoice(reader, output);
    if (intent !== "recipe") {
        return { config, intent };
    }
    output.write(`\n${renderSettingsScreen(config)}\n1-6번 레시피를 고르거나 Enter로 현재 설정을 유지하세요.\n`);
    const preset = parseRecipePresetId(await reader.readLine(""));
    let nextConfig = config;
    if (preset) {
        nextConfig = await saveRecipePreset(config, preset, configDir);
        output.write(`\n레시피 ${preset}번을 적용했습니다.\n`);
    }
    output.write(`\n${renderImportAnalysis(analysis, recipeSummary(nextConfig))}\n`);
    intent = await promptImportAnalysisChoice(reader, output);
    return { config: nextConfig, intent: intent === "recipe" ? "start" : intent };
}
async function readSourceWithRetry(reader, output) {
    while (true) {
        const rawSourcePath = (await reader.readLine("")).trim();
        if (!rawSourcePath) {
            return null;
        }
        if (rawSourcePath === ":paste") {
            return {
                kind: "text",
                sourceText: await readPastedSource(reader, output),
                pasted: true,
                sourcePath: null
            };
        }
        const sourcePath = normalizeSourcePathInput(rawSourcePath);
        if (detectWebImportUrl(sourcePath)) {
            return { kind: "web", url: sourcePath };
        }
        try {
            return {
                kind: "text",
                sourceText: await readFile(sourcePath, "utf8"),
                pasted: false,
                sourcePath
            };
        }
        catch (error) {
            output.write(`\n원문을 읽을 수 없습니다: ${error.message}\n다른 경로를 붙여넣거나, :paste 를 쓰거나, Enter로 취소하세요.\n> `);
        }
    }
}
async function readWebImportPreview(reader, output, service, work) {
    output.write(`\n웹 원문 감지\n작품: ${work.title}\n사이트: ${work.site === "syosetu" ? "소설가가 되자" : "카쿠요무"}\n전체 화수: ${work.episodes.length}\n`);
    while (true) {
        output.write("\n가져올 화수 범위: ");
        const rangeInput = await reader.readLine("");
        if (!rangeInput.trim() || rangeInput.trim().toLowerCase() === "q") {
            return null;
        }
        try {
            const preview = service.buildPreview(work, rangeInput);
            output.write(`\n${webImportConsentMessage(work, preview.selection, preview.selectedEpisodes.length)}\n`);
            while (true) {
                const consent = (await reader.readKey("> ")).trim().toLowerCase();
                if (consent === "y") {
                    return preview;
                }
                if (consent === "r") {
                    break;
                }
                if (consent === "q" || consent === "") {
                    return null;
                }
                output.write("Y, R, Q 중 하나를 누르세요.\n");
            }
        }
        catch (error) {
            output.write(`\n${error.message}\n`);
        }
    }
}
async function promptImportAnalysisChoice(reader, output) {
    while (true) {
        const intent = parseImportAnalysisChoice(await reader.readLine(""));
        if (intent !== "invalid") {
            return intent;
        }
        output.write("Enter, E, G, Q 중 하나를 입력하세요.\n");
    }
}
async function readPastedSource(reader, output) {
    const lines = [];
    output.write("원문을 붙여넣으세요. EOF 한 줄로 마칩니다.\n");
    while (true) {
        const line = await reader.readLine("");
        if (line === "EOF") {
            break;
        }
        lines.push(line);
    }
    return lines.join("\n");
}
function cancelled(config) {
    return {
        config,
        projectDir: null,
        targetSpace: null,
        message: "가져오기를 취소했습니다."
    };
}
function projectOptionsFromConfig(config, projectRoot) {
    return {
        projectRoot,
        backend: config.defaultBackend,
        translationStyle: config.translationStyle,
        concurrency: config.concurrency,
        glossaryStrictness: config.glossaryStrictness,
        qaOptions: config.qa,
        outputOptions: {
            formats: config.outputFormats,
            includeGlossaryAppendix: config.epub.includeGlossaryAppendix,
            includeAfterword: config.epub.includeAfterword,
            verticalWriting: config.epub.verticalWriting
        },
        userConfirmedRights: true
    };
}
