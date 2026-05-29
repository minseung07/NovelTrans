import type { TranslationStyle } from "../domain/config.js";
import type { ProjectMetadata } from "../domain/project.js";
import type { CreateProjectResult } from "../engine/projectWorkflow.js";

export type WebImportSite = "kakuyomu" | "syosetu";

export type WebEpisodeRef = {
  no: number;
  title: string;
  url: string;
  remoteId: string;
};

export type WebWorkIndex = {
  site: WebImportSite;
  title: string;
  author: string | null;
  sourceUrl: string;
  episodes: WebEpisodeRef[];
};

export type WebEpisode = WebEpisodeRef & {
  bodyText: string;
  foreword?: string;
  afterword?: string;
};

export type EpisodeRangeSelection = {
  start: number;
  end: number;
  label: string;
};

export type WebImportPreview = {
  work: WebWorkIndex;
  selection: EpisodeRangeSelection;
  selectedEpisodes: WebEpisodeRef[];
};

export type WebImportProjectOptions = {
  projectRoot: string;
  name?: string;
  backend: string;
  model?: string;
  translationStyle?: TranslationStyle;
  concurrency: number;
  glossaryStrictness: "low" | "medium" | "high" | "strict";
  qaOptions?: import("../domain/config.js").NovelTransConfig["qa"];
  outputOptions?: Partial<ProjectMetadata["outputOptions"]>;
  userConfirmedRights?: boolean;
};

export type WebImportResult = {
  created: CreateProjectResult;
  work: WebWorkIndex;
  episodes: WebEpisode[];
};

export type WebImportAdapter = {
  readonly site: WebImportSite;
  detect(url: URL): boolean;
  loadWork(url: URL): Promise<WebWorkIndex>;
  loadEpisode(ref: WebEpisodeRef): Promise<WebEpisode>;
};
