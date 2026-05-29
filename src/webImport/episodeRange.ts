import type { EpisodeRangeSelection } from "./types.js";

export function parseEpisodeRange(value: string, total: number): EpisodeRangeSelection {
  if (!Number.isInteger(total) || total <= 0) {
    throw new Error("가져올 수 있는 화가 없습니다.");
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    throw new Error("가져올 화수 범위를 입력하세요. 예: 1-10, latest-5, all");
  }
  if (normalized === "all" || normalized === "전체") {
    return { start: 1, end: total, label: "전체" };
  }

  const latest = normalized.match(/^latest-(\d+)$/);
  if (latest) {
    const count = parsePositiveInt(latest[1]!, "latest 범위");
    const start = Math.max(1, total - count + 1);
    return { start, end: total, label: `최신 ${total - start + 1}화` };
  }

  const openEnded = normalized.match(/^(\d+)-$/);
  if (openEnded) {
    const start = parsePositiveInt(openEnded[1]!, "시작 화");
    return clampSelection(start, total, total, `${start}화부터 끝까지`);
  }

  const range = normalized.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) {
    const start = parsePositiveInt(range[1]!, "시작 화");
    const end = parsePositiveInt(range[2]!, "끝 화");
    return clampSelection(start, end, total, `${start}-${Math.min(end, total)}화`);
  }

  const single = normalized.match(/^(\d+)$/);
  if (single) {
    const episodeNo = parsePositiveInt(single[1]!, "화수");
    return clampSelection(episodeNo, episodeNo, total, `${episodeNo}화`);
  }

  throw new Error("지원하지 않는 화수 범위입니다. 예: 1, 1-10, 11-, latest-5, all");
}

export function selectEpisodeRange<T extends { no: number }>(items: T[], selection: EpisodeRangeSelection): T[] {
  return items.filter((item) => item.no >= selection.start && item.no <= selection.end);
}

function parsePositiveInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label}는 1 이상의 숫자여야 합니다.`);
  }
  return parsed;
}

function clampSelection(start: number, end: number, total: number, label: string): EpisodeRangeSelection {
  if (start > total) {
    throw new Error(`시작 화가 전체 화수(${total})를 넘습니다.`);
  }
  if (end < start) {
    throw new Error("끝 화가 시작 화보다 작습니다.");
  }
  return {
    start,
    end: Math.min(end, total),
    label
  };
}
