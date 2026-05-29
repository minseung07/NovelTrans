const timelineLimit = 6;
export function buildProjectTimeline(events) {
    return events
        .slice()
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
        .slice(-timelineLimit)
        .map((event) => ({
        timestamp: event.timestamp,
        label: timelineLabel(event),
        severity: timelineSeverity(event)
    }));
}
function timelineLabel(event) {
    const message = localizedTimelineMessage(event);
    if (event.episodeId) {
        return `${event.episodeId}: ${message}`;
    }
    return message;
}
function localizedTimelineMessage(event) {
    const message = event.message;
    if (event.event === "project_created" || event.event === "source_imported") {
        return replaceCount(message, /^(\d+) episode\(s\) imported from source text\.$/, "개 화를 가져왔습니다.");
    }
    if (event.event === "initial_candidates_extracted" || event.event === "candidates_extracted") {
        return replaceCount(message, /^(\d+) glossary candidate\(s\) extracted\.$/, "개 후보 용어를 추출했습니다.");
    }
    if (event.event === "run_started") {
        const match = message.match(/^(\d+) episode\(s\) queued for (.*)\.$/);
        return match ? `${match[1]}개 화를 ${modeLabel(match[2])} 대기열에 넣었습니다.` : message;
    }
    if (event.event === "candidates_refreshed") {
        const match = message.match(/^(\d+) candidate term\(s\), (\d+) conflict\(s\)\.$/);
        return match ? `후보 용어 ${match[1]}개, 충돌 ${match[2]}개.` : message;
    }
    if (event.event === "conflicts_detected") {
        return replaceCount(message, /^(\d+) glossary conflict\(s\) detected\.$/, "개 용어 충돌이 감지됐습니다.");
    }
    if (event.event === "episode_started") {
        return replaceEpisodeSuffix(message, " started.", " 시작");
    }
    if (event.event === "episode_completed") {
        return replaceEpisodeSuffix(message, " completed.", " 완료");
    }
    if (event.event === "episode_cancelled") {
        return replaceEpisodeSuffix(message, " cancelled.", " 취소");
    }
    if (event.event === "episode_retranslate_started") {
        return replaceEpisodeSuffix(message.replace(/: .*?\.$/, "."), " retranslation started.", " 재번역 시작");
    }
    if (event.event === "episode_retranslate_completed") {
        return replaceEpisodeSuffix(message, " retranslation completed.", " 재번역 완료");
    }
    if (event.event === "episode_retranslate_cancelled") {
        return replaceEpisodeSuffix(message, " retranslation cancelled.", " 재번역 취소");
    }
    if (event.event === "episode_retranslate_failed") {
        return `재번역 실패: ${message}`;
    }
    if (event.event === "episode_qa_completed") {
        const match = message.match(/^(.*) QA completed with (\d+) issue\(s\)\.$/);
        return match ? `${match[1]} QA 완료, 이슈 ${match[2]}개.` : message;
    }
    if (event.event === "episode_checked") {
        const match = message.match(/^(.*) QA completed with (\d+) issue\(s\)\.$/);
        return match ? `${match[1]} QA 완료, 이슈 ${match[2]}개.` : message;
    }
    if (event.event === "run_finished" || event.event === "translation_finished" || event.event === "session_finished") {
        const match = message.match(/completed=(\d+), failed=(\d+)/);
        return match ? `번역 완료: 완료 ${match[1]}개, 실패 ${match[2]}개.` : message;
    }
    if (event.event === "export_completed") {
        return replaceCount(message, /^Exported (\d+) file\(s\)\.$/, "개 파일을 생성했습니다.");
    }
    if (event.event === "failed_episodes_skipped") {
        return replaceCount(message, /^(\d+) failed episode\(s\) skipped for export\.$/, "개 실패 화를 결과물에서 제외했습니다.");
    }
    return message;
}
function modeLabel(mode) {
    if (mode === "retry-failed") {
        return "실패 재시도";
    }
    if (mode === "pending-only") {
        return "대기 화";
    }
    return "번역";
}
function replaceCount(message, pattern, suffix) {
    const match = message.match(pattern);
    return match ? `${match[1]}${suffix}` : message;
}
function replaceEpisodeSuffix(message, suffix, replacement) {
    return message.endsWith(suffix) ? `${message.slice(0, -suffix.length)}${replacement}` : message;
}
function timelineSeverity(event) {
    if (event.level === "error") {
        return "error";
    }
    if (event.level === "warn" || event.category === "glossary" || event.event.includes("conflict")) {
        return "warning";
    }
    return "info";
}
