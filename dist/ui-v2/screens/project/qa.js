// QA triage stage: open issues colored by severity beside a source/translation
// compare panel for the selected issue.
import { columns, visibleWindow, clamp } from "../../components/geometry.js";
import { selectionRow } from "../../components/list.js";
import { severityBadge } from "../../components/badge.js";
const LIMIT = 10;
const TYPE_LABELS = {
    empty_translation: "빈 번역",
    missing_paragraph: "문단 누락",
    japanese_remaining: "일본어 잔존",
    number_mismatch: "숫자 불일치",
    length_ratio: "길이 비율",
    glossary_mismatch: "용어 불일치",
    locked_term_violation: "고정 용어 위반",
    forbidden_term: "금지어",
    name_inconsistency: "이름 불일치",
    repetition: "반복",
    other: "기타"
};
function issueSeverity(issue) {
    return issue.severity === "error" ? "critical" : issue.severity === "warning" ? "warning" : "info";
}
function compareLines(issue) {
    return [
        `유형: ${TYPE_LABELS[issue.type]}`,
        issue.message,
        "",
        "원문:",
        issue.sourceSnippet ?? "(없음)",
        "",
        "번역:",
        issue.targetSnippet ?? "(없음)"
    ];
}
export function renderQa(project, selected, width) {
    const issues = project.reviewDesk.openIssues;
    if (issues.length === 0) {
        return columns("검수 큐", ["검수 항목이 없습니다."], "원문 / 번역 대조", ["대조할 항목이 없습니다."], width);
    }
    const selectedIndex = clamp(selected, 0, issues.length - 1);
    const window = visibleWindow(issues, selectedIndex, LIMIT);
    const listLines = [
        `${issues.length}개 검수 항목`,
        "",
        ...window.items.map((issue, index) => selectionRow(severityBadge(issueSeverity(issue), TYPE_LABELS[issue.type]), index === window.selectedOffset)),
        "",
        "[i]무시 [r]재검사 [t]재번역 [g]용어"
    ];
    return columns("검수 큐", listLines, "원문 / 번역 대조", compareLines(issues[selectedIndex]), width);
}
