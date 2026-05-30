// Project Overview stage: pipeline status, "next actions", the live job, and
// recent activity. Also exports the job-display helpers used by the status bar.
import { box } from "../../components/box.js";
import { progressLine } from "../../components/progress.js";
import { severityBadge } from "../../components/badge.js";
import { stack } from "../../components/geometry.js";
export function jobStatusLabel(status) {
    const labels = {
        idle: "대기",
        running: "진행 중",
        paused: "일시정지",
        completed: "완료",
        failed: "실패",
        cancelled: "취소"
    };
    return labels[status];
}
export function jobPercent(job) {
    return job.queued > 0 ? Math.round((job.completed / job.queued) * 100) : job.status === "completed" ? 100 : 0;
}
export function jobSegment(job) {
    return `잡 ${jobStatusLabel(job.status)} ${job.completed}/${job.queued} (${jobPercent(job)}%)`;
}
function pipelineCard(project, width) {
    const counts = project.overview.counts;
    const total = project.overview.episodeStates.length;
    const percent = total === 0 ? 0 : Math.round((counts.completed / total) * 100);
    const openQa = project.qaIssues.filter((issue) => !issue.resolved).length;
    return box("파이프라인", [
        `${progressLine(percent, 14)}   ${counts.completed}/${total}화`,
        `대기 ${counts.pending}   진행 ${counts.running}   실패 ${counts.failed}   건너뜀 ${counts.skipped}`,
        `용어 후보 ${project.glossaryPulse.candidates}   충돌 ${project.glossaryPulse.conflicts}   검수 ${openQa}`
    ], width);
}
function actionsCard(project, width) {
    const lines = project.nextActions.map((action) => severityBadge(action.severity, `${action.message}  ${action.commandHint}`));
    return box("지금 할 일", lines.length > 0 ? lines : ["할 일이 없습니다."], width);
}
function jobCard(job, width) {
    if (!job) {
        return box("라이브 잡", ["진행 중인 잡이 없습니다.", "[T] 번역 시작"], width);
    }
    return box("라이브 잡", [`${jobStatusLabel(job.status)}   ${progressLine(jobPercent(job), 14)}`, `완료 ${job.completed}   대기 ${job.queued}   실패 ${job.failed}`], width);
}
function activityCard(project, width) {
    const items = project.timeline.slice(-5);
    return box("최근 활동", items.length > 0 ? items.map((item) => item.label) : ["기록이 없습니다."], width);
}
export function renderOverview(project, job, width) {
    return stack(pipelineCard(project, width), actionsCard(project, width), jobCard(job, width), activityCard(project, width));
}
