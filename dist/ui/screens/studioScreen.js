import { box, columns, renderScreen } from "../layout.js";
import { taskStatusLines } from "../taskStatus.js";
import { studioActionLines, studioProgressLines, studioQualityLines, studioSessionLines, studioTimelineLines, studioWorkflowLines } from "../studioSummary.js";
export function renderStudioScreen(model, session, width, task) {
    const body = studioBody(model, session, width, task);
    return renderScreen(model.overview.metadata.name, "번역 작업실", body, studioFooter(model, session), { width });
}
export function renderResponsiveStudioScreen(model, session, width, height, task) {
    const fullBody = studioBody(model, session, width, task);
    const budget = bodyBudget(height);
    const body = budget !== null && fullBody.length > budget ? compactStudioBody(model, session, width, task, budget) : fullBody;
    return renderScreen(model.overview.metadata.name, "번역 작업실", body, studioFooter(model, session), { width });
}
function studioBody(model, session, width, task) {
    return [
        ...box("지금 할 일", studioActionLines(model, session), width),
        ...(task ? ["", ...box("진행 중인 작업", taskStatusLines(task), width)] : []),
        "",
        ...columns("진행 상황", studioProgressLines(model), "작업 흐름", studioWorkflowLines(model), width),
        "",
        ...columns("품질 신호", studioQualityLines(model), "최근 기록", studioTimelineLines(model), width),
        ...(session ? ["", ...box("세션", studioSessionLines(session), width)] : [])
    ];
}
function compactStudioBody(model, session, width, task, budget) {
    const body = [];
    pushRequired(body, box("지금 할 일", studioActionLines(model, session).slice(0, 5), width));
    if (task) {
        pushRequired(body, box("진행 중인 작업", taskStatusLines(task).slice(0, 5), width));
    }
    if (session) {
        pushRequired(body, box("세션", studioSessionLines(session).slice(0, 5), width));
    }
    pushRequired(body, box("진행 상황", studioProgressLines(model), width));
    pushOptional(body, box("작업 흐름", studioWorkflowLines(model), width), budget);
    pushOptional(body, columns("품질 신호", studioQualityLines(model), "최근 기록", studioTimelineLines(model), width), budget);
    return body;
}
function pushRequired(body, lines) {
    if (body.length > 0) {
        body.push("");
    }
    body.push(...lines);
}
function pushOptional(body, lines, budget) {
    const next = body.length > 0 ? ["", ...lines] : lines;
    if (body.length + next.length <= budget) {
        body.push(...next);
    }
}
function bodyBudget(height) {
    return height && Number.isFinite(height) ? Math.max(0, Math.floor(height) - 5) : null;
}
function studioFooter(model, session) {
    const spaceHint = session?.status === "running" ? "[Space] 일시정지 " : session?.status === "paused" ? "[Space] 재개 " : "";
    const reviewHint = model.failureRecovery.failedCount > 0 ? "[R] 복구" : "[R] 검수";
    return `${spaceHint}[T] 번역 [G] 용어 ${reviewHint} [E] 결과물 [:] 명령 [Q] 종료`;
}
