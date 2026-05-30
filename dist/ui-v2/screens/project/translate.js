// Translate stage: job control + queue status + failed episodes inline
// (absorbs the old failure-recovery screen, incl. skip-and-export).
import { box } from "../../components/box.js";
import { progressLine } from "../../components/progress.js";
import { stack } from "../../components/geometry.js";
import { jobStatusLabel, jobPercent } from "./overview.js";
function queueLine(item) {
    return `${item.episodeNo}. ${item.title}  ${item.status}`;
}
export function renderTranslate(project, job, width) {
    const counts = project.overview.counts;
    const total = project.overview.episodeStates.length;
    const statusLine = job
        ? `${jobStatusLabel(job.status)}  ${progressLine(jobPercent(job), 14)}  완료 ${job.completed}/${job.queued}  실패 ${job.failed}`
        : `완료 ${counts.completed}/${total}  대기 ${counts.pending}  실행 ${counts.running}  실패 ${counts.failed}`;
    const control = box("번역 상태", [statusLine, "[t]이어가기 [y]실패 재시도 [p]일시정지 [s]건너뛰고 내보내기"], width);
    const active = box("진행 중", project.studioQueue.active.length > 0 ? project.studioQueue.active.map(queueLine) : ["진행 중인 화가 없습니다."], width);
    const failed = box("실패한 화", project.failureRecovery.items.length > 0 ? project.failureRecovery.items.slice(0, 6).map((item) => `${item.episodeNo}. ${item.title} — ${item.reason}`) : ["실패한 화가 없습니다."], width);
    return stack(control, active, failed);
}
