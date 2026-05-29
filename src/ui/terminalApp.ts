import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import type { ReadStream, WriteStream } from "node:tty";
import type { NovelTransConfig } from "../domain/config.js";
import { TranslationSession, type TranslationSessionSnapshot } from "../engine/translationSession.js";
import { createTranslatorAdapter } from "../translation/adapters/adapterFactory.js";
import { loadGlossary, loadProjectMetadata, saveGlossary, saveProjectMetadata, updateQAIssue } from "../storage/projectStore.js";
import { saveOpenAICompatibleApiKey } from "../config/credentialStore.js";
import { resolveProjectRoot, saveConfig } from "../config/configStore.js";
import { nowIso } from "../utils/time.js";
import { buildGlossaryQueue, deferSelectedGlossaryQueueItem, selectedGlossaryQueueItem } from "./glossaryQueue.js";
import { filterPaletteCommands, isConfirmingPaletteCommand } from "./commands.js";
import { executePaletteCommand } from "./paletteExecution.js";
import { selectedBookshelfProject } from "./bookshelfSelection.js";
import { runImportDropInFlow } from "./importDropInFlow.js";
import { loadBookshelfModel, loadProjectUiModel } from "./studioData.js";
import type { AdvancedSettingsItem, AdvancedSettingsOption, BookshelfModel, ProjectUiModel, StudioSpace } from "./types.js";
import { backFromTerminalSpace, createInitialTerminalState, moveTerminalSelection, type TerminalAppOptions, type TerminalState } from "./terminalState.js";
import { renderTerminalScreen } from "./terminalRenderer.js";
import { fitToViewport, type Viewport } from "./layout.js";
import { renderBookshelfScreen } from "./screens/bookshelfScreen.js";
import {
  confirmSelectedGlossaryTerm,
  discardSelectedGlossaryTerm,
  forbidSelectedGlossaryTarget,
  relatedTermsForIssue,
  suggestedGlossaryTarget
} from "./actions/glossaryActions.js";
import {
  clearCoverImagePath,
  formatExportPreview,
  generateAllExports,
  generateConfiguredExports,
  openOutputFolder,
  setCoverImagePath,
  toggleAfterword,
  toggleGlossaryAppendix,
  toggleOutputFormat,
  toggleVerticalWriting
} from "./actions/exportActions.js";
import { markSelectedIssueIgnored, openSelectedIssueTranslation, recheckReviewDeskQA } from "./actions/reviewActions.js";
import { errorLogPath, skipFailedAndExport } from "./actions/failureActions.js";
import { handleSettingsKey as handleTerminalSettingsKey } from "./keyHandlers/settingsKeyHandler.js";
import { setCodexCliModel, setOpenAICompatibleModel, toggleDefaultOutputFormat } from "./actions/settingsActions.js";
import { advancedSettingsOptions, buildAdvancedSettingsForm, selectedAdvancedSettingsOptionIndex } from "./settingsModel.js";
import { primaryStudioKeyIntent, type StudioKeyIntent } from "./studioKeyIntents.js";
import { completeTask, createRunningTask, failTask, isTaskRunning, type UiTaskSnapshot } from "./taskStatus.js";
import { buildReviewRetranslationQueue, createReviewRetranslationTask, failedReviewRetranslationSnapshot, type ReviewRetranslationScope, type ReviewRetranslationTask } from "./reviewRetranslationTask.js";
import { hideReviewDeskEpisodes } from "./reviewDeskModel.js";
import { createUndoAction, hideUndoHint, scopedUndoAction, visibleUndoHint, type UndoAction } from "./undoState.js";

type PendingConfirmation = {
  summary: string;
  onConfirm: () => Promise<boolean | void>;
  onCancel?: () => void;
};

export async function runTerminalStudio(options: TerminalAppOptions): Promise<void> {
  const app = new TerminalStudioApp(options);
  await app.run();
}

class TerminalStudioApp {
  private config: NovelTransConfig;
  private readonly configDir?: string;
  private readonly projectRoot: string;
  private readonly input: ReadStream;
  private readonly output: WriteStream;
  private translationSession: TranslationSession | null = null;
  private reviewRetranslationSnapshot: TranslationSessionSnapshot | null = null;
  private reviewRetranslationTask: ReviewRetranslationTask | null = null;
  private activeTask: UiTaskSnapshot | null = null;
  private renderTimer: NodeJS.Timeout | null = null;
  private state: TerminalState = createInitialTerminalState();
  private lastUndo: UndoAction | null = null;
  private pendingConfirmation: PendingConfirmation | null = null;

  constructor(options: TerminalAppOptions) {
    this.config = options.config;
    this.configDir = options.configDir;
    this.projectRoot = resolveProjectRoot(options.config, options.projectRoot);
    this.input = options.input ?? defaultInput;
    this.output = options.output ?? defaultOutput;
  }

  async run(): Promise<void> {
    if (!this.input.isTTY || !this.output.isTTY) {
      const bookshelf = await loadBookshelfModel(this.projectRoot);
      this.output.write(`${renderBookshelfScreen(bookshelf)}\n`);
      return;
    }

    this.input.setRawMode(true);
    this.input.resume();
    this.input.setEncoding("utf8");
    this.renderTimer = setInterval(() => {
      if (this.shouldAutoRender()) {
        void this.render();
      }
    }, 1000);
    try {
      await this.render();
      while (true) {
        const chunk = await this.readInputChunk();
        if (chunk === null) {
          break;
        }
        const shouldContinue = await this.handleKey(chunk);
        if (!shouldContinue) {
          break;
        }
        await this.render();
      }
    } finally {
      if (this.renderTimer) {
        clearInterval(this.renderTimer);
        this.renderTimer = null;
      }
      this.translationSession?.cancel();
      this.reviewRetranslationTask?.controller.abort();
      this.input.setRawMode(false);
      this.output.write("\x1b[?25h\n");
    }
  }

  private readInputChunk(): Promise<string | null> {
    return new Promise((resolve) => {
      const cleanup = () => {
        this.input.off("data", onData);
        this.input.off("end", onEnd);
        this.input.off("close", onEnd);
      };
      const onData = (chunk: Buffer | string) => {
        cleanup();
        resolve(String(chunk));
      };
      const onEnd = () => {
        cleanup();
        resolve(null);
      };
      this.input.once("data", onData);
      this.input.once("end", onEnd);
      this.input.once("close", onEnd);
    });
  }

  private async render(): Promise<void> {
    const viewport = this.viewport();
    const screen = await renderTerminalScreen({
      state: this.state,
      config: this.config,
      configDir: this.configDir,
      projectRoot: this.projectRoot,
      session: this.currentSessionSnapshot(),
      task: this.activeTask,
      loadProjectModel: () => this.loadCurrentProjectModel(),
      viewport
    });
    const confirmation = this.pendingConfirmation ? `\n${this.pendingConfirmation.summary} 진행할까요? [Y] 진행   [N/Esc] 취소` : "";
    this.lastUndo = scopedUndoAction(this.lastUndo, this.state);
    const undo = visibleUndoHint(this.lastUndo, this.state);
    const withMessage = `${screen}${this.state.message ? `\n\n${this.state.message}` : ""}${confirmation}${undo ? `\n[U] 되돌리기: ${undo.label}` : ""}`;
    this.output.write(`\x1b[2J\x1b[H\x1b[?25l${fitToViewport(withMessage, viewport)}`);
  }

  private async handleKey(key: string): Promise<boolean> {
    if (key.toLowerCase() !== "u") {
      this.lastUndo = hideUndoHint(this.lastUndo);
    }
    if (this.pendingConfirmation) {
      return this.handleConfirmationKey(key);
    }
    this.state.message = null;
    if (key === "\u0003") {
      if (this.requestQuitConfirmationIfActive()) {
        return true;
      }
      this.translationSession?.cancel();
      return false;
    }
    if (this.state.space === "command-palette") {
      return this.handlePaletteKey(key);
    }
    if (this.state.space === "project-search") {
      return this.handleSearchKey(key);
    }
    if (key.toLowerCase() === "q") {
      if (this.requestQuitConfirmationIfActive()) {
        return true;
      }
      this.translationSession?.cancel();
      return false;
    }
    if (this.state.space === "settings") {
      await this.handleSettingsKey(key);
      return true;
    }
    if (key === ":" || key === "\u000b") {
      this.state.previousSpace = this.state.space;
      this.state.space = "command-palette";
      this.state.paletteQuery = "";
      this.state.selectedCommandIndex = 0;
      return true;
    }
    if (key === "\u001b") {
      backFromTerminalSpace(this.state);
      return true;
    }
    if (key === "\u001b[A") {
      await this.moveSelection(-1);
      return true;
    }
    if (key === "\u001b[B") {
      await this.moveSelection(1);
      return true;
    }
    if (key.toLowerCase() === "u") {
      await this.undoLastAction();
      return true;
    }
    if (key.toLowerCase() === "b") {
      backFromTerminalSpace(this.state);
      return true;
    }
    if (key.toLowerCase() === "n" && this.state.space === "bookshelf") {
      await this.importSourceDropIn();
      return true;
    }
    if (key === "/" && this.state.space === "bookshelf") {
      this.state.previousSpace = this.state.space;
      this.state.space = "project-search";
      this.state.searchQuery = "";
      this.state.selectedProjectIndex = 0;
      return true;
    }
    if (key.toLowerCase() === "s" && this.state.space === "bookshelf") {
      this.state.previousSpace = this.state.space;
      this.state.space = "settings";
      this.state.settingsMode = "basic";
      return true;
    }
    if (this.state.space === "bookshelf" && key.toLowerCase() === "g") {
      this.state.glossaryFilter = "all";
      await this.openSelectedBookshelfProject("glossary-lab");
      return true;
    }
    if (this.state.space === "bookshelf" && key.toLowerCase() === "r") {
      await this.openSelectedBookshelfReview();
      return true;
    }
    if (key === "?") {
      this.state.previousSpace = this.state.space;
      this.state.space = "help";
      return true;
    }
    if (this.state.space === "glossary-lab" && this.state.projectDir) {
      await this.handleGlossaryKey(key);
      return true;
    }
    if (this.state.space === "review-desk" && this.state.projectDir) {
      await this.handleReviewKey(key);
      return true;
    }
    if (this.state.space === "export-room" && this.state.projectDir) {
      await this.handleExportKey(key);
      return true;
    }
    if (this.state.space === "failure-recovery" && this.state.projectDir) {
      await this.handleFailureRecoveryKey(key);
      return true;
    }
    if (key === "\r") {
      await this.handleEnter();
      return true;
    }
    if (this.state.space === "studio" && this.state.projectDir) {
      const intent = primaryStudioKeyIntent(await this.loadCurrentProjectModel(), key);
      if (intent) {
        await this.applyStudioKeyIntent(intent);
        return true;
      }
    }
    if (key.toLowerCase() === "g" && this.state.projectDir) {
      this.state.glossaryFilter = "all";
      this.state.space = "glossary-lab";
      return true;
    }
    if (key.toLowerCase() === "r" && this.state.projectDir) {
      const model = await this.loadCurrentProjectModel();
      this.state.space = model.failureRecovery.failedCount > 0 ? "failure-recovery" : "review-desk";
      return true;
    }
    if (key.toLowerCase() === "e" && this.state.projectDir) {
      this.state.space = "export-room";
      return true;
    }
    if (key.toLowerCase() === "t" && this.state.projectDir) {
      await this.startTranslationSession("resume");
      return true;
    }
    if (key === " " && this.state.space === "studio") {
      this.toggleTranslationPause();
      return true;
    }
    return true;
  }

  private async handleSearchKey(key: string): Promise<boolean> {
    if (key === "\u001b") {
      this.state.space = "bookshelf";
      return true;
    }
    if (key === "\r") {
      const project = this.filteredProjects((await loadBookshelfModel(this.projectRoot)))[this.state.selectedProjectIndex];
      if (project) {
        this.state.projectDir = project.projectDir;
        this.state.space = "studio";
      } else {
        this.state.message = "선택된 검색 결과가 없습니다.";
      }
      return true;
    }
    if (key === "\u001b[A") {
      this.state.selectedProjectIndex = Math.max(0, this.state.selectedProjectIndex - 1);
      return true;
    }
    if (key === "\u001b[B") {
      const maxIndex = Math.max(0, this.filteredProjects(await loadBookshelfModel(this.projectRoot)).length - 1);
      this.state.selectedProjectIndex = Math.min(maxIndex, this.state.selectedProjectIndex + 1);
      return true;
    }
    if (key === "\u007f") {
      this.state.searchQuery = Array.from(this.state.searchQuery).slice(0, -1).join("");
      this.state.selectedProjectIndex = 0;
      return true;
    }
    if (key.length === 1 && key >= " ") {
      this.state.searchQuery += key;
      this.state.selectedProjectIndex = 0;
    }
    return true;
  }

  private async handlePaletteKey(key: string): Promise<boolean> {
    if (key === "\u001b") {
      this.state.space = this.state.previousSpace;
      return true;
    }
    if (key === "\u001b[A") {
      const commands = filterPaletteCommands(this.state.paletteQuery, Boolean(this.state.projectDir));
      this.state.selectedCommandIndex = Math.max(0, this.state.selectedCommandIndex - 1);
      if (commands.length === 0) {
        this.state.selectedCommandIndex = 0;
      }
      return true;
    }
    if (key === "\u001b[B") {
      const commands = filterPaletteCommands(this.state.paletteQuery, Boolean(this.state.projectDir));
      const maxIndex = Math.max(0, commands.length - 1);
      this.state.selectedCommandIndex = Math.min(maxIndex, this.state.selectedCommandIndex + 1);
      return true;
    }
    if (key === "\r") {
      const commands = filterPaletteCommands(this.state.paletteQuery, Boolean(this.state.projectDir));
      const command = commands[Math.max(0, Math.min(commands.length - 1, this.state.selectedCommandIndex))];
      if (command) {
        if (isConfirmingPaletteCommand(command.id)) {
          this.pendingConfirmation = {
            summary: `${command.label} (${command.hint})`,
            onConfirm: async () => {
              await this.applyPaletteCommand(command.id);
            },
            onCancel: () => {
              this.state.message = "명령을 취소했습니다.";
              this.state.space = this.state.previousSpace;
            }
          };
          return true;
        }
        await this.applyPaletteCommand(command.id);
      } else {
        this.state.space = this.state.previousSpace;
      }
      return true;
    }
    if (key === "\u007f") {
      this.state.paletteQuery = Array.from(this.state.paletteQuery).slice(0, -1).join("");
      this.state.selectedCommandIndex = 0;
      return true;
    }
    if (key.length === 1 && key >= " ") {
      this.state.paletteQuery += key;
      this.state.selectedCommandIndex = 0;
    }
    return true;
  }

  private async handleSettingsKey(key: string): Promise<void> {
    if (this.state.settingsMode === "basic") {
      if (key.toLowerCase() === "a") {
        this.state.settingsMode = "advanced";
        this.state.settingsSectionIndex = 0;
        this.state.selectedSettingsItemIndex = 0;
        this.closeSettingsPicker();
        this.state.message = "고급 설정을 열었습니다.";
        return;
      }
      if (key.toLowerCase() === "b") {
        backFromTerminalSpace(this.state);
        return;
      }
      const result = await handleTerminalSettingsKey({ key, config: this.config, configDir: this.configDir, mode: this.state.settingsMode });
      this.config = result.config;
      this.state.message = result.message;
      return;
    }

    if (this.state.settingsPickerItemId) {
      await this.handleSettingsPickerKey(key);
      return;
    }
    if (key.toLowerCase() === "a") {
      this.state.settingsMode = "basic";
      this.closeSettingsPicker();
      this.state.message = "기본 설정으로 돌아왔습니다.";
      return;
    }
    if (key.toLowerCase() === "b" || key === "\u001b") {
      backFromTerminalSpace(this.state);
      return;
    }
    if (key === "\u001b[D") {
      this.moveSettingsSection(-1);
      return;
    }
    if (key === "\u001b[C") {
      this.moveSettingsSection(1);
      return;
    }
    if (key === "\u001b[A") {
      this.moveSettingsItem(-1);
      return;
    }
    if (key === "\u001b[B") {
      this.moveSettingsItem(1);
      return;
    }
    if (key === "\r") {
      await this.editSelectedAdvancedSetting();
    }
  }

  private moveSettingsSection(delta: number): void {
    const sections = buildAdvancedSettingsForm(this.config);
    if (sections.length === 0) {
      return;
    }
    this.state.settingsSectionIndex = wrapIndex(this.state.settingsSectionIndex + delta, sections.length);
    this.state.selectedSettingsItemIndex = 0;
    this.closeSettingsPicker();
  }

  private moveSettingsItem(delta: number): void {
    const section = this.currentAdvancedSettingsSection();
    if (!section || section.items.length === 0) {
      return;
    }
    this.state.selectedSettingsItemIndex = Math.max(0, Math.min(section.items.length - 1, this.state.selectedSettingsItemIndex + delta));
    this.closeSettingsPicker();
  }

  private currentAdvancedSettingsSection(): ReturnType<typeof buildAdvancedSettingsForm>[number] | null {
    const sections = buildAdvancedSettingsForm(this.config);
    return sections[Math.max(0, Math.min(sections.length - 1, this.state.settingsSectionIndex))] ?? null;
  }

  private selectedAdvancedSettingsItem(): AdvancedSettingsItem | null {
    const section = this.currentAdvancedSettingsSection();
    if (!section) {
      return null;
    }
    return section.items[Math.max(0, Math.min(section.items.length - 1, this.state.selectedSettingsItemIndex))] ?? null;
  }

  private async editSelectedAdvancedSetting(): Promise<void> {
    const item = this.selectedAdvancedSettingsItem();
    if (!item) {
      return;
    }
    if (item.id === "api-key") {
      const apiKey = await this.promptMaskedLine("OpenAI API key (empty to cancel): ");
      if (!apiKey) {
        this.state.message = "API 키 입력을 취소했습니다.";
        return;
      }
      await saveOpenAICompatibleApiKey(apiKey, this.configDir);
      this.state.message = "OpenAI 호환 API 키를 저장했습니다.";
      return;
    }
    if (item.id === "openai-base-url") {
      const baseUrl = await this.promptLine("OpenAI base URL (empty to cancel): ");
      if (!baseUrl) {
        this.state.message = "OpenAI URL 입력을 취소했습니다.";
        return;
      }
      this.config = { ...this.config, openAICompatible: { ...this.config.openAICompatible, baseUrl } };
      await saveConfig(this.config, this.configDir);
      this.state.message = `OpenAI URL: ${baseUrl}.`;
      return;
    }
    if (item.id === "temperature") {
      const input = await this.promptLine("Temperature 0-2 (empty to cancel): ");
      if (!input) {
        this.state.message = "온도 입력을 취소했습니다.";
        return;
      }
      const temperature = parseTemperatureInput(input);
      if (temperature === null) {
        this.state.message = "온도는 0부터 2 사이의 숫자로 입력하세요.";
        return;
      }
      this.config = { ...this.config, openAICompatible: { ...this.config.openAICompatible, temperature } };
      await saveConfig(this.config, this.configDir);
      this.state.message = `온도: ${temperature}.`;
      return;
    }
    if (item.id === "qa-japanese" || item.id === "qa-number" || item.id === "qa-length" || item.id === "qa-glossary") {
      this.config = toggleQaSetting(this.config, item.id);
      await saveConfig(this.config, this.configDir);
      this.state.message = `${item.label}: ${item.value === "켜짐" ? "꺼짐" : "켜짐"}.`;
      return;
    }
    if (item.id === "output-txt") {
      this.config = await toggleDefaultOutputFormat(this.config, "txt", this.configDir);
      this.state.message = `기본 결과물: ${this.config.outputFormats.join(", ")}.`;
      return;
    }
    if (item.id === "output-epub") {
      this.config = await toggleDefaultOutputFormat(this.config, "epub", this.configDir);
      this.state.message = `기본 결과물: ${this.config.outputFormats.join(", ")}.`;
      return;
    }
    if (item.id === "epub-afterword" || item.id === "epub-vertical-writing" || item.id === "epub-glossary-appendix") {
      this.config = toggleEpubSetting(this.config, item.id);
      await saveConfig(this.config, this.configDir);
      this.state.message = `${item.label}: ${item.value === "켜짐" ? "꺼짐" : "켜짐"}.`;
      return;
    }
    const options = advancedSettingsOptions(item);
    if (options.length > 0) {
      this.state.settingsPickerItemId = item.id;
      this.state.selectedSettingsOptionIndex = selectedAdvancedSettingsOptionIndex(item);
      return;
    }
  }

  private async handleSettingsPickerKey(key: string): Promise<void> {
    const item = this.selectedAdvancedSettingsItem();
    if (!item || this.state.settingsPickerItemId !== item.id) {
      this.closeSettingsPicker();
      return;
    }
    const options = advancedSettingsOptions(item);
    if (key === "\u001b" || key.toLowerCase() === "b") {
      this.closeSettingsPicker();
      return;
    }
    if (key === "\u001b[A") {
      this.state.selectedSettingsOptionIndex = Math.max(0, this.state.selectedSettingsOptionIndex - 1);
      return;
    }
    if (key === "\u001b[B") {
      this.state.selectedSettingsOptionIndex = Math.min(Math.max(0, options.length - 1), this.state.selectedSettingsOptionIndex + 1);
      return;
    }
    if (key === "\r") {
      const option = options[Math.max(0, Math.min(options.length - 1, this.state.selectedSettingsOptionIndex))];
      this.closeSettingsPicker();
      if (option) {
        await this.applyAdvancedSettingOption(item, option);
      }
    }
  }

  private closeSettingsPicker(): void {
    this.state.settingsPickerItemId = null;
    this.state.selectedSettingsOptionIndex = 0;
  }

  private async applyAdvancedSettingOption(item: AdvancedSettingsItem, option: AdvancedSettingsOption): Promise<void> {
    if (item.id === "default-backend") {
      if (!isSupportedBackend(option.value)) {
        return;
      }
      this.config = { ...this.config, defaultBackend: option.value };
      await saveConfig(this.config, this.configDir);
      this.state.message = `기본 번역 엔진: ${this.config.defaultBackend}.`;
      return;
    }
    if (item.id === "codex-command") {
      const command = option.custom ? await this.promptLine("Codex CLI command: ") : option.value;
      if (!command) {
        this.state.message = "Codex CLI 실행 명령 입력을 취소했습니다.";
        return;
      }
      this.config = { ...this.config, codexCli: { ...this.config.codexCli, command } };
      await saveConfig(this.config, this.configDir);
      this.state.message = `Codex CLI 실행: ${command}.`;
      return;
    }
    if (item.id === "openai-model") {
      const model = option.custom ? await this.promptLine("OpenAI model: ") : option.value;
      if (!model) {
        this.state.message = "OpenAI 모델 입력을 취소했습니다.";
        return;
      }
      this.config = await setOpenAICompatibleModel(this.config, model, this.configDir);
      this.state.message = `OpenAI 호환 모델: ${this.config.openAICompatible.model}.${await this.applyModelToOpenProject("openai-compatible", this.config.openAICompatible.model)}`;
      return;
    }
    if (item.id === "codex-model") {
      const model = option.custom ? await this.promptLine("Codex model: ") : option.value;
      if (!model) {
        this.state.message = "Codex 모델 입력을 취소했습니다.";
        return;
      }
      this.config = await setCodexCliModel(this.config, model, this.configDir);
      this.state.message = `Codex 모델: ${this.config.codexCli.model}.${await this.applyModelToOpenProject("codex-cli", this.config.codexCli.model)}`;
      return;
    }
    if (item.id === "openai-base-url") {
      const baseUrl = option.custom ? await this.promptLine("OpenAI base URL: ") : option.value;
      if (!baseUrl) {
        this.state.message = "OpenAI URL 입력을 취소했습니다.";
        return;
      }
      this.config = { ...this.config, openAICompatible: { ...this.config.openAICompatible, baseUrl } };
      await saveConfig(this.config, this.configDir);
      this.state.message = `OpenAI URL: ${baseUrl}.`;
      return;
    }
    if (item.id === "concurrency") {
      const concurrency = Number(option.value);
      this.config = { ...this.config, concurrency };
      await saveConfig(this.config, this.configDir);
      this.state.message = `동시 작업 수: ${concurrency}.`;
      return;
    }
    if (item.id === "temperature") {
      const temperature = Number(option.value);
      this.config = { ...this.config, openAICompatible: { ...this.config.openAICompatible, temperature } };
      await saveConfig(this.config, this.configDir);
      this.state.message = `온도: ${temperature}.`;
      return;
    }
    if (item.id === "reasoning-effort") {
      const reasoningEffort = normalizeReasoningEffort(option.value);
      if (reasoningEffort === false) {
        return;
      }
      this.config = {
        ...this.config,
        openAICompatible: {
          ...this.config.openAICompatible,
          reasoningEffort
        }
      };
      await saveConfig(this.config, this.configDir);
      this.state.message = `Reasoning: ${reasoningEffort}.`;
      return;
    }
    if (item.id === "glossary-strictness") {
      if (!isGlossaryStrictness(option.value)) {
        return;
      }
      this.config = { ...this.config, glossaryStrictness: option.value };
      await saveConfig(this.config, this.configDir);
      this.state.message = `용어 엄격도: ${this.config.glossaryStrictness}.`;
    }
  }

  private async applyModelToOpenProject(backend: string, model: string | undefined): Promise<string> {
    if (!this.state.projectDir || !model) {
      return "";
    }
    const metadata = await loadProjectMetadata(this.state.projectDir);
    if (metadata.options.backend !== backend) {
      return "";
    }
    metadata.options.model = model;
    metadata.updatedAt = nowIso();
    await saveProjectMetadata(metadata);
    return " 현재 프로젝트에도 적용했습니다.";
  }

  private async handleGlossaryKey(key: string): Promise<void> {
    if (!this.state.projectDir) {
      return;
    }
    const model = await this.loadCurrentProjectModel();
    if (key === "\r") {
      let target = suggestedGlossaryTarget(model, this.state.selectedTermIndex, this.state.glossaryFilter, this.state.deferredGlossaryEntryIds);
      if (!target) {
        target = await this.promptLine("번역어: ");
      }
      if (target) {
        this.state.message = await confirmSelectedGlossaryTerm(
          this.state.projectDir,
          model,
          this.state.selectedTermIndex,
          target,
          false,
          this.state.glossaryFilter,
          this.state.deferredGlossaryEntryIds
        );
      }
      return;
    }
    if (key.toLowerCase() === "e") {
      const target = await this.promptLine("번역어: ");
      if (target) {
        this.state.message = await confirmSelectedGlossaryTerm(
          this.state.projectDir,
          model,
          this.state.selectedTermIndex,
          target,
          false,
          this.state.glossaryFilter,
          this.state.deferredGlossaryEntryIds
        );
      }
      return;
    }
    if (key.toLowerCase() === "l") {
      let target = suggestedGlossaryTarget(model, this.state.selectedTermIndex, this.state.glossaryFilter, this.state.deferredGlossaryEntryIds);
      if (!target) {
        target = await this.promptLine("고정할 번역어: ");
      }
      if (target) {
        this.state.message = await confirmSelectedGlossaryTerm(
          this.state.projectDir,
          model,
          this.state.selectedTermIndex,
          target,
          true,
          this.state.glossaryFilter,
          this.state.deferredGlossaryEntryIds
        );
      }
      return;
    }
    if (key.toLowerCase() === "f") {
      const target = await this.promptLine("금지할 번역어: ");
      if (target) {
        this.state.message = await forbidSelectedGlossaryTarget(
          this.state.projectDir,
          model,
          this.state.selectedTermIndex,
          target,
          this.state.glossaryFilter,
          this.state.deferredGlossaryEntryIds
        );
      }
      return;
    }
    if (key.toLowerCase() === "s") {
      const result = deferSelectedGlossaryQueueItem(model, this.state.selectedTermIndex, this.state.glossaryFilter, this.state.deferredGlossaryEntryIds);
      this.state.deferredGlossaryEntryIds = result.deferredEntryIds;
      this.state.selectedTermIndex = 0;
      this.state.message = result.message;
      return;
    }
    if (key.toLowerCase() === "d") {
      const selected = selectedGlossaryQueueItem(model, this.state.selectedTermIndex, this.state.glossaryFilter, this.state.deferredGlossaryEntryIds);
      if (!selected) {
        this.state.message = "선택된 용어가 없습니다.";
        return;
      }
      const previousStatus = selected.entry.status;
      const previousLocked = selected.entry.locked;
      const selectedIndex = this.state.selectedTermIndex;
      const filter = this.state.glossaryFilter;
      const deferredEntryIds = [...this.state.deferredGlossaryEntryIds];
      const projectDir = this.state.projectDir;
      this.pendingConfirmation = {
        summary: `"${selected.entry.source}" 후보 용어 폐기`,
        onConfirm: async () => {
          this.state.message = await discardSelectedGlossaryTerm(
            projectDir,
            model,
            selectedIndex,
            filter,
            deferredEntryIds
          );
          this.lastUndo = createUndoAction({
            label: `${selected.entry.source} 용어 복원`,
            state: this.state,
            run: () => this.restoreGlossaryTerm(selected.entry.source, previousStatus, previousLocked)
          });
          this.state.selectedTermIndex = 0;
        },
        onCancel: () => {
          this.state.message = "폐기를 취소했습니다.";
        }
      };
      return;
    }
    if (key.toLowerCase() === "a") {
      this.state.glossaryFilter = "all";
      this.state.deferredGlossaryEntryIds = [];
      this.state.selectedTermIndex = 0;
      this.state.message = "용어 필터와 나중에 볼 목록을 초기화했습니다.";
    }
  }

  private async handleReviewKey(key: string): Promise<void> {
    if (!this.state.projectDir) {
      return;
    }
    const model = await this.loadCurrentProjectModel();
    if (key === "\r" || key.toLowerCase() === "o") {
      this.state.message = await openSelectedIssueTranslation(this.state.projectDir, model, this.state.selectedIssueIndex);
      return;
    }
    if (key.toLowerCase() === "m") {
      const issue = model.reviewDesk.openIssues[this.state.selectedIssueIndex] ?? model.reviewDesk.openIssues[0];
      if (!issue) {
        this.state.message = "선택된 검수 항목이 없습니다.";
        return;
      }
      const selectedIssueIndex = this.state.selectedIssueIndex;
      const projectDir = this.state.projectDir;
      this.pendingConfirmation = {
        summary: `${issue.episodeId} ${issue.type} 검수 항목 숨김`,
        onConfirm: async () => {
          this.state.message = await markSelectedIssueIgnored(projectDir, model, selectedIssueIndex);
          this.lastUndo = createUndoAction({
            label: `${issue.episodeId} ${issue.type} 검수 항목 복원`,
            state: this.state,
            run: () => this.restoreIgnoredIssue(issue.id)
          });
        },
        onCancel: () => {
          this.state.message = "검수 항목 숨김을 취소했습니다.";
        }
      };
      return;
    }
    if (key.toLowerCase() === "t") {
      await this.confirmReviewRetranslation(model, "selected");
      return;
    }
    if (key.toLowerCase() === "a") {
      await this.confirmReviewRetranslation(model, "all-open");
      return;
    }
    if (key.toLowerCase() === "f") {
      await this.confirmReviewRetranslation(model, "same-type");
      return;
    }
    if (key.toLowerCase() === "c") {
      this.startQaRecheckTask(this.state.projectDir);
      return;
    }
    if (key.toLowerCase() === "g") {
      this.state.glossaryFilter = "all";
      this.state.message = relatedTermsForIssue(model, this.state.selectedIssueIndex);
      this.state.space = "glossary-lab";
    }
  }

  private async handleExportKey(key: string): Promise<void> {
    if (!this.state.projectDir) {
      return;
    }
    if (key === "\r") {
      this.confirmExportGeneration();
      return;
    }
    if (key === "1") {
      await toggleOutputFormat(this.state.projectDir, "txt");
      this.state.message = "TXT 결과물 설정을 변경했습니다.";
      return;
    }
    if (key === "2") {
      await toggleOutputFormat(this.state.projectDir, "epub");
      this.state.message = "EPUB 결과물 설정을 변경했습니다.";
      return;
    }
    if (key.toLowerCase() === "a") {
      const metadata = await toggleGlossaryAppendix(this.state.projectDir);
      this.state.message = `용어집 부록을 ${metadata.outputOptions.includeGlossaryAppendix ? "켰습니다" : "껐습니다"}.`;
      return;
    }
    if (key.toLowerCase() === "w") {
      const metadata = await toggleAfterword(this.state.projectDir);
      this.state.message = `후기 포함을 ${metadata.outputOptions.includeAfterword ? "켰습니다" : "껐습니다"}.`;
      return;
    }
    if (key.toLowerCase() === "v") {
      const metadata = await toggleVerticalWriting(this.state.projectDir);
      this.state.message = `세로쓰기를 ${metadata.outputOptions.verticalWriting ? "켰습니다" : "껐습니다"}.`;
      return;
    }
    if (key.toLowerCase() === "c") {
      const path = await this.promptLine("Cover image path (empty to clear): ");
      const metadata = path ? await setCoverImagePath(this.state.projectDir, path) : await clearCoverImagePath(this.state.projectDir);
      this.state.message = metadata.outputOptions.coverImagePath ? `표지 이미지를 설정했습니다: ${metadata.outputOptions.coverImagePath}` : "표지 이미지를 비웠습니다.";
      return;
    }
    if (key.toLowerCase() === "o") {
      this.state.message = await openOutputFolder(this.state.projectDir);
      return;
    }
    if (key.toLowerCase() === "p") {
      this.state.message = formatExportPreview(await this.loadCurrentProjectModel());
      return;
    }
  }

  private async handleFailureRecoveryKey(key: string): Promise<void> {
    if (!this.state.projectDir) {
      return;
    }
    if (key.toLowerCase() === "r") {
      await this.startTranslationSession("retry-failed");
      return;
    }
    if (key.toLowerCase() === "s" || key.toLowerCase() === "e") {
      const projectDir = this.state.projectDir;
      this.pendingConfirmation = {
        summary: "실패 화를 건너뛰고 완료분 결과물 생성",
        onConfirm: async () => {
          this.startSkipFailedExportTask(projectDir);
        },
        onCancel: () => {
          this.state.message = "건너뛰고 생성 작업을 취소했습니다.";
        }
      };
      return;
    }
    if (key.toLowerCase() === "l") {
      this.state.message = `에러 로그: ${errorLogPath(this.state.projectDir)}`;
    }
  }

  private async handleEnter(): Promise<void> {
    if (this.state.space === "bookshelf") {
      await this.openSelectedBookshelfProject("studio");
      return;
    }
    if (this.state.space === "export-room" && this.state.projectDir) {
      this.confirmExportGeneration();
    }
  }

  private async applyPaletteCommand(commandId: string): Promise<void> {
    this.state.paletteQuery = "";
    const result = await executePaletteCommand({
      commandId,
      config: this.config,
      configDir: this.configDir,
      projectDir: this.state.projectDir,
      previousSpace: this.state.previousSpace,
      selectedIssueIndex: this.state.selectedIssueIndex,
      currentEpisodeTitle: this.currentSessionSnapshot()?.currentEpisodeTitle ?? null,
      loadProjectModel: () => this.loadCurrentProjectModel()
    });
    if (result.config) {
      this.config = result.config;
    }
    if (result.space) {
      this.state.space = result.space;
    }
    if (result.searchQuery !== undefined) {
      this.state.searchQuery = result.searchQuery;
    }
    if (result.selectedProjectIndex !== undefined) {
      this.state.selectedProjectIndex = result.selectedProjectIndex;
    }
    if (result.glossaryFilter) {
      this.state.glossaryFilter = result.glossaryFilter;
      this.state.selectedTermIndex = 0;
    }
    if (result.settingsMode) {
      this.state.settingsMode = result.settingsMode;
    } else if (result.space === "settings") {
      this.state.settingsMode = "basic";
    }
    if (result.message !== undefined) {
      this.state.message = result.message;
    }
    if (result.effect?.type === "import-source") {
      await this.importSourceDropIn();
    }
    if (result.effect?.type === "start-translation") {
      await this.startTranslationSession(result.effect.mode);
    }
    if (result.effect?.type === "review-retranslate-issue" && this.state.projectDir) {
      const metadata = await loadProjectMetadata(this.state.projectDir);
      const adapter = createTranslatorAdapter(metadata.options.backend ?? this.config.defaultBackend, this.config, { credentialConfigDir: this.configDir });
      const model = await this.loadCurrentProjectModel();
      this.startReviewRetranslation(this.state.projectDir, model, this.state.selectedIssueIndex, adapter, result.effect.scope);
    }
    if (result.effect?.type === "skip-failed-export" && this.state.projectDir) {
      this.startSkipFailedExportTask(this.state.projectDir);
    }
    if (result.effect?.type === "rerun-qa" && this.state.projectDir) {
      this.startQaRecheckTask(this.state.projectDir);
    }
    if (result.effect?.type === "export-all" && this.state.projectDir) {
      this.startExportTask(this.state.projectDir, "all");
    }
  }

  private async applyStudioKeyIntent(intent: StudioKeyIntent): Promise<void> {
    if (intent.type === "translate") {
      await this.startTranslationSession(intent.mode);
      return;
    }
    if (intent.glossaryFilter) {
      this.state.glossaryFilter = intent.glossaryFilter;
      this.state.selectedTermIndex = 0;
    }
    this.state.space = intent.space;
  }

  private async openSelectedBookshelfProject(space: StudioSpace): Promise<void> {
    const project = selectedBookshelfProject(await loadBookshelfModel(this.projectRoot), this.state.selectedProjectIndex);
    if (!project) {
      this.state.message = "열 프로젝트가 없습니다. [N]으로 원문을 가져오세요.";
      return;
    }
    this.state.projectDir = project.projectDir;
    this.state.space = space;
  }

  private async openSelectedBookshelfReview(): Promise<void> {
    const project = selectedBookshelfProject(await loadBookshelfModel(this.projectRoot), this.state.selectedProjectIndex);
    if (!project) {
      this.state.message = "검수할 프로젝트가 없습니다. [N]으로 원문을 가져오세요.";
      return;
    }
    this.state.projectDir = project.projectDir;
    const model = await this.loadCurrentProjectModel();
    this.state.space = model.failureRecovery.failedCount > 0 ? "failure-recovery" : "review-desk";
  }

  private async importSourceDropIn(): Promise<void> {
    const result = await runImportDropInFlow({
      config: this.config,
      configDir: this.configDir,
      projectRoot: this.projectRoot,
      input: this.input,
      output: this.output
    });
    this.config = result.config;
    this.state.message = result.message;
    if (result.projectDir && result.targetSpace) {
      this.state.projectDir = result.projectDir;
      this.state.selectedProjectIndex = 0;
      this.state.space = result.targetSpace;
    }
  }

  private async promptLine(prompt: string): Promise<string> {
    this.output.write(`\x1b[?25h\n${prompt}`);
    this.input.setRawMode(true);
    return new Promise((resolve) => {
      let value = "";
      const cleanup = () => {
        this.input.off("data", onData);
        this.input.setRawMode(true);
        this.output.write("\x1b[?25l");
      };
      const finish = () => {
        this.output.write("\n");
        cleanup();
        resolve(value.trim());
      };
      const onData = (chunk: Buffer | string) => {
        for (const char of Array.from(String(chunk))) {
          if (char === "\u0003" || char === "\u001b") {
            value = "";
            finish();
            return;
          }
          if (char === "\r" || char === "\n") {
            finish();
            return;
          }
          if (char === "\u007f") {
            if (value.length > 0) {
              value = Array.from(value).slice(0, -1).join("");
              this.output.write("\b \b");
            }
            continue;
          }
          if (char >= " ") {
            value += char;
            this.output.write(char);
          }
        }
      };
      this.input.on("data", onData);
    });
  }

  private async promptMaskedLine(prompt: string): Promise<string> {
    this.output.write(`\x1b[?25h\n${prompt}`);
    this.input.setRawMode(true);
    return new Promise((resolve) => {
      let value = "";
      const cleanup = () => {
        this.input.off("data", onData);
        this.input.setRawMode(true);
        this.output.write("\x1b[?25l");
      };
      const finish = () => {
        this.output.write("\n");
        cleanup();
        resolve(value.trim());
      };
      const onData = (chunk: Buffer | string) => {
        for (const char of Array.from(String(chunk))) {
          if (char === "\u0003" || char === "\u001b") {
            value = "";
            finish();
            return;
          }
          if (char === "\r" || char === "\n") {
            finish();
            return;
          }
          if (char === "\u007f") {
            if (value.length > 0) {
              value = Array.from(value).slice(0, -1).join("");
              this.output.write("\b \b");
            }
            continue;
          }
          if (char >= " ") {
            value += char;
            this.output.write("*");
          }
        }
      };
      this.input.on("data", onData);
    });
  }

  private async handleConfirmationKey(key: string): Promise<boolean> {
    const pending = this.pendingConfirmation;
    if (!pending) {
      return true;
    }
    if (key.toLowerCase() === "y") {
      this.pendingConfirmation = null;
      this.state.message = null;
      const result = await pending.onConfirm();
      return result !== false;
    }
    if (key.toLowerCase() === "n" || key === "\u001b" || key === "\u0003") {
      this.pendingConfirmation = null;
      pending.onCancel?.();
      return true;
    }
    this.state.message = "[Y]로 진행하거나 [N/Esc]로 취소하세요.";
    return true;
  }

  private requestQuitConfirmationIfActive(): boolean {
    const snapshot = this.currentSessionSnapshot();
    const runningTask = isTaskRunning(this.activeTask);
    if ((!snapshot || (snapshot.status !== "running" && snapshot.status !== "paused")) && !runningTask) {
      return false;
    }
    const isReviewRetranslation = this.isReviewRetranslationRunning();
    this.pendingConfirmation = {
      summary: runningTask
        ? `"${this.activeTask?.title ?? "작업"}"이 진행 중인 상태에서 종료`
        : isReviewRetranslation
          ? "검수 재번역이 진행 중인 상태에서 종료"
          : `번역 세션(${snapshot?.status ?? "running"})을 중단하고 종료`,
      onConfirm: async () => {
        if (!runningTask && !isReviewRetranslation) {
          this.translationSession?.cancel();
        } else if (isReviewRetranslation) {
          this.cancelReviewRetranslation();
        }
        return false;
      },
      onCancel: () => {
        this.state.message = "종료를 취소했습니다.";
      }
    };
    return true;
  }

  private confirmExportGeneration(): void {
    const projectDir = this.state.projectDir;
    if (!projectDir) {
      this.state.message = "열린 프로젝트가 없습니다.";
      return;
    }
    this.pendingConfirmation = {
      summary: "설정된 결과물 생성",
      onConfirm: async () => {
        this.startExportTask(projectDir, "configured");
      },
      onCancel: () => {
        this.state.message = "결과물 생성을 취소했습니다.";
      }
    };
  }

  private startExportTask(projectDir: string, mode: "configured" | "all"): void {
    this.startBackgroundTask({
      title: mode === "all" ? "TXT/EPUB 결과물 생성" : "결과물 생성",
      detail: "번역문과 용어집을 묶어 결과물을 만드는 중입니다.",
      run: () => mode === "all" ? generateAllExports(projectDir) : generateConfiguredExports(projectDir)
    });
  }

  private startSkipFailedExportTask(projectDir: string): void {
    this.startBackgroundTask({
      title: "실패 화 건너뛰고 결과물 생성",
      detail: "실패한 화를 제외하고 완료된 번역만 결과물로 만드는 중입니다.",
      run: () => skipFailedAndExport(projectDir)
    });
  }

  private startQaRecheckTask(projectDir: string): void {
    this.startBackgroundTask({
      title: "검수 재검사",
      detail: "수정된 번역문을 다시 검사하는 중입니다.",
      run: async () => {
        const message = await recheckReviewDeskQA(projectDir, (progress) => {
          this.updateActiveTaskDetail(`검사 중 ${progress.completed}/${progress.total}화 · ${progress.episodeTitle}`);
        }, this.config.qa);
        this.state.selectedIssueIndex = 0;
        return message;
      }
    });
  }

  private startBackgroundTask(options: { title: string; detail: string; run: () => Promise<string> }): void {
    if (isTaskRunning(this.activeTask)) {
      this.state.space = "studio";
      this.state.message = "다른 작업이 진행 중입니다. 끝난 뒤 다시 시도하세요.";
      return;
    }
    const snapshot = this.currentSessionSnapshot();
    if (snapshot?.status === "running" || snapshot?.status === "paused") {
      this.state.space = "studio";
      this.state.message = "번역 세션이 진행 중입니다. 끝난 뒤 다시 시도하세요.";
      return;
    }
    const task = createRunningTask(options.title, options.detail);
    this.activeTask = task;
    this.state.space = "studio";
    this.state.message = options.detail;
    void options.run()
      .then((message) => {
        this.activeTask = completeTask(task, message);
        this.state.message = message;
        void this.render();
      })
      .catch((error: unknown) => {
        const failed = failTask(task, error);
        this.activeTask = failed;
        this.state.message = failed.detail;
        void this.render();
      });
  }

  private updateActiveTaskDetail(detail: string): void {
    if (!this.activeTask || this.activeTask.status !== "running") {
      return;
    }
    this.activeTask = { ...this.activeTask, detail, updatedAt: nowIso() };
  }

  private async undoLastAction(): Promise<void> {
    const undo = scopedUndoAction(this.lastUndo, this.state);
    if (!undo) {
      this.lastUndo = null;
      this.state.message = "되돌릴 작업이 없습니다.";
      return;
    }
    this.lastUndo = null;
    this.state.message = await undo.run();
  }

  private async restoreGlossaryTerm(source: string, status: Awaited<ReturnType<typeof loadGlossary>>["entries"][number]["status"], locked: boolean): Promise<string> {
    if (!this.state.projectDir) {
      return "열린 프로젝트가 없습니다.";
    }
    const glossary = await loadGlossary(this.state.projectDir);
    const entry = glossary.entries.find((item) => item.source === source);
    if (!entry) {
      return `용어를 찾을 수 없습니다: ${source}`;
    }
    entry.status = status;
    entry.locked = locked;
    entry.updatedAt = nowIso();
    await saveGlossary(this.state.projectDir, { ...glossary, updatedAt: nowIso() });
    return `용어를 복원했습니다: ${source}`;
  }

  private async restoreIgnoredIssue(issueId: string): Promise<string> {
    if (!this.state.projectDir) {
      return "열린 프로젝트가 없습니다.";
    }
    const updated = await updateQAIssue(this.state.projectDir, issueId, { resolved: false });
    return updated ? `검수 항목을 복원했습니다: ${updated.episodeId} ${updated.type}` : "검수 항목을 찾지 못했습니다.";
  }

  private viewport(): Viewport {
    return {
      width: this.output.columns,
      height: this.output.rows
    };
  }

  private async moveSelection(delta: number): Promise<void> {
    const maxIndex = await this.currentSelectionMaxIndex();
    moveTerminalSelection(this.state, delta, maxIndex);
  }

  private async currentSelectionMaxIndex(): Promise<number> {
    if (this.state.space === "bookshelf") {
      return Math.max(0, (await loadBookshelfModel(this.projectRoot)).recentProjects.length - 1);
    }
    if (this.state.space === "glossary-lab" && this.state.projectDir) {
      const model = await this.loadCurrentProjectModel();
      return Math.max(0, buildGlossaryQueue(model, this.state.glossaryFilter, this.state.deferredGlossaryEntryIds).length - 1);
    }
    if (this.state.space === "review-desk" && this.state.projectDir) {
      const model = await this.loadCurrentProjectModel();
      return Math.max(0, model.reviewDesk.openIssues.length - 1);
    }
    return 0;
  }

  private async startTranslationSession(mode: "resume" | "retry-failed"): Promise<void> {
    if (!this.state.projectDir) {
      return;
    }
    if (isTaskRunning(this.activeTask)) {
      this.state.space = "studio";
      this.state.message = "다른 작업이 진행 중입니다. 끝난 뒤 다시 시도하세요.";
      return;
    }
    if (this.isReviewRetranslationRunning()) {
      this.state.space = "studio";
      this.state.message = "검수 재번역이 진행 중입니다. 끝난 뒤 다시 시도하세요.";
      return;
    }
    if (this.translationSession) {
      const snapshot = this.translationSession.snapshot();
      if (snapshot.status === "running" || snapshot.status === "paused") {
        this.state.message = `번역 세션이 이미 ${snapshot.status} 상태입니다.`;
        return;
      }
    }
    this.reviewRetranslationSnapshot = null;
    const metadata = await loadProjectMetadata(this.state.projectDir);
    this.activeTask = null;
    this.state.space = "studio";
    const adapter = createTranslatorAdapter(metadata.options.backend ?? this.config.defaultBackend, this.config, { credentialConfigDir: this.configDir });
    const session = await TranslationSession.create({
      projectDir: this.state.projectDir,
      adapter,
      mode,
      qaOptions: this.config.qa
    });
    this.translationSession = session;
    session
      .start()
      .then((snapshot) => {
        this.state.message = snapshot.message;
        void this.render();
      })
      .catch((error: unknown) => {
        this.state.message = (error as Error).message;
        void this.render();
      });
    this.state.message = "번역을 시작했습니다.";
  }

  private async confirmReviewRetranslation(model: ProjectUiModel, scope: ReviewRetranslationScope): Promise<void> {
    if (!this.state.projectDir) {
      return;
    }
    const queue = buildReviewRetranslationQueue(model, this.state.selectedIssueIndex, scope);
    if (queue.length === 0) {
      this.state.message = "재번역할 검수 화가 없습니다.";
      return;
    }
    const metadata = await loadProjectMetadata(this.state.projectDir);
    const adapter = createTranslatorAdapter(metadata.options.backend ?? this.config.defaultBackend, this.config, { credentialConfigDir: this.configDir });
    const selectedIssue = model.reviewDesk.openIssues[this.state.selectedIssueIndex] ?? model.reviewDesk.openIssues[0];
    const selectedIssueIndex = this.state.selectedIssueIndex;
    const projectDir = this.state.projectDir;
    this.pendingConfirmation = {
      summary: reviewRetranslationSummary(scope, queue.length, selectedIssue?.type),
      onConfirm: async () => {
        this.startReviewRetranslation(projectDir, model, selectedIssueIndex, adapter, scope);
      },
      onCancel: () => {
        this.state.message = "재번역을 취소했습니다.";
      }
    };
  }

  private startReviewRetranslation(projectDir: string, model: ProjectUiModel, selectedIssueIndex: number, adapter: ReturnType<typeof createTranslatorAdapter>, scope: ReviewRetranslationScope): void {
    const queue = buildReviewRetranslationQueue(model, selectedIssueIndex, scope);
    if (queue.length === 0) {
      this.state.message = "재번역할 검수 화가 없습니다.";
      return;
    }
    if (this.translationSession) {
      const snapshot = this.translationSession.snapshot();
      if (snapshot.status === "running" || snapshot.status === "paused") {
        this.state.space = "studio";
        this.state.message = `번역 세션이 이미 ${snapshot.status} 상태입니다.`;
        return;
      }
    }
    if (isTaskRunning(this.activeTask)) {
      this.state.space = "studio";
      this.state.message = "다른 작업이 진행 중입니다. 끝난 뒤 다시 시도하세요.";
      return;
    }
    if (this.isReviewRetranslationRunning()) {
      this.state.space = "studio";
      const added = this.reviewRetranslationTask?.enqueue(queue) ?? 0;
      this.reviewRetranslationSnapshot = this.reviewRetranslationTask?.snapshot() ?? this.reviewRetranslationSnapshot;
      this.state.message = added > 0 ? `${added}개 화를 검수 재번역 큐에 추가했습니다.` : "이미 재번역 큐에 있는 화입니다.";
      return;
    }
    const issue = model.reviewDesk.openIssues[selectedIssueIndex] ?? model.reviewDesk.openIssues[0];
    if (!issue) {
      this.state.message = "선택된 검수 항목이 없습니다.";
      return;
    }
    this.state.space = "studio";
    this.state.selectedIssueIndex = 0;
    this.state.message = "검수 재번역 큐를 시작했습니다.";
    const task = createReviewRetranslationTask({
      projectDir,
      model,
      selectedIssueIndex,
      adapter,
      scope,
      qaOptions: this.config.qa,
      onSnapshot: (snapshot) => {
        this.reviewRetranslationSnapshot = snapshot;
        void this.render();
      }
    });
    if (!task) {
      this.state.message = "선택된 검수 항목이 없습니다.";
      return;
    }
    this.reviewRetranslationSnapshot = task.initialSnapshot;
    this.reviewRetranslationTask = task;
    void task.done
      .then(({ snapshot, message }) => {
        if (this.reviewRetranslationTask !== task) {
          return;
        }
        this.reviewRetranslationSnapshot = snapshot;
        this.state.message = message;
        this.reviewRetranslationTask = null;
        void this.render();
      })
      .catch((error: unknown) => {
        if (this.reviewRetranslationTask !== task) {
          return;
        }
        this.reviewRetranslationSnapshot = failedReviewRetranslationSnapshot(error, task.initialSnapshot.currentEpisodeTitle ?? issue.episodeId);
        this.state.message = (error as Error).message;
        this.reviewRetranslationTask = null;
        void this.render();
      });
  }

  private cancelReviewRetranslation(): void {
    if (!this.isReviewRetranslationRunning()) {
      return;
    }
    this.reviewRetranslationTask?.controller.abort();
    this.state.message = "검수 재번역 중단을 요청했습니다.";
  }

  private toggleTranslationPause(): void {
    if (this.isReviewRetranslationRunning()) {
      this.state.message = "검수 재번역은 일시정지하지 않습니다. 종료 확인에서 중단할 수 있습니다.";
      return;
    }
    if (!this.translationSession) {
      this.state.message = "진행 중인 번역 세션이 없습니다. [T]로 시작하세요.";
      return;
    }
    const snapshot = this.translationSession.snapshot();
    if (snapshot.status === "running") {
      this.translationSession.pause();
      this.state.message = "현재 화가 끝나면 번역을 일시정지합니다.";
      return;
    }
    if (snapshot.status === "paused") {
      this.translationSession.resume();
      this.state.message = "번역을 다시 시작했습니다.";
      return;
    }
    this.state.message = `진행 중인 번역 세션이 없습니다(${snapshot.status}).`;
  }

  private async loadCurrentProjectModel(): Promise<ProjectUiModel> {
    if (!this.state.projectDir) {
      throw new Error("열린 프로젝트가 없습니다.");
    }
    const model = await loadProjectUiModel(this.state.projectDir);
    const pendingReviewEpisodeIds = this.reviewRetranslationTask?.queuedEpisodeIds() ?? [];
    if (!this.isReviewRetranslationRunning() || pendingReviewEpisodeIds.length === 0) {
      return model;
    }
    return {
      ...model,
      reviewDesk: hideReviewDeskEpisodes(model.reviewDesk, pendingReviewEpisodeIds)
    };
  }

  private currentSessionSnapshot(): TranslationSessionSnapshot | null {
    if (this.reviewRetranslationSnapshot) {
      return this.reviewRetranslationSnapshot;
    }
    return this.translationSession?.snapshot() ?? null;
  }

  private shouldAutoRender(): boolean {
    const taskRunning = isTaskRunning(this.activeTask);
    const snapshot = this.currentSessionSnapshot();
    return taskRunning || Boolean(snapshot && (snapshot.status === "running" || snapshot.status === "paused") && (this.state.space === "studio" || this.state.space === "bookshelf"));
  }

  private isReviewRetranslationRunning(): boolean {
    return this.reviewRetranslationTask?.snapshot().status === "running";
  }

  private filteredProjects(bookshelf: BookshelfModel): BookshelfModel["allProjects"] {
    const normalized = this.state.searchQuery.trim().toLowerCase();
    if (!normalized) {
      return bookshelf.allProjects;
    }
    return bookshelf.allProjects.filter((project) => `${project.title} ${project.statusText} ${project.shelfStatusLabel} ${project.projectDir}`.toLowerCase().includes(normalized));
  }
}

function reviewRetranslationSummary(scope: ReviewRetranslationScope, queueLength: number, issueType?: string): string {
  if (scope === "all-open") {
    return `열린 검수 화 ${queueLength}개 재번역`;
  }
  if (scope === "same-type") {
    return `${issueType ?? "같은 유형"} 검수 화 ${queueLength}개 재번역`;
  }
  return `선택한 검수 화 ${queueLength}개 재번역`;
}

function wrapIndex(index: number, length: number): number {
  return ((index % length) + length) % length;
}

function parseTemperatureInput(value: string): number | null {
  const temperature = Number(value.trim());
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    return null;
  }
  return temperature;
}

function normalizeReasoningEffort(value: string): NovelTransConfig["openAICompatible"]["reasoningEffort"] | false {
  const normalized = value.trim().toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "xhigh") {
    return normalized;
  }
  return false;
}

function isSupportedBackend(value: string): value is NovelTransConfig["defaultBackend"] {
  return value === "dry-run" || value === "openai-compatible" || value === "codex-cli";
}

function isGlossaryStrictness(value: string): value is NovelTransConfig["glossaryStrictness"] {
  return value === "low" || value === "medium" || value === "high" || value === "strict";
}

function toggleQaSetting(config: NovelTransConfig, itemId: AdvancedSettingsItem["id"]): NovelTransConfig {
  if (itemId === "qa-japanese") {
    return { ...config, qa: { ...config.qa, japaneseRemaining: !config.qa.japaneseRemaining } };
  }
  if (itemId === "qa-number") {
    return { ...config, qa: { ...config.qa, numberMismatch: !config.qa.numberMismatch } };
  }
  if (itemId === "qa-length") {
    return { ...config, qa: { ...config.qa, lengthRatio: !config.qa.lengthRatio } };
  }
  if (itemId === "qa-glossary") {
    return { ...config, qa: { ...config.qa, glossary: !config.qa.glossary } };
  }
  return config;
}

function toggleEpubSetting(config: NovelTransConfig, itemId: AdvancedSettingsItem["id"]): NovelTransConfig {
  if (itemId === "epub-afterword") {
    return { ...config, epub: { ...config.epub, includeAfterword: !config.epub.includeAfterword } };
  }
  if (itemId === "epub-vertical-writing") {
    return { ...config, epub: { ...config.epub, verticalWriting: !config.epub.verticalWriting } };
  }
  if (itemId === "epub-glossary-appendix") {
    return { ...config, epub: { ...config.epub, includeGlossaryAppendix: !config.epub.includeGlossaryAppendix } };
  }
  return config;
}
