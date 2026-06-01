// Project screen: composes the stage rail (or narrow tab strip) with the active
// stage's detail panel. Only Overview is fully built in Phase 2; other stages
// show a placeholder that later phases replace.

import type { ProjectUiModel } from "../../../ui/types.js";
import type { AppModel, Job, Stage } from "../../state/model.js";
import type { BookshelfProject } from "../../../ui/types.js";
import { box } from "../../components/box.js";
import { rail, tabStrip, type RailItem } from "../../components/rail.js";
import { row } from "../../components/geometry.js";
import { renderOverview } from "./overview.js";
import { renderSource } from "./source.js";
import { renderGlossary } from "./glossary.js";
import { renderQa } from "./qa.js";
import { renderTranslate } from "./translate.js";
import { renderExport } from "./export.js";

// Rail box has a hard minimum width of 20 (normalizeBoxWidth), so the reserved
// width must match it; otherwise the detail column overflows by 2 and the right
// border gets truncated. detailWidth subtracts RAIL_WIDTH + 2 (gap).
const RAIL_WIDTH = 20;
const NARROW_WIDTH = 84;

export const STAGE_ORDER: Stage[] = ["overview", "source", "translate", "glossary", "qa", "export"];

export const STAGE_LABELS: Record<Stage, string> = {
  overview: "개요",
  source: "원문",
  translate: "번역",
  glossary: "용어",
  qa: "검수",
  export: "내보내기"
};

export function projectOf(model: AppModel): BookshelfProject | null {
  if (model.route.screen !== "project") {
    return null;
  }
  const { projectDir } = model.route;
  return model.library.allProjects.find((project) => project.projectDir === projectDir) ?? null;
}

function activeQaEpisodeIds(job: Job | null): string[] {
  return job && (job.status === "running" || job.status === "paused") && (job.kind === "qa-retranslate" || job.kind === "qa-batch-retranslate") ? (job.episodeIds ?? []) : [];
}

function stageBadge(stage: Stage, project: ProjectUiModel, job: Job | null): RailItem["badge"] {
  if (stage === "source") {
    return { level: "info", text: `${project.episodes.length}화` };
  }
  if (stage === "translate" && project.overview.counts.failed > 0) {
    return { level: "critical", text: `실패${project.overview.counts.failed}` };
  }
  if (stage === "glossary") {
    if (project.glossaryPulse.conflicts > 0) {
      return { level: "critical", text: `충돌${project.glossaryPulse.conflicts}` };
    }
    if (project.glossaryPulse.candidates > 0) {
      return { level: "info", text: `후보${project.glossaryPulse.candidates}` };
    }
  }
  if (stage === "qa") {
    const hidden = new Set(activeQaEpisodeIds(job));
    const open = project.qaIssues.filter((issue) => !issue.resolved && !hidden.has(issue.episodeId)).length;
    if (open > 0) {
      return { level: "warning", text: `검수${open}` };
    }
  }
  return undefined;
}

function railItems(project: ProjectUiModel | null, job: Job | null): RailItem[] {
  return STAGE_ORDER.map((stage) => ({ label: STAGE_LABELS[stage], badge: project ? stageBadge(stage, project, job) : undefined }));
}

function stageDetail(model: AppModel, stage: Stage, project: ProjectUiModel, job: Job | null, width: number): string[] {
  if (stage === "overview") {
    return renderOverview(project, job, width);
  }
  if (stage === "source") {
    return renderSource(project, model.sourceSelected, width);
  }
  if (stage === "glossary") {
    return renderGlossary(project, model.glossarySelected, model.glossaryFilter, model.deferred, width);
  }
  if (stage === "qa") {
    return renderQa(project, model.qaSelected, model.qaFilter, width, activeQaEpisodeIds(job));
  }
  if (stage === "translate") {
    return renderTranslate(project, job, width);
  }
  return renderExport(project, width);
}

export function renderProject(model: AppModel, width: number, _rows: number): string[] {
  if (model.route.screen !== "project") {
    return [];
  }
  const stage = model.route.stage;
  const activeIndex = STAGE_ORDER.indexOf(stage);
  const job = model.jobsByProjectDir[model.route.projectDir] ?? null;
  const items = railItems(model.project, job);
  const narrow = width < NARROW_WIDTH;
  const detailWidth = narrow ? width : width - RAIL_WIDTH - 2;
  const detail = !model.project
    ? box(STAGE_LABELS[stage], [model.projectLoading ? "프로젝트를 불러오는 중…" : "프로젝트를 찾을 수 없습니다.", "[Esc] 책장"], detailWidth)
    : stageDetail(model, stage, model.project, job, detailWidth);
  if (narrow) {
    return [tabStrip(items, activeIndex, width), "", ...detail];
  }
  return row(rail(items, activeIndex, RAIL_WIDTH), RAIL_WIDTH, detail, 2);
}
