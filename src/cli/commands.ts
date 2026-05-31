import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadConfig, initConfig, resolveProjectRoot, getConfigPath, saveConfig } from "../config/configStore.js";
import {
  clearOpenAICompatibleApiKey,
  getCredentialPath,
  loadOpenAICompatibleApiKey,
  saveOpenAICompatibleApiKey
} from "../config/credentialStore.js";
import type { NovelTransConfig } from "../domain/config.js";
import { defaultConfig } from "../config/defaultConfig.js";
import { exportProject, type ExportFormat } from "../export/exporter.js";
import { addForbiddenTarget, confirmGlossaryTerm, deprecateGlossaryTerm } from "../glossary/glossaryEngine.js";
import { createProjectFromText, createProjectFromTxt, loadProjectOverview, rerunProjectQA, runTranslation } from "../engine/projectWorkflow.js";
import { createTranslatorAdapter } from "../translation/adapters/adapterFactory.js";
import { ensureDir } from "../storage/jsonFile.js";
import { writeProjectLog } from "../storage/logger.js";
import { loadGlossary, loadProjectMetadata, saveGlossary, saveProjectMetadata } from "../storage/projectStore.js";
import { setCodexCliModel, setOpenAICompatibleModel } from "../ui/actions/settingsActions.js";
import { runUiV2 } from "../ui-v2/app.js";
import { renderLibraryStatic, renderProjectStageStatic, renderPaletteStatic } from "../ui-v2/static.js";
import { errorLogPath, skipFailedAndExport } from "../ui/actions/failureActions.js";
import { WebImportService } from "../webImport/webImportService.js";
import { parseArgs, getBooleanOption, getListOption, getStringOption, requireStringOption } from "./args.js";
import { renderProjectStatus } from "./render.js";

type CliIO = {
  stdout: Pick<typeof console, "log">;
  stderr: Pick<typeof console, "error">;
};

type ImportBaseOptions = {
  projectRoot: string;
  name?: string;
  backend: string;
  model?: string;
  translationStyle: NovelTransConfig["translationStyle"];
  concurrency: number;
  glossaryStrictness: NovelTransConfig["glossaryStrictness"];
  qaOptions?: NovelTransConfig["qa"];
  outputOptions?: Partial<import("../domain/project.js").ProjectMetadata["outputOptions"]>;
  userConfirmedRights?: boolean;
};

export async function runCli(argv: string[], io: CliIO = { stdout: console, stderr: console }): Promise<number> {
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
        throw new Error(`알 수 없는 명령입니다: ${args.command}. "noveltrans help"를 실행하세요.`);
    }
  } catch (error) {
    io.stderr.error((error as Error).message);
    return 1;
  }
}

async function commandApp(args: ReturnType<typeof parseArgs>, _io: CliIO): Promise<void> {
  const config = await loadConfigFromArgs(args);
  await runUiV2({
    config,
    configDir: getStringOption(args, "config-dir"),
    projectRoot: getStringOption(args, "workspace")
  });
}

async function commandBookshelf(args: ReturnType<typeof parseArgs>, io: CliIO): Promise<void> {
  const config = await loadConfigFromArgs(args);
  const projectRoot = resolveProjectRoot(config, getStringOption(args, "workspace"));
  io.stdout.log(await renderLibraryStatic(config, projectRoot));
}

async function commandImport(args: ReturnType<typeof parseArgs>, io: CliIO): Promise<void> {
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
    userConfirmedRights: true
  };
  const inlineText = getStringOption(args, "text");
  const url = getStringOption(args, "url");
  const result =
    url
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

async function importFromWebUrl(
  args: ReturnType<typeof parseArgs>,
  baseOptions: ImportBaseOptions
): Promise<Awaited<ReturnType<typeof createProjectFromText>>> {
  const range = getStringOption(args, "episodes");
  if (!range) {
    throw new Error("URL 가져오기는 --episodes가 필요합니다. 예: --episodes 1-10");
  }
  const service = new WebImportService();
  const work = await service.loadWork(requireStringOption(args, "url"));
  const preview = service.buildPreview(work, range);
  const imported = await service.importProject(preview, baseOptions);
  return imported.created;
}

async function commandTranslate(args: ReturnType<typeof parseArgs>, io: CliIO, mode: "resume" | "retry-failed"): Promise<void> {
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
  if (backend === "dry-run") {
    io.stderr.error(
      "경고: dry-run 백엔드는 실제 번역이 아닌 자리표시자 텍스트를 만듭니다. 실제 번역은 \"noveltrans config set --backend openai-compatible\"로 엔진을 설정하세요."
    );
  }
  const failEpisodeIds = getListOption(args, "fail-episode");
  const adapter = createTranslatorAdapter(backend, config, { failEpisodeIds, credentialConfigDir: getStringOption(args, "config-dir") });
  const summary = await runTranslation(projectDir, adapter, mode, numberOption(args, "concurrency", metadata.options.concurrency), config.qa);
  io.stdout.log(`대기: ${summary.queued}`);
  io.stdout.log(`완료: ${summary.completed}`);
  io.stdout.log(`실패: ${summary.failed}`);
  io.stdout.log(`검수 항목: ${summary.qaIssues}`);
}

async function commandStatus(args: ReturnType<typeof parseArgs>, io: CliIO): Promise<void> {
  const overview = await loadProjectOverview(resolve(requireStringOption(args, "project")));
  io.stdout.log(renderProjectStatus(overview));
}

async function commandStudio(args: ReturnType<typeof parseArgs>, io: CliIO): Promise<void> {
  const config = await loadConfigFromArgs(args);
  io.stdout.log(await renderProjectStageStatic(config, resolve(requireStringOption(args, "project")), "overview"));
}

async function commandGlossaryLab(args: ReturnType<typeof parseArgs>, io: CliIO): Promise<void> {
  const config = await loadConfigFromArgs(args);
  io.stdout.log(await renderProjectStageStatic(config, resolve(requireStringOption(args, "project")), "glossary"));
}

async function commandReviewDesk(args: ReturnType<typeof parseArgs>, io: CliIO): Promise<void> {
  const config = await loadConfigFromArgs(args);
  io.stdout.log(await renderProjectStageStatic(config, resolve(requireStringOption(args, "project")), "qa"));
}

async function commandFailureRecovery(args: ReturnType<typeof parseArgs>, io: CliIO): Promise<void> {
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
    throw new Error(`알 수 없는 실패 복구 작업입니다: ${action}.`);
  }
  const config = await loadConfigFromArgs(args);
  io.stdout.log(await renderProjectStageStatic(config, projectDir, "translate"));
}

async function commandExportRoom(args: ReturnType<typeof parseArgs>, io: CliIO): Promise<void> {
  const config = await loadConfigFromArgs(args);
  io.stdout.log(await renderProjectStageStatic(config, resolve(requireStringOption(args, "project")), "export"));
}

async function commandPalette(args: ReturnType<typeof parseArgs>, io: CliIO): Promise<void> {
  io.stdout.log(renderPaletteStatic(getStringOption(args, "query") ?? "", Boolean(getStringOption(args, "project"))));
}

async function commandExport(args: ReturnType<typeof parseArgs>, io: CliIO): Promise<void> {
  const projectDir = resolve(requireStringOption(args, "project"));
  const metadata = await loadProjectMetadata(projectDir);
  const requestedFormats = getListOption(args, "format").concat(getListOption(args, "formats"));
  const formats = (requestedFormats.length > 0 ? requestedFormats : metadata.outputOptions.formats).filter(isExportFormat);
  if (formats.length === 0) {
    throw new Error("지원하는 출력 형식이 지정되지 않았습니다.");
  }
  const summary = await exportProject(metadata, formats);
  io.stdout.log(`${summary.translatedEpisodeCount}개 번역 화를 결과물로 만들었습니다.`);
  for (const file of summary.files) {
    io.stdout.log(file);
  }
}

async function commandQA(args: ReturnType<typeof parseArgs>, io: CliIO): Promise<void> {
  const config = await loadConfigFromArgs(args);
  const projectDir = resolve(requireStringOption(args, "project"));
  const issues = await rerunProjectQA(projectDir, undefined, config.qa);
  io.stdout.log(`검수 항목: ${issues.length}`);
}

async function commandGlossary(args: ReturnType<typeof parseArgs>, io: CliIO): Promise<void> {
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

  throw new Error(`알 수 없는 용어집 작업입니다: ${action}.`);
}

async function commandConfig(args: ReturnType<typeof parseArgs>, io: CliIO): Promise<void> {
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
        throw new Error(`지원하지 않는 백엔드입니다: ${backend}.`);
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
  throw new Error(`알 수 없는 설정 작업입니다: ${action}.`);
}

async function commandAuth(args: ReturnType<typeof parseArgs>, io: CliIO): Promise<void> {
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

  throw new Error(`알 수 없는 인증 작업입니다: ${action}.`);
}

async function commandSelfTest(args: ReturnType<typeof parseArgs>, io: CliIO): Promise<void> {
  const workspace = resolve(getStringOption(args, "workspace") ?? "tmp/self-test");
  const sourcePath = join(workspace, "sample.txt");
  await ensureDir(workspace);
  await writeFile(
    sourcePath,
    [
      "第1話 黒架",
      "黒架は第七区で聖印を見た。12人の騎士がいた。",
      "",
      "第2話 聖印",
      "聖印は黒架を導いた。影縫いの剣が光った。",
      "",
      "第3話 帰還",
      "黒架は魔導炉へ戻った。12の鐘が鳴った。"
    ].join("\n"),
    "utf8"
  );

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

function numberOption(args: ReturnType<typeof parseArgs>, name: string, fallback: number): number {
  const value = getStringOption(args, name);
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isSupportedBackend(value: string): value is NovelTransConfig["defaultBackend"] {
  return value === "dry-run" || value === "openai-compatible" || value === "codex-cli";
}

function isExportFormat(value: string): value is ExportFormat {
  return value === "txt" || value === "epub";
}

async function loadConfigFromArgs(args: ReturnType<typeof parseArgs>) {
  return loadConfig(getStringOption(args, "config-dir"));
}

function renderHelp(): string {
  return [
    "NovelTrans — 일본어 웹소설 한국어 번역 도구",
    "",
    "사용법:",
    "  noveltrans <명령> [옵션]",
    "",
    "핵심 명령:",
    "  app                대화형 터미널 앱 실행 (별칭: ui)",
    "  import             원문 가져오기: --source 파일 | --url | --text | --stdin (별칭: create)",
    "  translate          번역 이어가기 --project <경로> [--backend] [--model]",
    "  retry              실패한 화만 다시 번역 --project <경로>",
    "  status             프로젝트 진행 상황 보기 --project <경로>",
    "  glossary           용어집 작업 --project <경로> [summary|conflicts|set|forbid|discard]",
    "  qa                 QA 재검사 실행 --project <경로>",
    "  export             결과물 생성 --project <경로> --formats txt,epub",
    "  config             설정 보기/초기화/변경 [show|init|set]",
    "  auth               OpenAI 호환 API 키 관리 [status|set-openai-key|clear-openai-key] (별칭: credentials)",
    "  self-test          dry-run 스모크 테스트 실행 --workspace tmp/self-test",
    "",
    "앱 화면 미리보기 (비대화형 스냅샷 출력):",
    "  bookshelf          책장(프로젝트 목록) 출력",
    "  studio             프로젝트 작업실 개요 출력",
    "  glossary-lab       용어집 화면 출력 (별칭: lab)",
    "  review-desk        검수 화면 출력 (별칭: review)",
    "  failure-recovery   실패 복구 [screen|skip-and-export|logs] (별칭: recover)",
    "  export-room        결과물 제작 화면 출력 (별칭: room)",
    "  palette            명령 팔레트 미리보기 [--query glossary]",
    "",
    "전역 옵션:",
    "  --workspace <경로>   프로젝트 루트 (기본: ./projects)",
    "  --config-dir <경로>  설정/인증 디렉터리 (기본: ~/.config/noveltrans)",
    "",
    "예시:",
    "  noveltrans import --url https://kakuyomu.jp/works/... --episodes 1-10",
    "  noveltrans translate --project projects/title --backend openai-compatible"
  ].join("\n");
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function normalizeInlineText(value: string): string {
  return value.replaceAll("\\n", "\n");
}
