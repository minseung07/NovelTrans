import type { NovelTransConfig } from "../../domain/config.js";
import { createProjectFromText, createProjectFromTxt } from "../../engine/projectWorkflow.js";
import { WebImportService } from "../../webImport/webImportService.js";

type UiWebImportService = Pick<WebImportService, "loadWork" | "buildPreview" | "importProject">;

export type UiWebImportOptions = {
  episodes?: string;
};

type ImportSourceForUiOptions = {
  webImportService?: UiWebImportService;
  webImport?: UiWebImportOptions;
  userConfirmedRights?: boolean;
};

export const isWebImportSource = (value: string): boolean => /^https?:\/\//i.test(value.trim());

export const looksLikeTextPath = (value: string): boolean => /\.txt$/i.test(value.trim()) || /^[./~]/.test(value.trim());

export function importBaseOptions(config: NovelTransConfig, projectRoot: string) {
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
    }
  };
}

export async function importSourceForUi(sourceValue: string, config: NovelTransConfig, projectRoot: string, options: ImportSourceForUiOptions = {}): Promise<string> {
  const source = sourceValue.trim();
  if (!source) {
    return "가져올 원문이 없습니다.";
  }
  const base = importBaseOptions(config, projectRoot);
  if (isWebImportSource(source)) {
    const request = parseWebImportRequest(source, options.webImport);
    if (!request.episodes) {
      return "웹 가져오기는 화수 범위가 필요합니다. 화수 옵션에서 1-10, latest-5, all 중 하나를 입력하세요.";
    }
    const service = options.webImportService ?? new WebImportService();
    const work = await service.loadWork(request.url);
    const preview = service.buildPreview(work, request.episodes);
    const imported = await service.importProject(preview, { ...base, userConfirmedRights: Boolean(options.userConfirmedRights) });
    return `웹 프로젝트 생성: ${imported.created.metadata.name} (${imported.created.analysis.episodeCount}화)`;
  }

  const created = looksLikeTextPath(source)
    ? await createProjectFromTxt({ ...base, sourcePath: source })
    : await createProjectFromText({ ...base, sourceText: source, sourceLabel: "inline://noveltrans" });

  return `프로젝트 생성: ${created.metadata.name} (${created.analysis.episodeCount}화)`;
}

type WebImportRequest = {
  url: string;
  episodes?: string;
};

export function parseWebImportRequest(source: string, options: UiWebImportOptions = {}): WebImportRequest {
  const [url = source, ...tokens] = splitImportArgs(source);
  let episodes: string | undefined;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token === "--episodes" || token === "episodes") {
      episodes = tokens[index + 1];
      index += 1;
    } else if (token.startsWith("--episodes=")) {
      episodes = token.slice("--episodes=".length);
    } else if (token.startsWith("episodes=")) {
      episodes = token.slice("episodes=".length);
    }
  }

  return {
    url,
    episodes: options.episodes?.trim() || episodes
  };
}

function splitImportArgs(source: string): string[] {
  return (source.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((token) => token.replace(/^["']|["']$/g, ""));
}
