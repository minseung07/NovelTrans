import type { NovelTransConfig } from "../domain/config.js";
import { exportGlossaryJson, relatedTermsForEpisode } from "./actions/glossaryActions.js";
import { toggleGlossaryAppendix, toggleOutputFormat, toggleVerticalWriting } from "./actions/exportActions.js";
import { errorLogPath } from "./actions/failureActions.js";
import { markSelectedIssueIgnored, openSelectedIssueTranslation } from "./actions/reviewActions.js";
import { cycleDefaultBackend, cycleGlossaryStrictness } from "./actions/settingsActions.js";
import type { ReviewRetranslationScope } from "./reviewRetranslationTask.js";
import type { GlossaryQueueFilter, ProjectUiModel, SettingsViewMode, StudioSpace } from "./types.js";

export type PaletteExecutionContext = {
  commandId: string;
  config: NovelTransConfig;
  configDir?: string;
  projectDir: string | null;
  previousSpace: StudioSpace;
  selectedIssueIndex: number;
  currentEpisodeTitle: string | null;
  loadProjectModel: () => Promise<ProjectUiModel>;
};

export type PaletteExecutionEffect =
  | { type: "import-source" }
  | { type: "start-translation"; mode: "resume" | "retry-failed" }
  | { type: "review-retranslate-issue"; scope: ReviewRetranslationScope }
  | { type: "skip-failed-export" }
  | { type: "rerun-qa" }
  | { type: "export-all" };

export type PaletteExecutionResult = {
  config?: NovelTransConfig;
  space?: StudioSpace;
  searchQuery?: string;
  selectedProjectIndex?: number;
  glossaryFilter?: GlossaryQueueFilter;
  settingsMode?: SettingsViewMode;
  message?: string;
  effect?: PaletteExecutionEffect;
};

export async function executePaletteCommand(context: PaletteExecutionContext): Promise<PaletteExecutionResult> {
  const global = await executeGlobalPaletteCommand(context);
  if (global) {
    return global;
  }
  if (!context.projectDir) {
    return { space: "bookshelf", message: "먼저 프로젝트를 여세요." };
  }
  return executeProjectPaletteCommand(context, context.projectDir);
}

async function executeGlobalPaletteCommand(context: PaletteExecutionContext): Promise<PaletteExecutionResult | null> {
  const commandId = context.commandId;
  if (commandId === "open-bookshelf") {
    return { space: "bookshelf" };
  }
  if (commandId === "import-source") {
    return { space: "bookshelf", effect: { type: "import-source" } };
  }
  if (commandId === "search-projects") {
    return { space: "project-search", searchQuery: "", selectedProjectIndex: 0 };
  }
  if (commandId === "open-settings") {
    return { space: "settings", settingsMode: "basic" };
  }
  if (commandId === "settings-cycle-backend") {
    const config = await cycleDefaultBackend(context.config, context.configDir);
    return { config, space: "settings", settingsMode: "advanced", message: `기본 번역 엔진: ${config.defaultBackend}.` };
  }
  if (commandId === "settings-cycle-strictness") {
    const config = await cycleGlossaryStrictness(context.config, context.configDir);
    return { config, space: "settings", settingsMode: "advanced", message: `용어 엄격도: ${config.glossaryStrictness}.` };
  }
  if (commandId === "open-help") {
    return { space: "help" };
  }
  return null;
}

async function executeProjectPaletteCommand(context: PaletteExecutionContext, projectDir: string): Promise<PaletteExecutionResult> {
  const commandId = context.commandId;
  if (commandId === "open-studio") {
    return { space: "studio" };
  }
  if (commandId === "open-glossary" || commandId === "glossary-conflicts" || commandId === "glossary-candidates") {
    return {
      space: "glossary-lab",
      glossaryFilter: glossaryFilterForCommand(commandId)
    };
  }
  if (commandId === "glossary-export-json") {
    return { space: "glossary-lab", message: `용어집 JSON을 내보냈습니다: ${await exportGlossaryJson(projectDir)}` };
  }
  if (commandId === "glossary-current-terms") {
    const model = await context.loadProjectModel();
    return { space: "glossary-lab", message: relatedTermsForEpisode(model, context.currentEpisodeTitle) };
  }
  if (commandId === "open-review") {
    const model = await context.loadProjectModel();
    return { space: model.failureRecovery.failedCount > 0 ? "failure-recovery" : "review-desk" };
  }
  if (commandId === "open-failure-recovery") {
    return { space: "failure-recovery" };
  }
  if (commandId === "skip-failed-export") {
    return { space: "studio", message: "실패 화를 건너뛰고 완료분 결과물을 생성합니다.", effect: { type: "skip-failed-export" } };
  }
  if (commandId === "show-error-log") {
    return { space: "failure-recovery", message: `에러 로그: ${errorLogPath(projectDir)}` };
  }
  if (commandId === "review-open-translation") {
    const model = await context.loadProjectModel();
    return { space: "review-desk", message: await openSelectedIssueTranslation(projectDir, model, context.selectedIssueIndex) };
  }
  if (commandId === "review-ignore-issue") {
    const model = await context.loadProjectModel();
    return { space: "review-desk", message: await markSelectedIssueIgnored(projectDir, model, context.selectedIssueIndex) };
  }
  if (commandId === "review-retranslate-issue") {
    return { space: "studio", message: "선택한 검수 화를 재번역합니다.", effect: { type: "review-retranslate-issue", scope: "selected" } };
  }
  if (commandId === "review-retranslate-all") {
    return { space: "studio", message: "열린 검수 화를 모두 재번역합니다.", effect: { type: "review-retranslate-issue", scope: "all-open" } };
  }
  if (commandId === "review-retranslate-same-type") {
    return { space: "studio", message: "같은 유형의 검수 화를 재번역합니다.", effect: { type: "review-retranslate-issue", scope: "same-type" } };
  }
  if (commandId === "open-export") {
    return { space: "export-room" };
  }
  if (commandId === "export-toggle-txt") {
    await toggleOutputFormat(projectDir, "txt");
    return { space: "export-room", message: "TXT 결과물 설정을 변경했습니다." };
  }
  if (commandId === "export-toggle-epub") {
    await toggleOutputFormat(projectDir, "epub");
    return { space: "export-room", message: "EPUB 결과물 설정을 변경했습니다." };
  }
  if (commandId === "export-toggle-vertical") {
    const metadata = await toggleVerticalWriting(projectDir);
    return { space: "export-room", message: `세로쓰기를 ${metadata.outputOptions.verticalWriting ? "켰습니다" : "껐습니다"}.` };
  }
  if (commandId === "export-toggle-appendix") {
    const metadata = await toggleGlossaryAppendix(projectDir);
    return { space: "export-room", message: `용어집 부록을 ${metadata.outputOptions.includeGlossaryAppendix ? "켰습니다" : "껐습니다"}.` };
  }
  if (commandId === "continue-translation") {
    return { space: "studio", effect: { type: "start-translation", mode: "resume" } };
  }
  if (commandId === "retry-failed") {
    return { space: "failure-recovery", effect: { type: "start-translation", mode: "retry-failed" } };
  }
  if (commandId === "rerun-qa") {
    return { space: "studio", message: "검수 항목을 다시 검사합니다.", effect: { type: "rerun-qa" } };
  }
  if (commandId === "export-all") {
    return { space: "studio", message: "TXT/EPUB 결과물을 생성합니다.", effect: { type: "export-all" } };
  }
  return { space: context.previousSpace };
}

function glossaryFilterForCommand(commandId: string): GlossaryQueueFilter {
  if (commandId === "glossary-conflicts") {
    return "conflicts";
  }
  if (commandId === "glossary-candidates") {
    return "candidates";
  }
  return "all";
}
