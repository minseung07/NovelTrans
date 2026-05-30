import { createProjectFromText } from "../engine/projectWorkflow.js";
import { listEpisodes, saveEpisodes } from "../storage/projectStore.js";
import { hashText } from "../utils/hash.js";
import { KakuyomuAdapter } from "./adapters/kakuyomuAdapter.js";
import { SyosetuAdapter } from "./adapters/syosetuAdapter.js";
import { parseEpisodeRange, selectEpisodeRange } from "./episodeRange.js";
import { WebHttpClient, type WebHttpClientOptions } from "./httpClient.js";
import { detectWebImportUrl, isAllowedWebImportFetchUrl } from "./urlDetector.js";
import type {
  WebEpisode,
  WebEpisodeRef,
  WebImportAdapter,
  WebImportPreview,
  WebImportProjectOptions,
  WebImportResult,
  WebWorkIndex
} from "./types.js";

type WebImportServiceOptions = WebHttpClientOptions & {
  adapters?: WebImportAdapter[];
};

type WebImportProgressEvent =
  | { phase: "start"; completed: number; total: number }
  | { phase: "episode-start"; completed: number; total: number; episode: WebEpisodeRef }
  | { phase: "episode-complete"; completed: number; total: number; episode: WebEpisode }
  | { phase: "compose"; completed: number; total: number }
  | { phase: "create-project"; completed: number; total: number }
  | { phase: "metadata"; completed: number; total: number };

type WebImportProgressHandler = (event: WebImportProgressEvent) => void;

export class WebImportService {
  private readonly adapters: WebImportAdapter[];

  constructor(options: WebImportServiceOptions = {}) {
    const http = new WebHttpClient({ ...options, isAllowedUrl: options.isAllowedUrl ?? isAllowedWebImportFetchUrl });
    this.adapters = options.adapters ?? [new KakuyomuAdapter(http), new SyosetuAdapter(http)];
  }

  async loadWork(rawUrl: string): Promise<WebWorkIndex> {
    const detected = detectWebImportUrl(rawUrl);
    if (!detected) {
      throw new Error("지원하는 URL이 아닙니다. 카쿠요무 또는 소설가가 되자 URL만 지원합니다.");
    }
    const adapter = this.adapterFor(detected.url);
    return adapter.loadWork(detected.url);
  }

  buildPreview(work: WebWorkIndex, rangeInput: string): WebImportPreview {
    const selection = parseEpisodeRange(rangeInput, work.episodes.length);
    const selectedEpisodes = selectEpisodeRange(work.episodes, selection);
    if (selectedEpisodes.length === 0) {
      throw new Error("선택된 화가 없습니다.");
    }
    return { work, selection, selectedEpisodes };
  }

  async importProject(
    preview: WebImportPreview,
    options: WebImportProjectOptions,
    onProgress?: WebImportProgressHandler
  ): Promise<WebImportResult> {
    const adapter = this.adapterFor(new URL(preview.work.sourceUrl));
    const episodes: WebEpisode[] = [];
    onProgress?.({ phase: "start", completed: 0, total: preview.selectedEpisodes.length });
    for (const ref of preview.selectedEpisodes) {
      onProgress?.({ phase: "episode-start", completed: episodes.length, total: preview.selectedEpisodes.length, episode: ref });
      const episode = await adapter.loadEpisode(ref);
      episodes.push(episode);
      onProgress?.({ phase: "episode-complete", completed: episodes.length, total: preview.selectedEpisodes.length, episode });
    }
    onProgress?.({ phase: "compose", completed: episodes.length, total: preview.selectedEpisodes.length });
    const sourceText = composeWebSourceText(episodes);
    onProgress?.({ phase: "create-project", completed: episodes.length, total: preview.selectedEpisodes.length });
    const created = await createProjectFromText({
      ...options,
      name: options.name ?? preview.work.title,
      sourceText,
      sourceLabel: preview.work.sourceUrl
    });
    onProgress?.({ phase: "metadata", completed: episodes.length, total: preview.selectedEpisodes.length });
    await attachWebEpisodeMetadata(created.metadata.projectDir, preview.work, episodes);
    return { created, work: preview.work, episodes };
  }

  private adapterFor(url: URL): WebImportAdapter {
    const adapter = this.adapters.find((candidate) => candidate.detect(url));
    if (!adapter) {
      throw new Error("지원하는 웹소설 사이트가 아닙니다.");
    }
    return adapter;
  }
}

function composeWebSourceText(episodes: WebEpisode[]): string {
  return episodes
    .map((episode) => {
      const parts = [episodeHeading(episode), ""];
      if (episode.foreword) {
        parts.push(episode.foreword.trim(), "");
      }
      parts.push(episode.bodyText.trim());
      if (episode.afterword) {
        parts.push("", episode.afterword.trim());
      }
      return parts.join("\n").trim();
    })
    .join("\n\n");
}

function episodeHeading(episode: WebEpisode): string {
  const title = episode.title.replace(/\s+/g, " ").trim();
  return /^第\s*[0-9０-９一二三四五六七八九十百千万億]+\s*[話章節]/u.test(title) ? title : `第${episode.no}話 ${title}`;
}

async function attachWebEpisodeMetadata(projectDir: string, work: WebWorkIndex, webEpisodes: WebEpisode[]): Promise<void> {
  const episodes = await listEpisodes(projectDir);
  const webByIndex = new Map<number, WebEpisode>();
  webEpisodes.forEach((episode, index) => {
    webByIndex.set(index + 1, episode);
  });
  const updated = episodes.map((episode) => {
    const webEpisode = webByIndex.get(episode.episodeNo);
    if (!webEpisode) {
      return episode;
    }
    return {
      ...episode,
      ...(webEpisode.foreword ? { foreword: webEpisode.foreword } : {}),
      body: webEpisode.bodyText,
      ...(webEpisode.afterword ? { afterword: webEpisode.afterword } : {}),
      sourceText: composeWebSourceText([webEpisode]),
      sourceHash: hashText(composeWebSourceText([webEpisode])),
      metadata: {
        ...episode.metadata,
        sourceKind: "web",
        sourceSite: work.site,
        sourceWorkUrl: work.sourceUrl,
        sourceUrl: webEpisode.url,
        remoteEpisodeNo: webEpisode.no,
        remoteEpisodeId: webEpisode.remoteId
      }
    };
  });
  await saveEpisodes(projectDir, updated);
}
