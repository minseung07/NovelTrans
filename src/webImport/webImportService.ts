import { createProjectFromText } from "../engine/projectWorkflow.js";
import { listEpisodes, saveEpisodes } from "../storage/projectStore.js";
import { hashText } from "../utils/hash.js";
import { KakuyomuAdapter } from "./adapters/kakuyomuAdapter.js";
import { SyosetuAdapter } from "./adapters/syosetuAdapter.js";
import { parseEpisodeRange, selectEpisodeRange } from "./episodeRange.js";
import { WebHttpClient, type WebHttpClientOptions } from "./httpClient.js";
import { detectWebImportUrl } from "./urlDetector.js";
import type {
  EpisodeRangeSelection,
  WebEpisode,
  WebEpisodeRef,
  WebImportAdapter,
  WebImportPreview,
  WebImportProjectOptions,
  WebImportResult,
  WebWorkIndex
} from "./types.js";

export type WebImportServiceOptions = WebHttpClientOptions & {
  adapters?: WebImportAdapter[];
};

export type WebImportProgressEvent =
  | { phase: "start"; completed: number; total: number }
  | { phase: "episode-start"; completed: number; total: number; episode: WebEpisodeRef }
  | { phase: "episode-complete"; completed: number; total: number; episode: WebEpisode }
  | { phase: "compose"; completed: number; total: number }
  | { phase: "create-project"; completed: number; total: number }
  | { phase: "metadata"; completed: number; total: number };

export type WebImportProgressHandler = (event: WebImportProgressEvent) => void;

export class WebImportService {
  private readonly adapters: WebImportAdapter[];

  constructor(options: WebImportServiceOptions = {}) {
    const http = new WebHttpClient(options);
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

export function composeWebSourceText(episodes: WebEpisode[]): string {
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

export function webImportConsentMessage(work: WebWorkIndex, selection: EpisodeRangeSelection, count: number): string {
  const siteLabel = work.site === "syosetu" ? "소설가가 되자" : "카쿠요무";
  const caution =
    work.site === "syosetu"
      ? "소설가가 되자는 본문 기계 취득에 관한 운영상 제한이 있을 수 있습니다."
      : "카쿠요무는 과도한 부하를 주는 이용을 제한할 수 있습니다.";
  return [
    `${siteLabel}에서 ${selection.label} (${count}화)를 저속으로 가져옵니다.`,
    `예상 최소 시간: ${formatApproxDuration(count * 1500)} 이상. 진행률은 가져오는 동안 계속 표시됩니다.`,
    caution,
    "공개 무료 회차만, 개인 번역 작업을 위한 범위에서 진행하세요.",
    "[Y] 동의하고 가져오기   [R] 범위 수정   [Q] 취소"
  ].join("\n");
}

function formatApproxDuration(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) {
    return `약 ${seconds}초`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder > 0 ? `약 ${minutes}분 ${remainder}초` : `약 ${minutes}분`;
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
