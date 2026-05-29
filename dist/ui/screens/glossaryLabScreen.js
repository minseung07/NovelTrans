import { newlyFoundTerms } from "../glossaryGrowth.js";
import { buildGlossaryQueue } from "../glossaryQueue.js";
import { box, columns, renderScreen, table } from "../layout.js";
import { visibleWindow } from "../visibleWindow.js";
const visibleGlossaryLimit = 12;
export function renderGlossaryLabScreen(model, selectedIndex = 0, filter = "all", deferredEntryIds = [], width) {
    const body = glossaryBody(model, selectedIndex, filter, deferredEntryIds, width, visibleGlossaryLimit, null, true);
    return renderScreen("용어 연구실", model.overview.metadata.name, body, "[Enter] 적용   [E/L/F] 수정   [S] 보류   [D] 폐기   [A] 전체   [B] 뒤로", { width });
}
export function renderResponsiveGlossaryLabScreen(model, selectedIndex = 0, filter = "all", deferredEntryIds = [], width, height) {
    const fullBody = glossaryBody(model, selectedIndex, filter, deferredEntryIds, width, visibleGlossaryLimit, null, true);
    const budget = bodyBudget(height);
    const body = budget !== null && fullBody.length > budget
        ? glossaryBody(model, selectedIndex, filter, deferredEntryIds, width, compactGlossaryLimit(height), compactDetailLimit(height), false)
        : fullBody;
    return renderScreen("용어 연구실", model.overview.metadata.name, body, "[Enter] 적용   [E/L/F] 수정   [S] 보류   [D] 폐기   [A] 전체   [B] 뒤로", { width });
}
function glossaryBody(model, selectedIndex, filter, deferredEntryIds, width, visibleLimit, detailLimit, includeSecondary) {
    const queue = buildGlossaryQueue(model, filter, deferredEntryIds);
    const window = visibleWindow(queue, selectedIndex, visibleLimit);
    const selected = queue[window.selectedIndex] ?? queue[0];
    const queueLines = queue.length > 0
        ? [
            queueStatusLine(filter, deferredEntryIds),
            "",
            ...hiddenBeforeLine(window.hiddenBefore),
            ...window.items.map((item, index) => formatQueueItem(item, index === window.selectedOffset, deferredEntryIds)),
            ...hiddenAfterLine(window.hiddenAfter)
        ]
        : [queueStatusLine(filter, deferredEntryIds), "", emptyQueueMessage(filter)];
    const detailLines = selected ? termDetailLines(selected.entry).slice(0, detailLimit ?? undefined) : ["용어집이 비어 있습니다.", "원문을 가져오거나 번역하면 후보 용어가 쌓입니다."];
    const body = [
        ...columns("검토 대기", queueLines, "용어 상세", detailLines, width),
    ];
    if (includeSecondary) {
        body.push("", ...box("용어 상태", [
            `일관성 ${model.glossaryPulse.healthScore}%`,
            `검토 대기 ${model.glossaryPulse.candidates}`,
            `충돌 ${model.glossaryPulse.conflicts}`,
            `고정 비율 ${model.glossaryPulse.lockCoveragePercent}%`,
            ""
        ], width), "", ...box("새 후보 용어", newTermLines(model), width));
    }
    return body;
}
function filterLabel(filter) {
    if (filter === "conflicts") {
        return "충돌만";
    }
    if (filter === "candidates") {
        return "후보만";
    }
    return "전체";
}
function emptyQueueMessage(filter) {
    if (filter === "conflicts") {
        return "검토할 충돌 용어가 없습니다.";
    }
    if (filter === "candidates") {
        return "검토할 후보 용어가 없습니다.";
    }
    return "검토할 용어가 없습니다.";
}
function queueStatusLine(filter, deferredEntryIds) {
    const suffix = deferredEntryIds.length > 0 ? ` · 나중에 ${deferredEntryIds.length}` : "";
    return `필터: ${filterLabel(filter)}${suffix}`;
}
function formatQueueItem(item, selected, deferredEntryIds) {
    const marker = selected ? ">" : " ";
    const deferred = deferredEntryIds.includes(item.entry.id) ? " 나중에" : "";
    return `${marker} ${item.entry.source}  ${item.label}${deferred}`;
}
function termDetailLines(entry) {
    const targets = entry.targetCandidates.length > 0 ? entry.targetCandidates.map((candidate, index) => `${index + 1}. ${candidate.target}  ${candidate.count}회`) : ["아직 번역 후보가 없습니다."];
    const lines = [
        ...table([
            ["원문", entry.source],
            ["유형", entry.type],
            ["상태", entry.status],
            ["등장", entry.occurrenceCount],
            ["화", episodeRange(entry)],
            ["번역", entry.target ?? "(미확정)"],
            ["고정", entry.locked ? "예" : "아니오"]
        ], 9),
        "",
        "번역 후보:",
        ...targets
    ];
    if (entry.forbiddenTargets.length > 0) {
        lines.push("", `금지어: ${entry.forbiddenTargets.join(", ")}`);
    }
    return lines;
}
function newTermLines(model) {
    const terms = newlyFoundTerms(model.glossary);
    return terms.length > 0 ? terms : ["새 후보 용어가 없습니다."];
}
function episodeRange(entry) {
    if (entry.firstSeenEpisode === null || entry.lastSeenEpisode === null) {
        return "-";
    }
    if (entry.firstSeenEpisode === entry.lastSeenEpisode) {
        return String(entry.firstSeenEpisode);
    }
    return `${entry.firstSeenEpisode}-${entry.lastSeenEpisode}`;
}
function hiddenBeforeLine(count) {
    return count > 0 ? [`... 위 ${count}개`] : [];
}
function hiddenAfterLine(count) {
    return count > 0 ? [`... 아래 ${count}개`] : [];
}
function bodyBudget(height) {
    return height && Number.isFinite(height) ? Math.max(0, Math.floor(height) - 5) : null;
}
function compactGlossaryLimit(height) {
    if (!height || !Number.isFinite(height)) {
        return 6;
    }
    return Math.max(3, Math.min(8, Math.floor(height / 3)));
}
function compactDetailLimit(height) {
    if (!height || !Number.isFinite(height)) {
        return 8;
    }
    return Math.max(5, Math.min(9, Math.floor(height / 2)));
}
