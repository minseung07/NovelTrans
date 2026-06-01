// Source stage: imported-source overview + episode list with a per-episode
// preview.

import type { Episode } from "../../../domain/episode.js";
import type { ProjectUiModel, SourceStatus } from "../../../ui/types.js";
import { columns, visibleWindow, clamp } from "../../components/geometry.js";
import { selectionRow } from "../../components/list.js";

const LIMIT = 10;

const LANG_LABELS: Record<string, string> = { ja: "일본어", ko: "한국어", unknown: "알 수 없음" };

function firstLines(text: string, max: number): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, max);
  return lines.length > 0 ? lines : ["(없음)"];
}

function statusLines(status: SourceStatus): string[] {
  const lines = [
    `제목: ${status.originalTitle || "(미상)"}`,
    `언어: ${LANG_LABELS[status.languageGuess] ?? status.languageGuess}   글자수: ${status.characterCount.toLocaleString()}`,
    `구조: ${status.structureLabel}   화수: ${status.episodeCount}`,
    `긴 화: ${status.longEpisodeCount}   후기: ${status.afterwordCount}`,
    `경로: ${status.sourcePath}`
  ];
  if (status.warnings.length > 0) {
    lines.push("", "주의:", ...status.warnings.map((warning) => `· ${warning}`));
  }
  return lines;
}

function previewLines(episode: Episode): string[] {
  const lines: string[] = [`${episode.episodeNo}화  ${episode.title}`, ""];
  if (episode.foreword) {
    lines.push("[머리말]", ...firstLines(episode.foreword, 2), "");
  }
  lines.push("[본문]", ...firstLines(episode.body, 6));
  if (episode.afterword) {
    lines.push("", "[후기]", ...firstLines(episode.afterword, 2));
  }
  return lines;
}

export function renderSource(project: ProjectUiModel, selected: number, width: number): string[] {
  const { episodes, sourceStatus } = project;
  if (episodes.length === 0) {
    return columns("에피소드", ["에피소드가 없습니다."], "원문 정보", statusLines(sourceStatus), width);
  }
  const selectedIndex = clamp(selected, 0, episodes.length - 1);
  const window = visibleWindow(episodes, selectedIndex, LIMIT);
  const listLines = [
    `${episodes.length}개 에피소드`,
    ...(window.hiddenBefore > 0 ? [`↑ 위 ${window.hiddenBefore}개`] : []),
    ...window.items.map((episode, index) => selectionRow(`${episode.episodeNo}화  ${episode.title}`, index === window.selectedOffset)),
    ...(window.hiddenAfter > 0 ? [`↓ 아래 ${window.hiddenAfter}개`] : []),
    "",
    "[↑↓]선택"
  ];
  const rightLines = [...statusLines(sourceStatus), "", "─ 선택 미리보기 ─", ...previewLines(episodes[selectedIndex]!)];
  return columns("에피소드", listLines, "원문 정보", rightLines, width);
}
