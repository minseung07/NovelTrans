import { progressBar } from "./layout.js";
import { formatDuration } from "./timeFormat.js";
export function writeWebWorkLoadingStatus(output, url) {
    const width = Math.max(40, output.columns || 80);
    output.write(`\n${clipTerminalLine(`작품 정보를 가져오는 중입니다 · ${url}`, width)}\n`);
}
export function writeWebImportProgress(output, event, startedAt) {
    const width = Math.max(40, output.columns || 80);
    output.write(`\r\x1b[K${clipTerminalLine(formatWebImportProgress(event, startedAt), width)}`);
}
export function formatWebImportProgress(event, startedAt) {
    const percent = event.total > 0 ? Math.floor((event.completed / event.total) * 100) : 0;
    const bar = progressBar(percent, 20);
    if (event.phase === "start") {
        return `${bar} ${percent}%  0/${event.total}화  준비 중`;
    }
    if (event.phase === "episode-start") {
        return progressLine(bar, percent, "가져오는 중", event.completed, event.total, event.episode.title, startedAt);
    }
    if (event.phase === "episode-complete") {
        return progressLine(bar, percent, "완료", event.completed, event.total, event.episode.title, startedAt);
    }
    if (event.phase === "compose") {
        return `${bar} ${percent}%  ${event.completed}/${event.total}화  본문 정리 중`;
    }
    if (event.phase === "create-project") {
        return `${bar} ${percent}%  ${event.completed}/${event.total}화  프로젝트 생성 중`;
    }
    return `${bar} ${percent}%  ${event.completed}/${event.total}화  회차 메타데이터 저장 중`;
}
function progressLine(bar, percent, label, completed, total, title, startedAt) {
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    const etaMs = completed > 0 ? (elapsedMs / completed) * Math.max(0, total - completed) : null;
    const eta = etaMs === null ? "계산 중" : formatDuration(etaMs);
    return `${bar} ${percent}%  ${completed}/${total}화  ${label} · 경과 ${formatDuration(elapsedMs)} · 남은 약 ${eta} · ${title}`;
}
function clipTerminalLine(value, width) {
    const chars = Array.from(value);
    if (chars.length <= width - 1) {
        return value;
    }
    return `${chars.slice(0, Math.max(1, width - 2)).join("")}…`;
}
