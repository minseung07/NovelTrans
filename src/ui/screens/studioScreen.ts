import type { TranslationSessionSnapshot } from "../../engine/translationSession.js";
import type { UiTaskSnapshot } from "../taskStatus.js";
import type { ProjectUiModel } from "../types.js";
import { box, columns, renderScreen } from "../layout.js";
import { taskStatusLines } from "../taskStatus.js";
import {
  studioActionLines,
  studioProgressLines,
  studioQualityLines,
  studioSessionLines,
  studioTimelineLines,
  studioWorkflowLines
} from "../studioSummary.js";

export function renderStudioScreen(model: ProjectUiModel, session?: TranslationSessionSnapshot | null, width?: number, task?: UiTaskSnapshot | null): string {
  const body = studioBody(model, session, width, task);

  return renderScreen(
    model.overview.metadata.name,
    "번역 작업실",
    body,
    studioFooter(model, session),
    { width }
  );
}

export function renderResponsiveStudioScreen(
  model: ProjectUiModel,
  session?: TranslationSessionSnapshot | null,
  width?: number,
  height?: number,
  task?: UiTaskSnapshot | null
): string {
  const fullBody = studioBody(model, session, width, task);
  const budget = bodyBudget(height);
  const body = budget !== null && fullBody.length > budget ? compactStudioBody(model, session, width, task, budget) : fullBody;
  return renderScreen(
    model.overview.metadata.name,
    "번역 작업실",
    body,
    studioFooter(model, session),
    { width }
  );
}

function studioBody(model: ProjectUiModel, session?: TranslationSessionSnapshot | null, width?: number, task?: UiTaskSnapshot | null): string[] {
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

function compactStudioBody(
  model: ProjectUiModel,
  session: TranslationSessionSnapshot | null | undefined,
  width: number | undefined,
  task: UiTaskSnapshot | null | undefined,
  budget: number
): string[] {
  const body: string[] = [];
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

function pushRequired(body: string[], lines: string[]): void {
  if (body.length > 0) {
    body.push("");
  }
  body.push(...lines);
}

function pushOptional(body: string[], lines: string[], budget: number): void {
  const next = body.length > 0 ? ["", ...lines] : lines;
  if (body.length + next.length <= budget) {
    body.push(...next);
  }
}

function bodyBudget(height?: number): number | null {
  return height && Number.isFinite(height) ? Math.max(0, Math.floor(height) - 5) : null;
}

function studioFooter(model: ProjectUiModel, session?: TranslationSessionSnapshot | null): string {
  const spaceHint = session?.status === "running" ? "[Space] 일시정지 " : session?.status === "paused" ? "[Space] 재개 " : "";
  const reviewHint = model.failureRecovery.failedCount > 0 ? "[R] 복구" : "[R] 검수";
  return `${spaceHint}[T] 번역 [G] 용어 ${reviewHint} [E] 결과물 [:] 명령 [Q] 종료`;
}
