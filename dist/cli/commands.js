import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadConfig, initConfig, resolveProjectRoot, getConfigPath, saveConfig } from "../config/configStore.js";
import { clearOpenAICompatibleApiKey, getCredentialPath, loadOpenAICompatibleApiKey, saveOpenAICompatibleApiKey } from "../config/credentialStore.js";
import { defaultConfig } from "../config/defaultConfig.js";
import { exportProject } from "../export/exporter.js";
import { addForbiddenTarget, confirmGlossaryTerm, deprecateGlossaryTerm } from "../glossary/glossaryEngine.js";
import { createProjectFromText, createProjectFromTxt, loadProjectOverview, rerunProjectQA, runTranslation } from "../engine/projectWorkflow.js";
import { createTranslatorAdapter } from "../translation/adapters/adapterFactory.js";
import { ensureDir } from "../storage/jsonFile.js";
import { writeProjectLog } from "../storage/logger.js";
import { loadGlossary, loadProjectMetadata, saveGlossary, saveProjectMetadata } from "../storage/projectStore.js";
import { loadBookshelfModel, loadProjectUiModel } from "../ui/studioData.js";
import { setCodexCliModel, setOpenAICompatibleModel } from "../ui/actions/settingsActions.js";
import { runTerminalStudio } from "../ui/terminalApp.js";
import { renderBookshelfScreen } from "../ui/screens/bookshelfScreen.js";
import { renderCommandPaletteScreen } from "../ui/screens/commandPaletteScreen.js";
import { renderExportRoomScreen } from "../ui/screens/exportRoomScreen.js";
import { renderGlossaryLabScreen } from "../ui/screens/glossaryLabScreen.js";
import { renderReviewDeskScreen } from "../ui/screens/reviewDeskScreen.js";
import { renderStudioScreen } from "../ui/screens/studioScreen.js";
import { renderFailureRecoveryScreen } from "../ui/screens/failureRecoveryScreen.js";
import { errorLogPath, skipFailedAndExport } from "../ui/actions/failureActions.js";
import { WebImportService } from "../webImport/webImportService.js";
import { parseArgs, getBooleanOption, getListOption, getStringOption, requireStringOption } from "./args.js";
import { renderProjectStatus } from "./render.js";
export async function runCli(argv, io = { stdout: console, stderr: console }) {
    try {
        if (argv.length === 0 && process.stdin.isTTY && process.stdout.isTTY) {
            await commandApp(parseArgs(["app"]), io);
            return 0;
        }
        const args = parseArgs(argv);
        if (args.command === "help" || args.command === "--help" || args.command === "-h") {
            io.stdout.log(renderHelp());
            return 0;
        }
        switch (args.command) {
            case "app":
            case "ui":
                await commandApp(args, io);
                return 0;
            case "bookshelf":
                await commandBookshelf(args, io);
                return 0;
            case "import":
            case "create":
                await commandImport(args, io);
                return 0;
            case "translate":
                await commandTranslate(args, io, "resume");
                return 0;
            case "retry":
                await commandTranslate(args, io, "retry-failed");
                return 0;
            case "status":
                await commandStatus(args, io);
                return 0;
            case "studio":
                await commandStudio(args, io);
                return 0;
            case "glossary-lab":
            case "lab":
                await commandGlossaryLab(args, io);
                return 0;
            case "review-desk":
            case "review":
                await commandReviewDesk(args, io);
                return 0;
            case "failure-recovery":
            case "recover":
                await commandFailureRecovery(args, io);
                return 0;
            case "export-room":
            case "room":
                await commandExportRoom(args, io);
                return 0;
            case "palette":
                await commandPalette(args, io);
                return 0;
            case "export":
                await commandExport(args, io);
                return 0;
            case "qa":
                await commandQA(args, io);
                return 0;
            case "glossary":
                await commandGlossary(args, io);
                return 0;
            case "config":
                await commandConfig(args, io);
                return 0;
            case "auth":
            case "credentials":
                await commandAuth(args, io);
                return 0;
            case "self-test":
                await commandSelfTest(args, io);
                return 0;
            default:
                throw new Error(`Unknown command: ${args.command}. Run "noveltrans help".`);
        }
    }
    catch (error) {
        io.stderr.error(error.message);
        return 1;
    }
}
async function commandApp(args, _io) {
    const config = await loadConfigFromArgs(args);
    await runTerminalStudio({
        config,
        configDir: getStringOption(args, "config-dir"),
        projectRoot: getStringOption(args, "workspace")
    });
}
async function commandBookshelf(args, io) {
    const config = await loadConfigFromArgs(args);
    const workspace = getStringOption(args, "workspace");
    const projectRoot = resolveProjectRoot(config, workspace);
    io.stdout.log(renderBookshelfScreen(await loadBookshelfModel(projectRoot)));
}
async function commandImport(args, io) {
    const config = await loadConfigFromArgs(args);
    const backend = getStringOption(args, "backend") ?? config.defaultBackend;
    const projectRoot = resolveProjectRoot(config, getStringOption(args, "workspace"));
    const baseOptions = {
        projectRoot,
        name: getStringOption(args, "name"),
        backend,
        model: getStringOption(args, "model"),
        translationStyle: config.translationStyle,
        concurrency: numberOption(args, "concurrency", config.concurrency),
        glossaryStrictness: config.glossaryStrictness,
        qaOptions: config.qa,
        outputOptions: {
            formats: config.outputFormats,
            includeGlossaryAppendix: config.epub.includeGlossaryAppendix,
            includeAfterword: config.epub.includeAfterword,
            verticalWriting: config.epub.verticalWriting
        },
        userConfirmedRights: getBooleanOption(args, "confirm-rights")
    };
    const inlineText = getStringOption(args, "text");
    const url = getStringOption(args, "url");
    const result = url
        ? await importFromWebUrl(args, baseOptions)
        : getBooleanOption(args, "stdin") || inlineText
            ? await createProjectFromText({
                ...baseOptions,
                sourceText: inlineText ? normalizeInlineText(inlineText) : await readStdin(),
                sourceLabel: getBooleanOption(args, "stdin") ? "stdin://noveltrans" : "inline://noveltrans"
            })
            : await createProjectFromTxt({
                ...baseOptions,
                sourcePath: requireStringOption(args, "source")
            });
    io.stdout.log(`프로젝트를 만들었습니다: ${result.metadata.projectDir}`);
    io.stdout.log(`화수: ${result.analysis.episodeCount}`);
    io.stdout.log(`후보 용어: ${result.glossary.entries.length}`);
}
async function importFromWebUrl(args, baseOptions) {
    if (!baseOptions.userConfirmedRights) {
        throw new Error("URL import requires --confirm-rights for personal-use/public-episode confirmation.");
    }
    const range = getStringOption(args, "episodes");
    if (!range) {
        throw new Error("URL import requires --episodes. Example: --episodes 1-10");
    }
    const service = new WebImportService();
    const work = await service.loadWork(requireStringOption(args, "url"));
    const preview = service.buildPreview(work, range);
    const imported = await service.importProject(preview, baseOptions);
    return imported.created;
}
async function commandTranslate(args, io, mode) {
    const config = await loadConfigFromArgs(args);
    const projectDir = resolve(requireStringOption(args, "project"));
    const metadata = await loadProjectMetadata(projectDir);
    const modelOverride = getStringOption(args, "model");
    if (modelOverride !== undefined) {
        metadata.options.model = modelOverride.trim() || undefined;
        metadata.updatedAt = new Date().toISOString();
        await saveProjectMetadata(metadata);
    }
    const backend = getStringOption(args, "backend") ?? metadata.options.backend ?? config.defaultBackend;
    const failEpisodeIds = getListOption(args, "fail-episode");
    const adapter = createTranslatorAdapter(backend, config, { failEpisodeIds, credentialConfigDir: getStringOption(args, "config-dir") });
    const summary = await runTranslation(projectDir, adapter, mode, numberOption(args, "concurrency", metadata.options.concurrency), config.qa);
    io.stdout.log(`대기: ${summary.queued}`);
    io.stdout.log(`완료: ${summary.completed}`);
    io.stdout.log(`실패: ${summary.failed}`);
    io.stdout.log(`검수 항목: ${summary.qaIssues}`);
}
async function commandStatus(args, io) {
    const overview = await loadProjectOverview(resolve(requireStringOption(args, "project")));
    io.stdout.log(renderProjectStatus(overview));
}
async function commandStudio(args, io) {
    const model = await loadProjectUiModel(resolve(requireStringOption(args, "project")));
    io.stdout.log(renderStudioScreen(model));
}
async function commandGlossaryLab(args, io) {
    const model = await loadProjectUiModel(resolve(requireStringOption(args, "project")));
    io.stdout.log(renderGlossaryLabScreen(model, numberOption(args, "selected", 0)));
}
async function commandReviewDesk(args, io) {
    const model = await loadProjectUiModel(resolve(requireStringOption(args, "project")));
    io.stdout.log(renderReviewDeskScreen(model, numberOption(args, "selected", 0)));
}
async function commandFailureRecovery(args, io) {
    const projectDir = resolve(requireStringOption(args, "project"));
    const action = args.positionals[0] ?? "screen";
    if (action === "skip-and-export") {
        io.stdout.log(await skipFailedAndExport(projectDir));
        return;
    }
    if (action === "logs") {
        io.stdout.log(errorLogPath(projectDir));
        return;
    }
    if (action !== "screen") {
        throw new Error(`Unknown failure recovery action: ${action}.`);
    }
    const model = await loadProjectUiModel(projectDir);
    io.stdout.log(renderFailureRecoveryScreen(model));
}
async function commandExportRoom(args, io) {
    const model = await loadProjectUiModel(resolve(requireStringOption(args, "project")));
    io.stdout.log(renderExportRoomScreen(model));
}
async function commandPalette(args, io) {
    io.stdout.log(renderCommandPaletteScreen(getStringOption(args, "query") ?? "", Boolean(getStringOption(args, "project"))));
}
async function commandExport(args, io) {
    const projectDir = resolve(requireStringOption(args, "project"));
    const metadata = await loadProjectMetadata(projectDir);
    const requestedFormats = getListOption(args, "format").concat(getListOption(args, "formats"));
    const formats = (requestedFormats.length > 0 ? requestedFormats : metadata.outputOptions.formats).filter(isExportFormat);
    if (formats.length === 0) {
        throw new Error("No supported export format requested.");
    }
    const summary = await exportProject(metadata, formats);
    io.stdout.log(`${summary.translatedEpisodeCount}개 번역 화를 결과물로 만들었습니다.`);
    for (const file of summary.files) {
        io.stdout.log(file);
    }
}
async function commandQA(args, io) {
    const config = await loadConfigFromArgs(args);
    const projectDir = resolve(requireStringOption(args, "project"));
    const issues = await rerunProjectQA(projectDir, undefined, config.qa);
    io.stdout.log(`검수 항목: ${issues.length}`);
}
async function commandGlossary(args, io) {
    const projectDir = resolve(requireStringOption(args, "project"));
    const action = args.positionals[0] ?? "summary";
    const glossary = await loadGlossary(projectDir);
    if (action === "summary") {
        io.stdout.log(`전체 용어: ${glossary.entries.length}`);
        io.stdout.log(`후보: ${glossary.entries.filter((entry) => entry.status === "candidate").length}`);
        io.stdout.log(`고정: ${glossary.entries.filter((entry) => entry.locked).length}`);
        io.stdout.log(`충돌: ${glossary.conflicts.length}`);
        return;
    }
    if (action === "conflicts") {
        if (glossary.conflicts.length === 0) {
            io.stdout.log("용어 충돌이 없습니다.");
            return;
        }
        for (const conflict of glossary.conflicts) {
            io.stdout.log(`${conflict.source}: ${conflict.targets.join(" / ")}`);
        }
        return;
    }
    if (action === "set" || action === "confirm") {
        const source = requireStringOption(args, "source");
        const target = requireStringOption(args, "target");
        const next = confirmGlossaryTerm(glossary, source, target, getBooleanOption(args, "lock"));
        await saveGlossary(projectDir, next);
        await writeProjectLog({
            projectDir,
            category: "glossary",
            event: getBooleanOption(args, "lock") ? "term_locked" : "term_confirmed",
            message: `${source} -> ${target}`,
            projectId: (await loadProjectMetadata(projectDir)).id,
            metadata: { source, target, locked: getBooleanOption(args, "lock") }
        });
        io.stdout.log(`용어를 저장했습니다: ${source} -> ${target}`);
        return;
    }
    if (action === "forbid") {
        const source = requireStringOption(args, "source");
        const target = requireStringOption(args, "target");
        const next = addForbiddenTarget(glossary, source, target);
        await saveGlossary(projectDir, next);
        await writeProjectLog({
            projectDir,
            category: "glossary",
            event: "forbidden_target_added",
            message: `${source} !-> ${target}`,
            projectId: (await loadProjectMetadata(projectDir)).id,
            metadata: { source, target }
        });
        io.stdout.log(`금지 번역을 저장했습니다: ${source} !-> ${target}`);
        return;
    }
    if (action === "discard" || action === "deprecate") {
        const source = requireStringOption(args, "source");
        const next = deprecateGlossaryTerm(glossary, source);
        await saveGlossary(projectDir, next);
        await writeProjectLog({
            projectDir,
            category: "glossary",
            event: "term_deprecated",
            message: `${source} removed from review queue.`,
            projectId: (await loadProjectMetadata(projectDir)).id,
            metadata: { source }
        });
        io.stdout.log(`용어를 폐기했습니다: ${source}`);
        return;
    }
    throw new Error(`Unknown glossary action: ${action}.`);
}
async function commandConfig(args, io) {
    const configDir = getStringOption(args, "config-dir");
    const action = args.positionals[0] ?? "show";
    if (action === "init") {
        const config = await initConfig(configDir);
        io.stdout.log(`설정 파일을 썼습니다: ${getConfigPath(configDir)}`);
        io.stdout.log(JSON.stringify(config, null, 2));
        return;
    }
    if (action === "show") {
        const config = await loadConfig(configDir);
        io.stdout.log(JSON.stringify(config, null, 2));
        return;
    }
    if (action === "set") {
        let config = await loadConfig(configDir);
        const backend = getStringOption(args, "backend");
        if (backend) {
            if (!isSupportedBackend(backend)) {
                throw new Error(`Unsupported backend: ${backend}.`);
            }
            config = { ...config, defaultBackend: backend };
        }
        const openAIModel = getStringOption(args, "openai-model");
        if (openAIModel) {
            config = await setOpenAICompatibleModel(config, openAIModel, configDir);
        }
        const codexModel = getStringOption(args, "codex-model");
        if (codexModel) {
            config = await setCodexCliModel(config, codexModel, configDir);
        }
        const baseUrl = getStringOption(args, "base-url");
        if (baseUrl) {
            config = { ...config, openAICompatible: { ...config.openAICompatible, baseUrl } };
        }
        await saveConfig(config, configDir);
        io.stdout.log(JSON.stringify(config, null, 2));
        return;
    }
    throw new Error(`Unknown config action: ${action}.`);
}
async function commandAuth(args, io) {
    const configDir = getStringOption(args, "config-dir");
    const action = args.positionals[0] ?? "status";
    if (action === "status") {
        const fromEnv = Boolean(process.env.OPENAI_API_KEY);
        const fromStore = Boolean(loadOpenAICompatibleApiKey(configDir));
        io.stdout.log(`OpenAI 호환 API 키: ${fromEnv ? "환경 변수" : fromStore ? "저장됨" : "없음"}`);
        io.stdout.log(`인증 저장소: ${getCredentialPath(configDir)}`);
        return;
    }
    if (action === "set-openai-key") {
        const apiKey = getBooleanOption(args, "stdin") ? (await readStdin()).trim() : requireStringOption(args, "api-key");
        if (!apiKey) {
            throw new Error("API 키가 비어 있습니다.");
        }
        await saveOpenAICompatibleApiKey(apiKey, configDir);
        io.stdout.log(`OpenAI 호환 API 키를 저장했습니다: ${getCredentialPath(configDir)}`);
        return;
    }
    if (action === "clear-openai-key") {
        await clearOpenAICompatibleApiKey(configDir);
        io.stdout.log("OpenAI 호환 API 키를 지웠습니다.");
        return;
    }
    throw new Error(`Unknown auth action: ${action}.`);
}
async function commandSelfTest(args, io) {
    const workspace = resolve(getStringOption(args, "workspace") ?? "tmp/self-test");
    const sourcePath = join(workspace, "sample.txt");
    await ensureDir(workspace);
    await writeFile(sourcePath, [
        "第1話 黒架",
        "黒架は第七区で聖印を見た。12人の騎士がいた。",
        "",
        "第2話 聖印",
        "聖印は黒架を導いた。影縫いの剣が光った。",
        "",
        "第3話 帰還",
        "黒架は魔導炉へ戻った。12の鐘が鳴った。"
    ].join("\n"), "utf8");
    const projectRoot = join(workspace, "projects");
    const created = await createProjectFromTxt({
        sourcePath,
        projectRoot,
        name: "Self Test Novel",
        backend: "dry-run",
        model: "dry-run",
        concurrency: 2,
        glossaryStrictness: "high",
        userConfirmedRights: true
    });
    const config = { ...defaultConfig, projectRoot };
    const adapter = createTranslatorAdapter("dry-run", config);
    const translation = await runTranslation(created.metadata.projectDir, adapter, "resume", 2);
    const metadata = await loadProjectMetadata(created.metadata.projectDir);
    const exported = await exportProject(metadata, ["txt"]);
    io.stdout.log(`자가 테스트 프로젝트: ${created.metadata.projectDir}`);
    io.stdout.log(`화수: ${created.analysis.episodeCount}`);
    io.stdout.log(`완료: ${translation.completed}`);
    io.stdout.log(`TXT: ${exported.files[0] ?? "생성되지 않음"}`);
}
function numberOption(args, name, fallback) {
    const value = getStringOption(args, name);
    if (!value) {
        return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function isSupportedBackend(value) {
    return value === "dry-run" || value === "openai-compatible" || value === "codex-cli";
}
function isExportFormat(value) {
    return value === "txt" || value === "epub";
}
async function loadConfigFromArgs(args) {
    return loadConfig(getStringOption(args, "config-dir"));
}
function renderHelp() {
    return [
        "NovelTrans",
        "",
        "Commands:",
        "  app [--workspace projects]",
        "  bookshelf [--workspace projects]",
        "  import --source source.txt [--name Title] [--workspace projects]",
        "  import --url https://kakuyomu.jp/works/... --episodes 1-10 --confirm-rights",
        "  translate --project projects/title [--backend dry-run] [--model gpt-5.5]",
        "  retry --project projects/title",
        "  status --project projects/title",
        "  studio --project projects/title",
        "  glossary-lab --project projects/title",
        "  review-desk --project projects/title",
        "  failure-recovery --project projects/title [screen|skip-and-export|logs]",
        "  export-room --project projects/title",
        "  palette [--project projects/title] [--query glossary]",
        "  glossary --project projects/title [summary|conflicts|set|forbid|discard]",
        "  export --project projects/title --formats txt,epub",
        "  qa --project projects/title",
        "  config [show|init|set] [--backend openai-compatible] [--openai-model gpt-5.5] [--codex-model gpt-5.5]",
        "  auth status",
        "  auth set-openai-key --api-key sk-... | --stdin",
        "  auth clear-openai-key",
        "  self-test --workspace tmp/self-test"
    ].join("\n");
}
async function readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
}
function normalizeInlineText(value) {
    return value.replaceAll("\\n", "\n");
}
