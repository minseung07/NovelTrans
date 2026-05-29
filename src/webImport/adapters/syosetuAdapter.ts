import type { WebEpisode, WebEpisodeRef, WebImportAdapter, WebWorkIndex } from "../types.js";
import { WebHttpClient } from "../httpClient.js";
import {
  absoluteUrl,
  extractAnchorLinks,
  extractElementByClass,
  extractElementById,
  extractMetaContent,
  extractTitle,
  htmlToText,
  normalizeText
} from "../html.js";

export class SyosetuAdapter implements WebImportAdapter {
  readonly site = "syosetu" as const;

  constructor(private readonly http: WebHttpClient) {}

  detect(url: URL): boolean {
    return url.hostname === "ncode.syosetu.com" && Boolean(ncodeFromUrl(url));
  }

  async loadWork(url: URL): Promise<WebWorkIndex> {
    const ncode = ncodeFromUrl(url);
    if (!ncode) {
      throw new Error("소설가가 되자 작품 URL이 아닙니다.");
    }
    const workUrl = `https://ncode.syosetu.com/${ncode}/`;
    const [html, metadata] = await Promise.all([
      this.http.getText(workUrl),
      this.loadOfficialMetadata(ncode).catch(() => null)
    ]);
    const links = extractAnchorLinks(html)
      .map((link) => {
        const absolute = absoluteUrl(workUrl, link.href);
        const episodeNo = episodeNoFromUrl(new URL(absolute), ncode);
        return episodeNo ? { no: episodeNo, title: link.text, url: absolute, remoteId: `${ncode}-${episodeNo}` } : null;
      })
      .filter((item): item is WebEpisodeRef => Boolean(item))
      .filter((item, index, items) => items.findIndex((candidate) => candidate.no === item.no) === index)
      .sort((left, right) => left.no - right.no)
      .map((item, index) => ({ ...item, no: index + 1, remoteId: `${ncode}-${item.no}`, title: item.title || `第${index + 1}話` }));

    const episodes =
      links.length > 0
        ? links
        : [
            {
              no: 1,
              title: extractWorkTitle(html) ?? ncode,
              url: workUrl,
              remoteId: `${ncode}-1`
            }
          ];

    return {
      site: this.site,
      title: metadata?.title ?? extractWorkTitle(html) ?? ncode,
      author: metadata?.writer ?? extractAuthor(html),
      sourceUrl: workUrl,
      episodes
    };
  }

  async loadEpisode(ref: WebEpisodeRef): Promise<WebEpisode> {
    const html = await this.http.getText(ref.url);
    const bodyHtml = extractBodyHtml(html);
    const bodyText = htmlToText(bodyHtml);
    if (!bodyText) {
      throw new Error(`소설가가 되자 본문을 찾지 못했습니다: ${ref.url}`);
    }
    const foreword = extractOptionalText(html, "novel_p");
    const afterword = extractOptionalText(html, "novel_a");
    return {
      ...ref,
      title: extractEpisodeTitle(html) ?? ref.title,
      bodyText,
      ...(foreword ? { foreword } : {}),
      ...(afterword ? { afterword } : {})
    };
  }

  private async loadOfficialMetadata(ncode: string): Promise<{ title?: string; writer?: string; general_all_no?: number } | null> {
    const url = `https://api.syosetu.com/novelapi/api/?out=json&of=t-w-ga&ncode=${encodeURIComponent(ncode)}`;
    const text = await this.http.getText(url);
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    const item = parsed[1] as Record<string, unknown> | undefined;
    if (!item) {
      return null;
    }
    return {
      title: typeof item.title === "string" ? item.title : undefined,
      writer: typeof item.writer === "string" ? item.writer : undefined,
      general_all_no: typeof item.general_all_no === "number" ? item.general_all_no : undefined
    };
  }
}

function ncodeFromUrl(url: URL): string | null {
  return url.pathname.match(/^\/(n[0-9a-z]+)(?:\/|$)/i)?.[1]?.toLowerCase() ?? null;
}

function episodeNoFromUrl(url: URL, ncode: string): number | null {
  const match = url.pathname.match(new RegExp(`^/${ncode}/(\\d+)/?$`, "i"));
  if (!match?.[1]) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function extractWorkTitle(html: string): string | null {
  const titleHtml = extractElementByClass(html, "novel_title") ?? extractElementByClass(html, "p-novel__title");
  if (titleHtml) {
    return htmlToText(titleHtml).split("\n")[0]?.trim() || null;
  }
  const meta = extractMetaContent(html, "og:title") ?? extractTitle(html);
  return meta ? cleanupSyosetuTitle(meta) : null;
}

function extractEpisodeTitle(html: string): string | null {
  const titleHtml = extractElementByClass(html, "novel_subtitle") ?? extractElementByClass(html, "p-novel__title");
  if (titleHtml) {
    return htmlToText(titleHtml).split("\n")[0]?.trim() || null;
  }
  const meta = extractMetaContent(html, "og:title") ?? extractTitle(html);
  return meta ? cleanupSyosetuTitle(meta) : null;
}

function extractAuthor(html: string): string | null {
  const writer = extractElementByClass(html, "novel_writername") ?? extractElementByClass(html, "p-novel__author");
  if (!writer) {
    return null;
  }
  return htmlToText(writer).replace(/^作者[:：]\s*/u, "").trim() || null;
}

function extractBodyHtml(html: string): string {
  return (
    extractElementById(html, "novel_honbun") ??
    extractElementByClass(html, "p-novel__body") ??
    extractElementByClass(html, "novel_view") ??
    ""
  );
}

function extractOptionalText(html: string, id: string): string | undefined {
  const value = extractElementById(html, id);
  const text = value ? htmlToText(value) : "";
  return text || undefined;
}

function cleanupSyosetuTitle(title: string): string {
  return normalizeText(title.replace(/\s*[-|｜]\s*小説家になろう.*$/u, ""));
}
